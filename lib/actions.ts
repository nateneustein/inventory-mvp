'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type CsvRow = Record<string, string>

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

function clean(raw: unknown) {
  return String(raw || '').trim().replace(/\t/g, '')
}

function numberFromText(raw: unknown, fallback = 0) {
  const parsed = Number(clean(raw).replace(/[$,]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

async function currentUserId() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { supabase, userId: user.id }
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++
      row.push(cell)
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  if (rows.length === 0) return []

  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim())
  return rows.slice(1).map((cells) => {
    const obj: CsvRow = {}
    headers.forEach((header, index) => {
      obj[header] = clean(cells[index] || '')
    })
    return obj
  })
}

function normalizeImportedRow(platform: string, row: CsvRow) {
  if (platform === 'etsy') {
    return {
      platform_order_id: clean(row['Order ID']),
      order_date: clean(row['Sale Date'] || row['Date Paid']),
      item_name: clean(row['Item Name']),
      platform_sku: clean(row['SKU']),
      variation_text: clean(row['Variations']),
      customization_text: clean(row['Personalization'] || row['Buyer Message'] || row['Notes']),
      quantity: numberFromText(row['Quantity'], 1),
      order_status: clean(row['Date Shipped']) ? 'shipped' : 'unshipped',
    }
  }

  if (platform === 'amazon') {
    return {
      platform_order_id: clean(row['amazon-order-id'] || row['merchant-order-id']),
      order_date: clean(row['purchase-date']),
      item_name: clean(row['product-name']),
      platform_sku: clean(row['sku']),
      variation_text: clean(row['asin']),
      customization_text: clean(row['customized-url'] || row['customized-page']),
      quantity: numberFromText(row['quantity'], 1),
      order_status: clean(row['order-status']),
    }
  }

  if (platform === 'tiktok') {
    return {
      platform_order_id: clean(row['Order ID']),
      order_date: clean(row['Created Time'] || row['Paid Time']),
      item_name: clean(row['Product Name']),
      platform_sku: clean(row['Seller SKU'] || row['SKU ID']),
      variation_text: clean(row['Variation']),
      customization_text: clean(row['Buyer Message'] || row['Seller Note']),
      quantity: numberFromText(row['Quantity'], 1),
      order_status: clean(row['Order Status'] || row['Order Substatus']),
    }
  }

  return {
    platform_order_id: clean(row['Id'] || row['Name']),
    order_date: clean(row['Created at'] || row['Paid at']),
    item_name: clean(row['Lineitem name']),
    platform_sku: clean(row['Lineitem sku']),
    variation_text: clean(row['Variant'] || row['Option'] || row['Lineitem name']),
    customization_text: clean(row['Notes'] || row['Note Attributes']),
    quantity: numberFromText(row['Lineitem quantity'], 1),
    order_status: clean(row['Fulfillment Status'] || row['Financial Status']),
  }
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

export async function importOrderCsv(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const platform = value(formData, 'platform')
  const accountName = value(formData, 'account_name') || platform
  const file = formData.get('file')

  if (!(file instanceof File)) throw new Error('Choose a CSV file first.')
  const text = await file.text()
  const parsedRows = parseCsv(text)
  if (parsedRows.length === 0) throw new Error('No rows found in CSV.')

  const { data: batch, error: batchError } = await supabase
    .from('upload_batches')
    .insert({
      platform,
      account_name: accountName,
      file_name: file.name,
      row_count: parsedRows.length,
      status: 'uploaded',
      created_by: userId,
    })
    .select('id')
    .single()

  if (batchError || !batch) throw new Error(batchError?.message || 'Could not create upload batch')

  const rowsToInsert = parsedRows.slice(0, 10000).map((row, index) => {
    const normalized = normalizeImportedRow(platform, row)
    return {
      upload_batch_id: batch.id,
      platform,
      account_name: accountName,
      source_row_number: index + 2,
      raw_data: row,
      mapping_status: 'unmapped',
      created_by: userId,
      ...normalized,
    }
  })

  const { error: rowsError } = await supabase.from('imported_order_rows').insert(rowsToInsert)
  if (rowsError) throw new Error(rowsError.message)

  revalidatePath('/uploads')
  revalidatePath('/imported-orders')
  redirect('/imported-orders')
}

export async function createMappingRule(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const { error } = await supabase.from('product_mapping_rules').insert({
    platform: value(formData, 'platform'),
    account_name: value(formData, 'account_name') || null,
    match_type: value(formData, 'match_type'),
    match_field: value(formData, 'match_field'),
    match_value: value(formData, 'match_value'),
    variation_id: value(formData, 'variation_id'),
    demand_variation_id: value(formData, 'demand_variation_id') || null,
    priority: num(formData, 'priority', 100),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/mapping-rules')
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
  revalidatePath('/shipments')
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
  revalidatePath('/shipments')
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
  revalidatePath('/shipments')
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
  revalidatePath('/shipments')
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
  if (!bomItems || bomItems.length === 0) throw new Error('This variation has no BOM items yet. Add the BOM first.')

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

export async function createManualAdjustment(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const qty = num(formData, 'quantity_change', 0)
  if (qty === 0) throw new Error('Adjustment cannot be zero.')

  const { error } = await supabase.from('inventory_movements').insert({
    part_id: partId,
    movement_type: 'manual_adjustment',
    quantity: qty,
    source_type: 'manual_adjustment',
    reason: value(formData, 'reason') || 'Manual adjustment',
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/adjustments')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function createInventorySwitch(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const fromPartId = value(formData, 'from_part_id')
  const toPartId = value(formData, 'to_part_id')
  const qty = num(formData, 'quantity', 0)
  if (qty <= 0) throw new Error('Quantity must be above zero.')

  const { data: switchRow, error: switchError } = await supabase
    .from('inventory_switches')
    .insert({
      from_part_id: fromPartId || null,
      to_part_id: toPartId,
      quantity: qty,
      change_type: value(formData, 'change_type'),
      order_reference: value(formData, 'order_reference') || null,
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
    .select('id')
    .single()

  if (switchError || !switchRow) throw new Error(switchError?.message || 'Could not create switch')

  const movementRows = []
  if (toPartId) {
    movementRows.push({
      part_id: toPartId,
      movement_type: 'manual_adjustment',
      quantity: -qty,
      source_type: 'inventory_switch',
      source_id: switchRow.id,
      reason: `Inventory switch used instead of original. ${value(formData, 'change_type')}`,
      notes: value(formData, 'notes') || null,
      created_by: userId,
    })
  }

  const { error: movementError } = await supabase.from('inventory_movements').insert(movementRows)
  if (movementError) throw new Error(movementError.message)
  revalidatePath('/adjustments')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function reportZeroStock(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const { data: stockRow } = await supabase.from('part_stock').select('on_hand').eq('part_id', partId).single()
  const systemQty = Number(stockRow?.on_hand || 0)

  const { error } = await supabase.from('zero_stock_reports').insert({
    part_id: partId,
    system_quantity_at_report: systemQty,
    warehouse_quantity_reported: 0,
    order_reference: value(formData, 'order_reference') || null,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)

  await supabase.from('notifications').insert({
    level: 'urgent',
    title: 'Warehouse reported zero stock',
    message: value(formData, 'notes') || 'A part was reported as physically out of stock.',
    source_type: 'zero_stock_report',
    created_by: userId,
  })

  revalidatePath('/zero')
  revalidatePath('/reports')
  revalidatePath('/dashboard')
}

export async function saveSlackSettings(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const { error } = await supabase.from('slack_notification_settings').insert({
    channel_name: value(formData, 'channel_name'),
    notify_low_stock: value(formData, 'notify_low_stock') === 'on',
    notify_overdue_shipments: value(formData, 'notify_overdue_shipments') === 'on',
    notify_zero_stock: value(formData, 'notify_zero_stock') === 'on',
    notes: value(formData, 'notes') || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/slack')
}

export async function sendTestSlackNotification() {
  const { supabase, userId } = await currentUserId()
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) throw new Error('Add SLACK_WEBHOOK_URL in Vercel environment variables first.')

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Test alert from Inventory MVP.' }),
  })

  await supabase.from('notifications').insert({
    level: response.ok ? 'info' : 'warning',
    title: response.ok ? 'Slack test sent' : 'Slack test failed',
    message: response.ok ? 'The Slack test message was sent.' : `Slack returned status ${response.status}.`,
    source_type: 'slack_test',
    created_by: userId,
  })

  if (!response.ok) throw new Error(`Slack returned status ${response.status}.`)
  revalidatePath('/slack')
  revalidatePath('/dashboard')
}
