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

async function currentUserId() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const email = value(formData, 'email')
  const password = value(formData, 'password')

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  redirect('/dashboard')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function createSupplier(formData: FormData) {
  const { supabase, userId } = await currentUserId()

  const { error } = await supabase.from('suppliers').insert({
    name: value(formData, 'name'),
    contact_name: value(formData, 'contact_name') || null,
    email: value(formData, 'email') || null,
    phone: value(formData, 'phone') || null,
    website: value(formData, 'website') || null,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/suppliers')
}

export async function createPart(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const supplierId = value(formData, 'supplier_id') || null

  const { error } = await supabase.from('parts').insert({
    name: value(formData, 'name'),
    sku: value(formData, 'sku'),
    category: value(formData, 'category') || null,
    supplier_id: supplierId,
    supplier_part_number: value(formData, 'supplier_part_number') || null,
    unit: value(formData, 'unit') || 'each',
    lead_time_days_min: num(formData, 'lead_time_days_min', 0),
    lead_time_days_max: num(formData, 'lead_time_days_max', 0),
    safety_stock_days: num(formData, 'safety_stock_days', 30),
    reorder_point: num(formData, 'reorder_point', 0),
    target_stock: num(formData, 'target_stock', 0),
    default_order_quantity: num(formData, 'default_order_quantity', 0),
    critical: value(formData, 'critical') === 'on',
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function createProduct(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const { error } = await supabase.from('products').insert({
    name: value(formData, 'name'),
    sku: value(formData, 'sku') || null,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/products')
}

export async function createVariation(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const { error } = await supabase.from('product_variations').insert({
    product_id: value(formData, 'product_id'),
    variation_name: value(formData, 'variation_name'),
    internal_sku: value(formData, 'internal_sku'),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/products')
  revalidatePath('/boms')
}

export async function createBomItem(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const { error } = await supabase.from('bom_items').insert({
    variation_id: value(formData, 'variation_id'),
    part_id: value(formData, 'part_id'),
    quantity_per_unit: num(formData, 'quantity_per_unit', 1),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/boms')
}

export async function createPurchaseOrder(formData: FormData) {
  const { supabase, userId } = await currentUserId()

  const { error } = await supabase.from('purchase_orders').insert({
    po_number: value(formData, 'po_number'),
    supplier_id: value(formData, 'supplier_id'),
    status: value(formData, 'status') || 'ordered',
    order_date: value(formData, 'order_date') || null,
    expected_date: value(formData, 'expected_date') || null,
    tracking_number: value(formData, 'tracking_number') || null,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/purchase-orders')
  revalidatePath('/dashboard')
}

export async function addPurchaseOrderItem(formData: FormData) {
  const { supabase, userId } = await currentUserId()

  const { error } = await supabase.from('purchase_order_items').insert({
    purchase_order_id: value(formData, 'purchase_order_id'),
    part_id: value(formData, 'part_id'),
    quantity_ordered: num(formData, 'quantity_ordered', 0),
    unit_cost: num(formData, 'unit_cost', 0),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/purchase-orders')
  revalidatePath('/receiving')
  revalidatePath('/dashboard')
}

export async function updatePurchaseOrderStatus(formData: FormData) {
  const { supabase } = await currentUserId()
  const { error } = await supabase
    .from('purchase_orders')
    .update({
      status: value(formData, 'status'),
      expected_date: value(formData, 'expected_date') || null,
      tracking_number: value(formData, 'tracking_number') || null,
    })
    .eq('id', value(formData, 'purchase_order_id'))

  if (error) throw new Error(error.message)
  revalidatePath('/purchase-orders')
  revalidatePath('/receiving')
  revalidatePath('/dashboard')
}

export async function receivePurchaseOrderItem(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const itemId = value(formData, 'purchase_order_item_id')
  const qtyReceived = num(formData, 'quantity_received', 0)
  const qtyDamaged = num(formData, 'quantity_damaged', 0)
  const qtyMissing = num(formData, 'quantity_missing', 0)

  if (qtyReceived <= 0 && qtyDamaged <= 0 && qtyMissing <= 0) {
    throw new Error('Enter at least one quantity.')
  }

  const { data: item, error: itemError } = await supabase
    .from('purchase_order_items')
    .select('id, purchase_order_id, part_id, quantity_received')
    .eq('id', itemId)
    .single()

  if (itemError || !item) throw new Error(itemError?.message || 'PO item not found')

  const { error: receiveError } = await supabase.from('receiving_events').insert({
    purchase_order_id: item.purchase_order_id,
    purchase_order_item_id: item.id,
    part_id: item.part_id,
    quantity_received: qtyReceived,
    quantity_damaged: qtyDamaged,
    quantity_missing: qtyMissing,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (receiveError) throw new Error(receiveError.message)

  if (qtyReceived > 0) {
    const { error: movementError } = await supabase.from('inventory_movements').insert({
      part_id: item.part_id,
      movement_type: 'supplier_received',
      quantity: qtyReceived,
      source_type: 'purchase_order_item',
      source_id: item.id,
      reason: 'Shipment received and confirmed by warehouse',
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
    if (movementError) throw new Error(movementError.message)
  }

  const { error: updateError } = await supabase
    .from('purchase_order_items')
    .update({ quantity_received: Number(item.quantity_received || 0) + qtyReceived })
    .eq('id', item.id)

  if (updateError) throw new Error(updateError.message)
  revalidatePath('/receiving')
  revalidatePath('/purchase-orders')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function reportDamage(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const qty = num(formData, 'quantity', 0)
  if (qty <= 0) throw new Error('Damage quantity must be above zero.')

  const { data: report, error: reportError } = await supabase
    .from('damage_reports')
    .insert({
      part_id: partId,
      quantity: qty,
      reason: value(formData, 'reason'),
      order_reference: value(formData, 'order_reference') || null,
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
    .select('id')
    .single()

  if (reportError || !report) throw new Error(reportError?.message || 'Could not create damage report')

  const { error: movementError } = await supabase.from('inventory_movements').insert({
    part_id: partId,
    movement_type: 'damage',
    quantity: -qty,
    source_type: 'damage_report',
    source_id: report.id,
    reason: value(formData, 'reason'),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })

  if (movementError) throw new Error(movementError.message)
  revalidatePath('/damage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function createReplacementOrder(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const variationId = value(formData, 'variation_id')
  const qty = num(formData, 'quantity', 1)
  if (qty <= 0) throw new Error('Quantity must be above zero.')

  const { data: replacement, error: replacementError } = await supabase
    .from('replacement_orders')
    .insert({
      original_order_reference: value(formData, 'original_order_reference') || null,
      variation_id: variationId,
      quantity: qty,
      reason: value(formData, 'reason'),
      approved_by: value(formData, 'approved_by') || null,
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
    .select('id')
    .single()

  if (replacementError || !replacement) throw new Error(replacementError?.message || 'Could not create replacement')

  const { data: bomItems, error: bomError } = await supabase
    .from('bom_items')
    .select('part_id, quantity_per_unit')
    .eq('variation_id', variationId)

  if (bomError) throw new Error(bomError.message)

  if (!bomItems || bomItems.length === 0) {
    throw new Error('This variation has no BOM items yet. Add the BOM first.')
  }

  const movements = bomItems.map((item) => ({
    part_id: item.part_id,
    movement_type: 'replacement_order',
    quantity: -Number(item.quantity_per_unit) * qty,
    source_type: 'replacement_order',
    source_id: replacement.id,
    reason: value(formData, 'reason'),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  }))

  const { error: movementError } = await supabase.from('inventory_movements').insert(movements)
  if (movementError) throw new Error(movementError.message)

  revalidatePath('/replacements')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function createCycleCount(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const countedQty = num(formData, 'counted_quantity', 0)

  const { data: stockRow, error: stockError } = await supabase
    .from('part_stock')
    .select('on_hand')
    .eq('part_id', partId)
    .single()

  if (stockError && stockError.code !== 'PGRST116') throw new Error(stockError.message)
  const systemQty = Number(stockRow?.on_hand || 0)
  const difference = countedQty - systemQty

  const { data: count, error: countError } = await supabase
    .from('cycle_counts')
    .insert({
      part_id: partId,
      counted_quantity: countedQty,
      system_quantity_at_count: systemQty,
      difference,
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
    .select('id')
    .single()

  if (countError || !count) throw new Error(countError?.message || 'Could not create count')

  if (difference !== 0) {
    const { error: movementError } = await supabase.from('inventory_movements').insert({
      part_id: partId,
      movement_type: 'cycle_count_adjustment',
      quantity: difference,
      source_type: 'cycle_count',
      source_id: count.id,
      reason: 'Actual inventory count adjustment',
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
    if (movementError) throw new Error(movementError.message)
  }

  revalidatePath('/counts')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}
