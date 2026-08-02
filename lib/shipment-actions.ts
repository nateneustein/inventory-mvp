'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { trackingEnabled, registerNumbers, getTrackInfo, readEvents, readSummary, isAlreadyRegistered } from '@/lib/tracking'

function value(formData: FormData, key: string) {
  const raw = formData.get(key)
  return typeof raw === 'string' ? raw.trim() : ''
}

async function currentUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { supabase, userId: user.id }
}

function revalidateShipments(id?: string) {
  revalidatePath('/shipments')
  if (id) revalidatePath('/shipments/' + id)
  revalidatePath('/receiving')
  revalidatePath('/dashboard')
  revalidatePath('/purchase-orders')
}

/**
 * An update someone typed in.
 *
 * While a container is at sea the courier tracking says nothing for weeks, and
 * what the supplier tells you - it reached the port, it cleared customs - is
 * the only information that exists. It belongs in the same timeline as the
 * carrier events, not in a notes field nobody reads.
 */
export async function addShipmentUpdate(formData: FormData) {
  const { supabase, userId } = await currentUser()
  const id = value(formData, 'purchase_order_id')
  const status = value(formData, 'status')
  const note = value(formData, 'note')
  if (!status && !note) return

  const happenedAt = value(formData, 'happened_at')
  const { error } = await supabase.from('shipment_updates').insert({
    purchase_order_id: id,
    happened_at: happenedAt ? new Date(happenedAt).toISOString() : new Date().toISOString(),
    source: 'manual',
    status: status || null,
    location: value(formData, 'location') || null,
    note: note || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidateShipments(id)
}

export async function deleteShipmentUpdate(formData: FormData) {
  const { supabase } = await currentUser()
  const id = value(formData, 'purchase_order_id')
  const updateId = value(formData, 'update_id')
  const { error } = await supabase.from('shipment_updates').delete().eq('id', updateId)
  if (error) throw new Error(error.message)
  revalidateShipments(id)
}

/** Write down that we tried and it did not work, rather than failing silently. */
async function recordFailure(supabase: any, id: string, message: string) {
  await supabase.from('purchase_orders').update({
    tracking_error: message,
    tracking_checked_at: new Date().toISOString(),
  }).eq('id', id)
}

/**
 * Ask the carrier where one shipment is and write down what it says.
 *
 * Returns a short word describing what happened rather than throwing, because
 * refreshing twenty shipments must not stop at the first bad tracking number.
 */
async function refreshOne(supabase: any, po: any) {
  const number = String(po.tracking_number || '').trim()
  if (!number) return 'no-number'

  if (!trackingEnabled()) {
    await recordFailure(supabase, po.id, 'Carrier tracking is not switched on yet. Add TRACK17_API_KEY in the Vercel project settings.')
    return 'disabled'
  }

  try {
    if (!po.tracking_registered) {
      const registration = await registerNumbers([number])
      const rejected = (registration.rejected || [])[0]
      if (rejected && !isAlreadyRegistered(rejected)) {
        await recordFailure(supabase, po.id, rejected?.error?.message || 'The tracking service would not accept this number.')
        return 'rejected'
      }
      await supabase.from('purchase_orders').update({ tracking_registered: true }).eq('id', po.id)
    }

    const info = await getTrackInfo([number])
    const item = (info.accepted || [])[0]
    if (!item) {
      await recordFailure(supabase, po.id, 'The carrier has nothing on this number yet. A freshly created label can take a day to appear.')
      return 'empty'
    }

    const trackInfo = item.track_info || item
    const summary = readSummary(trackInfo)
    const events = readEvents(trackInfo)

    if (events.length) {
      const rows = events.map((event) => ({
        purchase_order_id: po.id,
        happened_at: event.at || new Date().toISOString(),
        source: 'carrier',
        status: event.status,
        location: event.location,
        note: event.description,
        carrier_event_key: event.key,
      }))
      // The same events come back on every check, so the carrier_event_key
      // unique index is what stops the timeline growing a duplicate each time.
      await supabase.from('shipment_updates').upsert(rows, {
        onConflict: 'purchase_order_id,carrier_event_key',
        ignoreDuplicates: true,
      })
    }

    const patch: Record<string, any> = {
      carrier_name: summary.carrierName,
      carrier_code: summary.carrierCode,
      tracking_status: summary.status,
      tracking_substatus: summary.subStatus,
      tracking_last_event: summary.lastEvent,
      tracking_last_event_at: summary.lastEventAt,
      tracking_last_location: summary.lastLocation,
      tracking_eta: summary.eta,
      tracking_checked_at: new Date().toISOString(),
      tracking_error: null,
      updated_at: new Date().toISOString(),
    }

    if (summary.eta && summary.eta !== po.expected_date) {
      patch.expected_date = summary.eta
      // Moving the date quietly would be worse than not moving it at all: the
      // point of the timeline is being able to see why the plan changed.
      await supabase.from('shipment_updates').upsert([{
        purchase_order_id: po.id,
        happened_at: new Date().toISOString(),
        source: 'carrier',
        status: 'Expected date updated',
        note: 'The carrier now estimates ' + summary.eta + '. Expected date moved from ' + (po.expected_date || 'not set') + '.',
        carrier_event_key: 'eta:' + summary.eta,
      }], { onConflict: 'purchase_order_id,carrier_event_key', ignoreDuplicates: true })
    }

    await supabase.from('purchase_orders').update(patch).eq('id', po.id)
    return 'ok'
  } catch (error: any) {
    await recordFailure(supabase, po.id, error?.message || 'The tracking check failed.')
    return 'error'
  }
}

export async function refreshShipmentTracking(formData: FormData) {
  const { supabase } = await currentUser()
  const id = value(formData, 'purchase_order_id')
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, tracking_number, expected_date, tracking_registered')
    .eq('id', id)
    .single()
  if (po) await refreshOne(supabase, po)
  revalidateShipments(id)
}

/**
 * Check every shipment that is still on its way.
 *
 * Delivered and closed orders are skipped - they cannot change, and each check
 * would spend quota for nothing.
 */
// Returns nothing on purpose: this is used directly as a <form action>, and
// React requires a form action to resolve to void.
export async function refreshAllShipmentTracking() {
  const { supabase } = await currentUser()
  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('id, tracking_number, expected_date, tracking_registered, status')
    .not('tracking_number', 'is', null)
    .not('status', 'in', '("received","closed","cancelled")')

  const list = orders || []
  for (const po of list) {
    if (!String(po.tracking_number || '').trim()) continue
    await refreshOne(supabase, po)
  }
  revalidateShipments()
}
