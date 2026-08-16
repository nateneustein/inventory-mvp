'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermissions } from '@/lib/permissions'
import { trackingEnabled, registerNumbers, getTrackInfo, readEvents, readSummary, isAlreadyRegistered } from '@/lib/tracking'

function value(formData: FormData, key: string) {
  const raw = formData.get(key)
  return typeof raw === 'string' ? raw.trim() : ''
}

/** The day it happened, not the day it was typed. Falls back to today. */
function movementDate(formData: FormData) {
  return value(formData, 'movement_date') || new Date().toISOString().slice(0, 10)
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
/**
 * The tracking number on its own.
 *
 * Separate from the full edit form because the floor is allowed to add a tracking
 * number to a shipment they cannot otherwise touch. The database pins every other
 * column for anyone under manager, so this stays honest even if the form is faked.
 */
export async function setShipmentTracking(formData: FormData) {
  const { supabase } = await currentUser()
  const id = value(formData, 'id')
  const tracking = value(formData, 'tracking_number')
  const { error } = await supabase.from('purchase_orders')
    .update({ tracking_number: tracking || null })
    .eq('id', id)
  if (error) redirect('/shipments/' + id + '?error=' + encodeURIComponent(error.message))
  revalidatePath('/shipments')
  revalidatePath('/shipments/' + id)
  redirect('/shipments/' + id + '?notice=' + encodeURIComponent('Tracking number saved.'))
}

/**
 * The logistics of a shipment already booked.
 *
 * A shipping lead owns where a shipment is, when it is due, who is carrying it
 * and what its tracking number says - so they get a form with exactly those
 * fields. What was bought, from whom and for how much is purchasing's, and the
 * database pins those columns for anyone under manager, so this stays honest
 * even if someone posts the form by hand.
 */
export async function updateShipmentLogistics(formData: FormData) {
  const { supabase } = await currentUser()
  const perms = await getPermissions()
  const id = value(formData, 'id')
  if (!perms.canEditShipmentLogistics) {
    redirect('/shipments/' + id + '?error=' + encodeURIComponent('Your role cannot change shipment details.'))
  }
  const patch: Record<string, any> = {
    status: value(formData, 'status') || undefined,
    expected_date: value(formData, 'expected_date') || null,
    tracking_number: value(formData, 'tracking_number') || null,
    carrier_name: value(formData, 'carrier_name') || null,
    notes: value(formData, 'notes') || null,
  }
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k]
  const { error } = await supabase.from('purchase_orders').update(patch).eq('id', id)
  if (error) redirect('/shipments/' + id + '?error=' + encodeURIComponent(error.message))
  revalidatePath('/shipments')
  revalidatePath('/shipments/' + id)
  revalidatePath('/receiving')
  redirect('/shipments/' + id + '?notice=' + encodeURIComponent('Shipment details saved.'))
}

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

/**
 * Receive a whole shipment in one go, part by part.
 *
 * Receiving used to be one line at a time through a picker, which meant a
 * five-part delivery was five separate confirmations and no view of what was
 * actually meant to be in the box. Here every outstanding line of the shipment
 * is on screen with what was ordered, and good / damaged / missing are typed
 * next to each one.
 *
 * Damaged units never enter stock. Only the good quantity creates a stock
 * movement; the damaged quantity is written to the damage report against the
 * supplier and closes out the ordered line, so the shipment can be marked
 * complete without ever counting units you cannot use.
 */
export async function resolveMissingReceipt(formData: FormData) {
  const { supabase } = await currentUser()
  const eventId = value(formData, 'receiving_event_id')
  const resolution = value(formData, 'resolution')
  const { error } = await supabase.rpc('resolve_missing_receipt', { p_event_id: eventId, p_resolution: resolution })
  if (error) redirect('/receiving?error=' + encodeURIComponent(error.message))
  revalidatePath('/receiving')
  revalidatePath('/parts')
  redirect('/receiving?notice=' + encodeURIComponent(resolution === 'received' ? 'Missing units received into stock.' : 'Missing units marked as won’t arrive.'))
}

export async function receiveShipmentLines(formData: FormData) {
  const { supabase, userId } = await currentUser()
  const poId = value(formData, 'purchase_order_id')
  const token = value(formData, 'idempotency_key')
  const notes = value(formData, 'notes') || null

  const numbers = (key: string) => formData.getAll(key).map((raw) => {
    const parsed = Number(String(raw).trim())
    return Number.isFinite(parsed) ? parsed : 0
  })

  const ids = formData.getAll('item_id').map((raw) => String(raw))
  const received = numbers('quantity_received')
  const damaged = numbers('quantity_damaged')
  const missing = numbers('quantity_missing')

  const back = (key: string, message: string) =>
    '/receiving?po=' + encodeURIComponent(poId) + '&' + key + '=' + encodeURIComponent(message)

  // One date for the whole delivery: it all turned up together.
  const when = movementDate(formData)

  let done = 0
  for (let i = 0; i < ids.length; i++) {
    const total = (received[i] || 0) + (damaged[i] || 0) + (missing[i] || 0)
    // A line nobody typed into is simply not part of this delivery.
    if (total <= 0) continue

    const { error } = await supabase.rpc('receive_po_item', {
      p_item_id: ids[i],
      p_qty_received: received[i] || 0,
      p_qty_damaged: damaged[i] || 0,
      p_qty_missing: missing[i] || 0,
      p_notes: notes,
      p_user: userId,
      // One token per line, derived from the form's token, so a double-click
      // replays the same receipt instead of adding the delivery twice.
      p_idempotency_key: token ? token + ':' + ids[i] : null,
      p_movement_date: when,
    })
    if (error) redirect(back('error', error.message))
    done++
  }

  if (done === 0) redirect(back('error', 'Enter a quantity against at least one part.'))

  revalidateShipments(poId)
  revalidatePath('/parts')
  revalidatePath('/damage')
  redirect(back('notice', done + ' part line(s) received'))
}

/**
 * Take back a receiving that was entered wrong.
 *
 * The database does the whole reversal in one transaction - stock, damage
 * report and the quantity closed out on the shipment line - because undoing
 * only part of it would leave the line looking accounted for and the shipment
 * would never ask to be received again.
 */
export async function undoReceivingEvent(formData: FormData) {
  const { supabase, userId } = await currentUser()
  const eventId = value(formData, 'event_id')
  const poId = value(formData, 'purchase_order_id')

  const { error } = await supabase.rpc('undo_receiving_event', {
    p_event_id: eventId,
    p_user: userId,
  })
  if (error) redirect('/receiving?error=' + encodeURIComponent(error.message))

  revalidateShipments(poId)
  revalidatePath('/parts')
  revalidatePath('/damage')
  redirect('/receiving?notice=' + encodeURIComponent('That receiving was undone'))
}

/**
 * Correct a receiving that was entered wrong.
 *
 * Deliberately an undo followed by a fresh receipt rather than an in-place
 * edit: the quantities have to be re-checked against what is still outstanding
 * on the line, and the stock movement has to be rebuilt anyway. Doing it as two
 * known-good operations is safer than a second code path that has to get all
 * the same arithmetic right.
 */
export async function editReceivingEvent(formData: FormData) {
  const { supabase, userId } = await currentUser()
  const eventId = value(formData, 'event_id')
  const poId = value(formData, 'purchase_order_id')
  const itemId = value(formData, 'purchase_order_item_id')

  const numberAt = (key: string) => {
    const parsed = Number(value(formData, key))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  const received = numberAt('quantity_received')
  const damaged = numberAt('quantity_damaged')
  const missing = numberAt('quantity_missing')

  const fail = (message: string) =>
    redirect('/receiving?error=' + encodeURIComponent(message))

  if (received + damaged + missing <= 0) fail('Enter at least one quantity, or use Undo to remove the receipt entirely.')

  const { error: undoError } = await supabase.rpc('undo_receiving_event', {
    p_event_id: eventId,
    p_user: userId,
  })
  if (undoError) fail(undoError.message)

  const { error } = await supabase.rpc('receive_po_item', {
    p_item_id: itemId,
    p_qty_received: received,
    p_qty_damaged: damaged,
    p_qty_missing: missing,
    p_notes: value(formData, 'notes') || null,
    p_user: userId,
    // A new key: this is a different receipt from the one just undone, and
    // reusing the old key would make the database replay rather than record it.
    p_idempotency_key: null,
    p_movement_date: movementDate(formData),
  })
  // The original is already gone at this point, so a failure here has to be
  // loud rather than silent.
  if (error) fail('The correction could not be saved and the original receipt was removed: ' + error.message)

  revalidateShipments(poId)
  revalidatePath('/parts')
  revalidatePath('/damage')
  redirect('/receiving?notice=' + encodeURIComponent('Receiving corrected'))
}

/**
 * Another supplier packed into the same shipment.
 *
 * Kept as a plain list against the shipment rather than against each part
 * line: when a container comes from three factories you want to know who is on
 * it, not to attribute every sheet to one of them.
 */
export async function addShipmentSupplier(formData: FormData) {
  const { supabase, userId } = await currentUser()
  const poId = value(formData, 'purchase_order_id')
  const supplierId = value(formData, 'supplier_id')
  if (!poId || !supplierId) return

  // Already on the shipment, or the main supplier - either way, nothing to do.
  const { error } = await supabase
    .from('purchase_order_suppliers')
    .upsert({ purchase_order_id: poId, supplier_id: supplierId, created_by: userId },
            { onConflict: 'purchase_order_id,supplier_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  revalidateShipments(poId)
}

export async function removeShipmentSupplier(formData: FormData) {
  const { supabase } = await currentUser()
  const poId = value(formData, 'purchase_order_id')
  const rowId = value(formData, 'row_id')
  const { error } = await supabase.from('purchase_order_suppliers').delete().eq('id', rowId)
  if (error) throw new Error(error.message)
  revalidateShipments(poId)
}
