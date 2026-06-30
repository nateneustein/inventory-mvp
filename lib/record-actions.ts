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
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const goBack = back(formData, '/adjustments')
  const { error } = await supabase.from('inventory_movements').update({
    part_id: value(formData, 'part_id'),
    movement_type: value(formData, 'movement_type'),
    quantity: num(formData, 'quantity', 0),
    movement_date: value(formData, 'movement_date') || null,
    reason: value(formData, 'reason') || 'Manual edit',
    notes: value(formData, 'notes') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) redirect(`${goBack}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/adjustments')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect(`${goBack}?notice=Inventory%20movement%20updated`)
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
  const { error } = await supabase.from('zero_stock_reports').delete().eq('id', id)
  if (error) redirect(`/zero?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/zero')
  revalidatePath('/reports')
  revalidatePath('/dashboard')
  redirect('/zero?notice=Zero%20report%20deleted')
}
