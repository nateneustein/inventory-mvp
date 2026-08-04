'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function value(formData: FormData, key: string) {
  const raw = formData.get(key)
  return typeof raw === 'string' ? raw.trim() : ''
}

function num(formData: FormData, key: string, fallback = 0) {
  const raw = value(formData, key)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function weekStartSundayFromDate(dateText: string | null) {
  if (!dateText) return null
  const d = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

async function currentUserId() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { supabase, userId: user.id }
}

function back(formData: FormData, fallback: string) {
  return value(formData, 'redirect_to') || fallback
}

export async function deletePart(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('parts').delete().eq('id', id)
  if (error) redirect(`/parts?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect('/parts?notice=Part%20deleted')
}

export async function deleteProduct(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) redirect(`/products?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/products')
  redirect('/products?notice=Product%20deleted')
}

export async function deleteVariation(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('product_variations').delete().eq('id', id)
  if (error) redirect(`/products?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/products')
  revalidatePath('/boms')
  redirect('/products?notice=Variation%20deleted')
}

export async function updateInventoryMovement(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/adjustments')

  const { data: original, error: readError } = await supabase
    .from('inventory_movements')
    .select('id, part_id, quantity, movement_type, movement_date, reason, notes, source_type, source_id')
    .eq('id', id)
    .single()
  if (readError || !original) redirect(`${goBack}?error=${encodeURIComponent(readError?.message || 'That entry no longer exists.')}`)

  const newQty = num(formData, 'quantity', Number(original.quantity))
  const newDate = value(formData, 'movement_date') || original.movement_date
  const newReason = value(formData, 'reason') || original.reason
  const newNotes = value(formData, 'notes') || null
  const newPartId = value(formData, 'part_id') || original.part_id

  const oldQty = Number(original.quantity)
  const partChanged = newPartId !== original.part_id
  const qtyChanged = newQty !== oldQty

  // Wording, dates and notes are safe to change in place -- they do not move stock.
  const { error: metaError } = await supabase
    .from('inventory_movements')
    .update({ movement_date: newDate, reason: newReason, notes: newNotes, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (metaError) redirect(`${goBack}?error=${encodeURIComponent(metaError.message)}`)

  // Quantity is different. Rather than overwrite the original -- which would
  // leave the shipment/damage record it came from disagreeing with stock, and
  // no sign anything had been changed -- write a correction line so the history
  // stays readable and the totals still come out right.
  const corrections: any[] = []
  if (qtyChanged && !partChanged) {
    const delta = newQty - oldQty
    if (delta !== 0) {
      corrections.push({
        part_id: original.part_id,
        movement_type: 'manual_adjustment',
        quantity: delta,
        source_type: 'movement_correction',
        source_id: original.id,
        reason: `Correction: entry changed from ${oldQty} to ${newQty}`,
        notes: newNotes,
        movement_date: newDate,
        created_by: userId,
      })
    }
  }

  // The part itself was wrong: give the original part its quantity back and
  // book the same quantity against the part that should have been used.
  if (partChanged) {
    corrections.push({
      part_id: original.part_id,
      movement_type: 'manual_adjustment',
      quantity: -oldQty,
      source_type: 'movement_correction',
      source_id: original.id,
      reason: 'Correction: entry was recorded against the wrong part',
      notes: newNotes,
      movement_date: newDate,
      created_by: userId,
    })
    corrections.push({
      part_id: newPartId,
      movement_type: 'manual_adjustment',
      quantity: newQty,
      source_type: 'movement_correction',
      source_id: original.id,
      reason: 'Correction: moved here from the wrong part',
      notes: newNotes,
      movement_date: newDate,
      created_by: userId,
    })
  }

  if (corrections.length) {
    const { error: corrError } = await supabase.from('inventory_movements').insert(corrections)
    if (corrError) redirect(`${goBack}?error=${encodeURIComponent(corrError.message)}`)
  }

  // Keep the record this came from in step with the new number.
  if (qtyChanged && !partChanged && original.source_type === 'receiving_event' && original.source_id) {
    await supabase.from('receiving_events').update({ quantity_received: newQty }).eq('id', original.source_id)
  }
  if (qtyChanged && !partChanged && original.source_type === 'damage_report' && original.source_id) {
    await supabase.from('damage_reports').update({ quantity: Math.abs(newQty), updated_at: new Date().toISOString() }).eq('id', original.source_id)
  }

  revalidatePath('/adjustments')
  revalidatePath('/parts')
  revalidatePath('/usage')
  revalidatePath('/receiving')
  revalidatePath('/damage')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=${encodeURIComponent(corrections.length ? 'Saved. A correction line was added so the change is visible in the history.' : 'Saved.')}`)
}

export async function archiveInventoryMovement(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/adjustments')
  const archive = value(formData, 'archive') !== 'false'
  const { error } = await supabase.from('inventory_movements').update({
    archived_at: archive ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/adjustments')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=Inventory%20movement%20archived`)
}

export async function deleteInventoryMovement(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/adjustments')
  const { error } = await supabase.from('inventory_movements').delete().eq('id', id)
  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/adjustments')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=Inventory%20movement%20deleted`)
}

export async function updateManualUnitsSold(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/usage')
  const variationId = value(formData, 'variation_id')
  const qty = num(formData, 'quantity', 0)
  const saleDate = value(formData, 'sale_date') || new Date().toISOString().slice(0, 10)
  const notes = value(formData, 'notes') || null

  if (!variationId) redirect(`${goBack}?error=${encodeURIComponent('Choose a finished product / variation.')}`)
  if (qty <= 0) redirect(`${goBack}?error=${encodeURIComponent('Quantity must be above zero.')}`)

  const { data: bomItems, error: bomError } = await supabase
    .from('bom_items')
    .select('part_id, quantity_per_unit')
    .eq('variation_id', variationId)
  if (bomError) redirect(`${goBack}?error=${encodeURIComponent(bomError.message)}`)
  if (!bomItems || bomItems.length === 0) redirect(`${goBack}?error=${encodeURIComponent('This variation has no BOM yet. Add the BOM first.')}`)

  const { error: saleError } = await supabase.from('manual_units_sold').update({
    variation_id: variationId,
    quantity: qty,
    sale_date: saleDate,
    week_start: weekStartSundayFromDate(saleDate),
    order_reference: value(formData, 'order_reference') || null,
    reason: value(formData, 'reason') || 'bulk_order_manual_entry',
    notes,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (saleError) redirect(`${goBack}?error=${encodeURIComponent(saleError.message)}`)

  await supabase.from('inventory_movements').delete().eq('source_type', 'manual_units_sold').eq('source_id', id)

  const movements = (bomItems || []).map((item: any) => ({
    part_id: item.part_id,
    movement_type: 'order_consumption',
    quantity: -Number(item.quantity_per_unit) * qty,
    source_type: 'manual_units_sold',
    source_id: id,
    reason: 'Manual units sold / produced entry',
    notes,
    created_by: userId,
    movement_date: saleDate,
  }))
  const { error: movementError } = await supabase.from('inventory_movements').insert(movements)
  if (movementError) redirect(`${goBack}?error=${encodeURIComponent(movementError.message)}`)

  revalidatePath('/usage')
  revalidatePath('/adjustments')
  revalidatePath('/predictions/basic')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=Manual%20sold%2Fproduced%20entry%20updated`)
}

export async function archiveManualUnitsSold(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/usage')
  const archive = value(formData, 'archive') !== 'false'
  const archivedAt = archive ? new Date().toISOString() : null

  const { error: saleError } = await supabase.from('manual_units_sold').update({
    archived_at: archivedAt,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (saleError) redirect(`${goBack}?error=${encodeURIComponent(saleError.message)}`)

  const { error: movementError } = await supabase.from('inventory_movements').update({
    archived_at: archivedAt,
    updated_at: new Date().toISOString(),
  }).eq('source_type', 'manual_units_sold').eq('source_id', id)
  if (movementError) redirect(`${goBack}?error=${encodeURIComponent(movementError.message)}`)

  revalidatePath('/usage')
  revalidatePath('/adjustments')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=Manual%20entry%20archived`)
}

export async function deleteManualUnitsSold(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/usage')
  await supabase.from('inventory_movements').delete().eq('source_type', 'manual_units_sold').eq('source_id', id)
  const { error } = await supabase.from('manual_units_sold').delete().eq('id', id)
  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/usage')
  revalidatePath('/adjustments')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=Manual%20entry%20deleted`)
}

export async function deleteZeroStockReport(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')

  /* A report on an untracked part moves the stock, so deleting the report has
     to move it back. Anything else and a mis-tapped report leaves a number
     nobody can explain. Tracked parts never wrote a movement, so this is a
     no-op for them. */
  const { error: undoError } = await supabase
    .from('inventory_movements')
    .delete()
    .eq('source_type', 'zero_stock_report')
    .eq('source_id', id)
  if (undoError) redirect(`/zero?error=${encodeURIComponent(undoError.message)}`)

  const { error } = await supabase.from('zero_stock_reports').delete().eq('id', id)
  if (error) redirect(`/zero?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/zero')
  revalidatePath('/reorder')
  revalidatePath('/reports')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect('/zero?notice=Report%20deleted%20and%20any%20stock%20it%20moved%20put%20back')
}


/**
 * Damage reports had no way to be corrected. If somebody typed 500 instead of
 * 50 the only remedy was to edit the stock movement, which left the damage
 * register still claiming 500 -- so month-end scrap totals disagreed with
 * stock. These keep the two in step.
 */
export async function updateDamageReport(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/damage')

  const { data: report, error: readError } = await supabase
    .from('damage_reports')
    .select('id, part_id, quantity, reason, reduced_stock, order_reference, notes')
    .eq('id', id)
    .single()
  if (readError || !report) redirect(`${goBack}?error=${encodeURIComponent(readError?.message || 'That damage report no longer exists.')}`)

  const newQty = num(formData, 'quantity', Number(report.quantity))
  if (newQty <= 0) redirect(`${goBack}?error=${encodeURIComponent('Damage quantity must be above zero.')}`)

  const { error: updateError } = await supabase.from('damage_reports').update({
    quantity: newQty,
    reason: value(formData, 'reason') || report.reason,
    order_reference: value(formData, 'order_reference') || null,
    notes: value(formData, 'notes') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (updateError) redirect(`${goBack}?error=${encodeURIComponent(updateError.message)}`)

  // Only damage that actually took stock out needs a stock correction.
  // Damaged-on-arrival was never added to stock, so there is nothing to correct.
  if (report.reduced_stock) {
    const delta = Number(report.quantity) - newQty
    if (delta !== 0) {
      const { error: moveError } = await supabase.from('inventory_movements').insert({
        part_id: report.part_id,
        movement_type: 'manual_adjustment',
        quantity: delta,
        source_type: 'damage_report_correction',
        source_id: report.id,
        reason: `Correction: damage report changed from ${report.quantity} to ${newQty}`,
        notes: value(formData, 'notes') || null,
        created_by: userId,
      })
      if (moveError) redirect(`${goBack}?error=${encodeURIComponent(moveError.message)}`)
    }
  }

  revalidatePath('/damage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=${encodeURIComponent('Damage report updated.')}`)
}

export async function deleteDamageReport(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/damage')

  const { data: report } = await supabase
    .from('damage_reports')
    .select('id, part_id, quantity, reduced_stock')
    .eq('id', id)
    .single()

  // Put the stock back before removing the report, otherwise deleting a damage
  // entry would silently leave the units missing from inventory forever.
  if (report?.reduced_stock && Number(report.quantity) > 0) {
    await supabase.from('inventory_movements').insert({
      part_id: report.part_id,
      movement_type: 'manual_adjustment',
      quantity: Number(report.quantity),
      source_type: 'damage_report_correction',
      source_id: report.id,
      reason: 'Damage report removed, stock returned',
      created_by: userId,
    })
  }

  await supabase.from('inventory_movements').delete().eq('source_type', 'damage_report').eq('source_id', id)
  const { error } = await supabase.from('damage_reports').delete().eq('id', id)
  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/damage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=${encodeURIComponent('Damage report deleted.')}`)
}


/**
 * Role management. Admin only -- the database also refuses these writes to
 * anyone else, so this check is for a clear message rather than for safety.
 */
export async function updateUserRole(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const role = value(formData, 'role')
  const goBack = back(formData, '/users')

  if (!['admin', 'manager', 'production_associate'].includes(role)) {
    redirect(`${goBack}?error=${encodeURIComponent('That is not a valid role.')}`)
  }
  if (id === userId) {
    redirect(`${goBack}?error=${encodeURIComponent('You cannot change your own role. Another admin has to do it.')}`)
  }

  const { error } = await supabase.from('profiles').update({
    role,
    full_name: value(formData, 'full_name') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/users')
  redirect(`${goBack}?notice=${encodeURIComponent('Role updated.')}`)
}

export async function setUserActive(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const active = value(formData, 'active') === 'true'
  const goBack = back(formData, '/users')

  if (id === userId) {
    redirect(`${goBack}?error=${encodeURIComponent('You cannot disable your own account.')}`)
  }

  const { error } = await supabase.from('profiles')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/users')
  redirect(`${goBack}?notice=${encodeURIComponent(active ? 'Access re-enabled.' : 'Access disabled. They can still sign in but cannot see or change anything.')}`)
}
