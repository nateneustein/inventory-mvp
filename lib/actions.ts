'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { CONDITION_FIELDS, CONDITION_TYPES, conditionsOf, type RuleCondition } from '@/lib/rule-conditions'
import { today } from '@/lib/format'
import { refreshPredictionSnapshots } from '@/lib/part-detail-actions'
import { getPermissions, deniedUrl, getCurrentRole, homePathFor } from '@/lib/permissions'

type CsvRow = Record<string, string>

function value(formData: FormData, key: string) {
  const raw = formData.get(key)
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * The day a movement actually happened, not the day it was typed in.
 *
 * The weekly sheets are the backlog of everything, so a correction entered on
 * Monday for something that happened a fortnight ago has to land in that
 * fortnight-old week or the history quietly rewrites itself.
 */
function movementDate(formData: FormData, key = 'movement_date') {
  const raw = value(formData, key)
  return raw || today()
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

function parseDateValue(raw: unknown) {
  const text = clean(raw)
  if (!text) return null

  const mmddyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (mmddyy) {
    const month = Number(mmddyy[1])
    const day = Number(mmddyy[2])
    let year = Number(mmddyy[3])
    if (year < 100) year += 2000
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  const d = new Date(text)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function weekStartSundayFromDate(dateText: string | null) {
  if (!dateText) return null
  // Midday UTC so no server timezone can push this onto the wrong calendar day.
  const d = new Date(`${dateText}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

function compactKeyPart(raw: unknown) {
  return clean(raw).toLowerCase().replace(/\s+/g, ' ')
}

function joinKeyParts(parts: unknown[]) {
  return parts.map(compactKeyPart).join('|')
}

function lineKeyFromFallback(platform: string, normalized: any) {
  return `${platform}:fallback:${joinKeyParts([
    normalized.platform_order_id,
    normalized.platform_sku,
    normalized.item_name,
    normalized.variation_text,
    normalized.quantity,
    normalized.order_date_parsed || normalized.order_date,
  ])}`
}

function externalLineKeyFor(platform: string, row: CsvRow, normalized: any) {
  if (platform === 'etsy') {
    const transactionId = clean(row['Transaction ID'])
    if (transactionId) return { key: `etsy:transaction:${transactionId}`, source: 'Transaction ID' }
    return { key: lineKeyFromFallback(platform, normalized), source: 'fallback composite' }
  }

  if (platform === 'amazon') {
    const orderItemId = clean(row['order-item-id'])
    if (orderItemId) return { key: `amazon:order-item:${orderItemId}`, source: 'order-item-id' }
    return { key: lineKeyFromFallback(platform, normalized), source: 'fallback composite' }
  }

  if (platform === 'tiktok') {
    const orderId = clean(row['Order ID'])
    const skuId = clean(row['SKU ID'])
    if (orderId && skuId) return { key: `tiktok:order-sku:${joinKeyParts([orderId, skuId])}`, source: 'Order ID + SKU ID' }
    return { key: lineKeyFromFallback(platform, normalized), source: 'fallback composite' }
  }

  // Shopify CSV exports do not always include a true line-item id.
  // This composite catches overlapping uploads without blocking multi-quantity rows.
  const shopifyOrderId = clean(row['Id'] || row['Name'])
  return {
    key: `shopify:line:${joinKeyParts([
      shopifyOrderId || normalized.platform_order_id,
      row['Lineitem sku'] || normalized.platform_sku,
      row['Lineitem name'] || normalized.item_name,
      row['Lineitem quantity'] || normalized.quantity,
      row['Created at'] || normalized.order_date,
    ])}`,
    source: 'Order ID + line item composite',
  }
}

async function loadExistingLineKeys(supabase: any, platform: string, accountName: string, keys: string[]) {
  const existing = new Map<string, string>()
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))
  for (let i = 0; i < uniqueKeys.length; i += 500) {
    const chunk = uniqueKeys.slice(i, i + 500)
    const { data, error } = await supabase
      .from('imported_order_rows')
      .select('id, external_line_key')
      .eq('platform', platform)
      .eq('account_name', accountName)
      .in('external_line_key', chunk)
    if (error) throw new Error(error.message)
    for (const row of data || []) {
      if (row.external_line_key) existing.set(row.external_line_key, row.id)
    }
  }
  return existing
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
    const orderDate = clean(row['Sale Date'] || row['Date Paid'])
    const parsedDate = parseDateValue(orderDate)
    return {
      platform_order_id: clean(row['Order ID'] || row['Transaction ID']),
      order_date: orderDate,
      order_date_parsed: parsedDate,
      week_start: weekStartSundayFromDate(parsedDate),
      item_name: clean(row['Item Name']),
      platform_sku: clean(row['SKU']),
      variation_text: clean(row['Variations']),
      customization_text: clean(row['Personalization'] || row['Buyer Message'] || row['Notes']),
      quantity: numberFromText(row['Quantity'], 1),
      order_status: clean(row['Date Shipped']) ? 'shipped' : 'unshipped',
    }
  }

  if (platform === 'amazon') {
    const orderDate = clean(row['purchase-date'])
    const parsedDate = parseDateValue(orderDate)
    return {
      platform_order_id: clean(row['amazon-order-id'] || row['merchant-order-id']),
      order_date: orderDate,
      order_date_parsed: parsedDate,
      week_start: weekStartSundayFromDate(parsedDate),
      item_name: clean(row['product-name']),
      platform_sku: clean(row['sku']),
      variation_text: clean(row['asin']),
      customization_text: clean(row['customized-url'] || row['customized-page']),
      quantity: numberFromText(row['quantity'], 1),
      order_status: clean(row['order-status']),
    }
  }

  if (platform === 'tiktok') {
    const orderDate = clean(row['Created Time'] || row['Paid Time'])
    const parsedDate = parseDateValue(orderDate)
    return {
      platform_order_id: clean(row['Order ID']),
      order_date: orderDate,
      order_date_parsed: parsedDate,
      week_start: weekStartSundayFromDate(parsedDate),
      item_name: clean(row['Product Name']),
      platform_sku: clean(row['Seller SKU'] || row['SKU ID']),
      variation_text: clean(row['Variation']),
      customization_text: clean(row['Buyer Message'] || row['Seller Note']),
      quantity: numberFromText(row['Quantity'], 1),
      order_status: clean(row['Order Status'] || row['Order Substatus']),
    }
  }

  const orderDate = clean(row['Created at'] || row['Paid at'])
  const parsedDate = parseDateValue(orderDate)
  return {
    platform_order_id: clean(row['Id'] || row['Name']),
    order_date: orderDate,
    order_date_parsed: parsedDate,
    week_start: weekStartSundayFromDate(parsedDate),
    item_name: clean(row['Lineitem name']),
    platform_sku: clean(row['Lineitem sku']),
    variation_text: clean(row['Variant'] || row['Option'] || row['Lineitem name']),
    customization_text: clean(row['Notes'] || row['Note Attributes']),
    quantity: numberFromText(row['Lineitem quantity'], 1),
    order_status: clean(row['Fulfillment Status'] || row['Financial Status']),
  }
}

type MappingRule = {
  platform: string
  account_name: string | null
  // Kept in step with conditions[0] so anything still reading these columns
  // sees the same thing it always did.
  match_type: string
  match_field: string
  match_value: string
  conditions?: RuleCondition[] | null
  condition_logic?: string | null
  map_action?: string
  variation_id: string | null
  demand_variation_id: string | null
  priority: number
}

/** Columns every rule read needs, so the matcher always has the full picture. */
const MAPPING_RULE_COLUMNS =
  'platform, account_name, match_type, match_field, match_value, conditions, condition_logic, map_action, variation_id, demand_variation_id, priority'

function importedFieldValue(row: any, field: string) {
  if (field === 'sku') return clean(row.platform_sku)
  if (field === 'item_name') return clean(row.item_name)
  if (field === 'variation') return clean(row.variation_text)
  if (field === 'customization') return clean(row.customization_text)
  return ''
}

function conditionMatchesImportedRow(condition: RuleCondition, row: any) {
  const haystack = importedFieldValue(row, condition.field).toLowerCase()
  const needle = clean(condition.value).toLowerCase()
  if (!needle) return false
  if (condition.type === 'equals') return haystack === needle
  if (condition.type === 'starts_with') return haystack.startsWith(needle)
  return haystack.includes(needle)
}

function ruleMatchesImportedRow(rule: MappingRule, row: any) {
  if (rule.platform !== 'all' && rule.platform !== row.platform) return false
  if (rule.account_name && rule.account_name !== row.account_name) return false

  const conditions = conditionsOf(rule)
  // A rule with nothing to test would otherwise match every row and quietly
  // remap the whole upload.
  if (conditions.length === 0) return false

  return rule.condition_logic === 'any'
    ? conditions.some((c) => conditionMatchesImportedRow(c, row))
    : conditions.every((c) => conditionMatchesImportedRow(c, row))
}

function applyMappingRules(row: any, rules: MappingRule[]) {
  const rule = rules.find((r) => ruleMatchesImportedRow(r, row))
  if (!rule) return row
  if ((rule.map_action || 'map') === 'ignore') {
    return { ...row, mapping_status: 'ignored', mapped_variation_id: null, demand_variation_id: null }
  }
  return {
    ...row,
    mapping_status: 'mapped',
    mapped_variation_id: rule.variation_id,
    demand_variation_id: rule.demand_variation_id || rule.variation_id,
  }
}


export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const email = value(formData, 'email')
  const password = value(formData, 'password')

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  /* Not everyone is allowed on the dashboard any more, so ask where this
     person belongs rather than sending them all to the same locked door. */
  redirect(homePathFor(await getCurrentRole()))
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

  const { data: rules } = await supabase
    .from('product_mapping_rules')
    .select(MAPPING_RULE_COLUMNS)
    .eq('active', true)
    .order('priority')

  const normalizedRows = parsedRows.slice(0, 10000).map((row, index) => {
    const normalized = normalizeImportedRow(platform, row)
    const lineKey = externalLineKeyFor(platform, row, normalized)
    return { row, index, normalized, lineKey }
  })

  const seenLineKeys = await loadExistingLineKeys(
    supabase,
    platform,
    accountName,
    normalizedRows.map((r) => r.lineKey.key),
  )

  const rowsToInsert = normalizedRows.map(({ row, index, normalized, lineKey }) => {
    const rowId = randomUUID()
    const duplicateOf = seenLineKeys.get(lineKey.key) || null
    const isDuplicate = Boolean(duplicateOf)

    const baseRow = {
      id: rowId,
      upload_batch_id: batch.id,
      platform,
      account_name: accountName,
      source_row_number: index + 2,
      raw_data: row,
      external_line_key: lineKey.key,
      external_line_key_source: lineKey.source,
      dedupe_status: isDuplicate ? 'duplicate' : 'new',
      duplicate_of_row_id: duplicateOf,
      mapping_status: isDuplicate ? 'ignored' : 'unmapped',
      mapped_variation_id: null,
      demand_variation_id: null,
      created_by: userId,
      ...normalized,
    }

    // Mark the first copy in this upload as the real row so later rows in the same file do not count again.
    if (!isDuplicate) seenLineKeys.set(lineKey.key, rowId)

    return isDuplicate ? baseRow : applyMappingRules(baseRow, (rules || []) as MappingRule[])
  })

  const { error: rowsError } = await supabase.from('imported_order_rows').insert(rowsToInsert)
  if (rowsError) throw new Error(rowsError.message)

  // Rows that matched a mapping rule are already 'mapped' at this point, so they
  // consume their BOM parts straight away -- uploading an order file is what
  // makes stock go down. Duplicates, unmapped rows and cancelled/refunded lines
  // are skipped, and a unique index means re-uploading the same file cannot
  // consume twice.
  await postImportedOrdersToInventory()

  revalidatePath('/uploads')
  revalidatePath('/imported-orders')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect('/imported-orders')
}

/**
 * Read the condition list off the form.
 *
 * The builder posts the whole list as one JSON blob. Anything malformed, or a
 * condition with an empty value, is dropped rather than saved — a rule with a
 * blank condition would match nothing useful and is almost always a slip.
 */
function conditionsFromForm(formData: FormData): RuleCondition[] {
  const raw = value(formData, 'conditions_json')
  let parsed: any = []
  if (raw) {
    try { parsed = JSON.parse(raw) } catch { parsed = [] }
  }
  if (!Array.isArray(parsed)) parsed = []

  const cleaned: RuleCondition[] = []
  for (const c of parsed) {
    if (!c || typeof c !== 'object') continue
    const v = clean(c.value)
    if (!v) continue
    cleaned.push({
      field: CONDITION_FIELDS.some(f => f[0] === c.field) ? c.field : 'sku',
      type: CONDITION_TYPES.some(t => t[0] === c.type) ? c.type : 'contains',
      value: v,
    })
  }

  // Falls back to the old single-field inputs so an older cached page, or a
  // form submitted with JavaScript unavailable, still saves a working rule.
  if (cleaned.length === 0) {
    const legacy = value(formData, 'match_value')
    if (legacy) {
      cleaned.push({
        field: value(formData, 'match_field') || 'sku',
        type: value(formData, 'match_type') || 'contains',
        value: legacy,
      })
    }
  }
  return cleaned
}

function conditionLogicFromForm(formData: FormData) {
  return value(formData, 'condition_logic') === 'any' ? 'any' : 'all'
}

export async function createMappingRule(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canUploadOrders) redirect(deniedUrl('/mapping-rules', 'add a mapping rule'))
  const mapAction = value(formData, 'map_action') || 'map'
  const variationId = value(formData, 'variation_id') || null
  const conditions = conditionsFromForm(formData)

  if (conditions.length === 0) {
    redirect('/mapping-rules?error=' + encodeURIComponent('Add at least one condition with something to match on.'))
  }
  if (mapAction === 'map' && !variationId) {
    redirect('/mapping-rules?error=' + encodeURIComponent('Choose a variation, or choose Ignore / void line.'))
  }

  const payload = {
    platform: (value(formData, 'platform') || 'all').toLowerCase(),
    account_name: value(formData, 'account_name') || null,
    // The match_* columns mirror the first condition so older readers keep working.
    match_type: conditions[0].type,
    match_field: conditions[0].field,
    match_value: conditions[0].value,
    conditions,
    condition_logic: conditionLogicFromForm(formData),
    map_action: mapAction,
    variation_id: variationId,
    demand_variation_id: mapAction === 'ignore' ? null : (value(formData, 'demand_variation_id') || null),
    priority: num(formData, 'priority', 100),
    notes: value(formData, 'notes') || null,
    created_by: userId,
  }

  const { error } = await supabase.from('product_mapping_rules').insert(payload)
  if (error) {
    redirect('/mapping-rules?error=' + encodeURIComponent(error.message))
  }
  revalidatePath('/mapping-rules')
  redirect('/mapping-rules?notice=' + encodeURIComponent('Mapping rule added.'))
}

export async function applyMappingRulesToUnmappedRows() {
  const { supabase, userId } = await currentUserId()
  const { data: rules, error: rulesError } = await supabase
    .from('product_mapping_rules')
    .select(MAPPING_RULE_COLUMNS)
    .eq('active', true)
    .order('priority')
  if (rulesError) throw new Error(rulesError.message)

  // The Supabase Data API refuses to return more than max-rows (1000) in one
  // response, and a client-side .limit(5000) does NOT raise that ceiling.
  // This used to ask for 5000, silently receive 1000, and report success --
  // leaving every row past the first thousand unmapped with no warning.
  // Page explicitly instead.
  const PAGE_SIZE = 500
  let pageStart = 0
  let scanned = 0
  let changed = 0

  for (;;) {
    const { data: rows, error: rowsError } = await supabase
      .from('imported_order_rows')
      .select('id, platform, account_name, platform_sku, item_name, variation_text, customization_text, mapping_status')
      .in('mapping_status', ['unmapped', 'needs_review'])
      .order('id')
      .range(pageStart, pageStart + PAGE_SIZE - 1)
    if (rowsError) throw new Error(rowsError.message)
    if (!rows || rows.length === 0) break

    for (const row of rows) {
      scanned++
      const updated = applyMappingRules(row, (rules || []) as MappingRule[])
      if (updated.mapping_status !== row.mapping_status) {
        const { error } = await supabase.from('imported_order_rows').update({
          mapping_status: updated.mapping_status,
          mapped_variation_id: updated.mapped_variation_id,
          demand_variation_id: updated.demand_variation_id,
        }).eq('id', row.id)
        if (error) throw new Error(error.message)
        changed++
      }
    }

    if (rows.length < PAGE_SIZE) break
    // Rows whose status changed drop out of the filter, so the window only
    // advances by the ones we left behind.
    pageStart += rows.length - changed
    changed = 0
    if (scanned > 100000) break
  }

  // Newly mapped rows still need to actually consume stock.
  await postImportedOrdersToInventory()

  revalidatePath('/mapping-rules')
  revalidatePath('/imported-orders')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

/**
 * Turns mapped marketplace order lines into real inventory consumption.
 *
 * This step did not exist. Uploading and mapping Etsy/Amazon/TikTok/Shopify
 * orders wrote rows into imported_order_rows and stopped there -- nothing ever
 * deducted the BOM parts, so on-hand never moved for real sales. Every usage
 * figure in the system came from the one-time spreadsheet backfill.
 *
 * The work happens set-based inside Postgres, so it is not subject to the
 * 1000-row response cap, and a unique index on (source_id, part_id) makes it
 * idempotent -- running it twice cannot double-consume.
 */
export async function postImportedOrdersToInventory(): Promise<void> {
  const { supabase, userId } = await currentUserId()
  const { data, error } = await supabase.rpc('post_imported_orders_to_inventory', { p_user: userId })
  if (error) throw new Error(error.message)

  const result = Array.isArray(data) ? data[0] : data
  const rowsPosted = Number(result?.rows_posted || 0)
  const movements = Number(result?.movements_created || 0)

  if (rowsPosted > 0) {
    await supabase.from('notifications').insert({
      level: 'info',
      title: 'Marketplace orders posted to inventory',
      message: `${rowsPosted} order line(s) consumed stock across ${movements} part movement(s).`,
      source_type: 'imported_order_row',
      created_by: userId,
    })
  }

  revalidatePath('/imported-orders')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')

  // Keep the prediction snapshot (warn window + order-note tokens) current with
  // the usage this upload just posted. Never let a snapshot hiccup fail the post.
  try { await refreshPredictionSnapshots() } catch (e) { console.error('snapshot refresh after post failed', e) }
}

export async function reportUnlistedSupply(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const name = String(formData.get('supply_name') || '').trim()
  const note = String(formData.get('note') || '').trim() || null
  if (!name) redirect('/zero?unlisted=need_name')
  const { error } = await supabase.from('unlisted_supply_reports').insert({ supply_name: name, note, created_by: userId })
  if (error) throw new Error(error.message)
  revalidatePath('/zero')
  revalidatePath('/reports')
  redirect('/zero?unlisted=1')
}

export async function createSupplier(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canManageMasterData) redirect(deniedUrl('/suppliers', 'add a supplier'))

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
  revalidatePath('/parts')
}

export async function createPart(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canManageMasterData) redirect(deniedUrl('/parts', 'add a new part'))
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
  const perms = await getPermissions()
  if (!perms.canManageMasterData) redirect(deniedUrl('/products', 'add a product'))
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
  const perms = await getPermissions()
  if (!perms.canManageMasterData) redirect(deniedUrl('/products', 'add a variation'))
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
  const perms = await getPermissions()
  if (!perms.canManageMasterData) redirect(deniedUrl('/boms', 'change the master file'))
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
  const perms = await getPermissions()
  if (!perms.canCreateShipments) redirect(deniedUrl('/shipments', 'create a shipment'))

  const { data: created, error } = await supabase.from('purchase_orders').insert({
    po_number: value(formData, 'po_number'),
    supplier_id: value(formData, 'supplier_id'),
    status: value(formData, 'status') || 'ordered',
    order_date: value(formData, 'order_date') || null,
    expected_date: value(formData, 'expected_date') || null,
    tracking_number: value(formData, 'tracking_number') || null,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  }).select('id').single()

  if (error) throw new Error(error.message)

  /* A container packed at several factories arrives as one shipment. The main
     supplier stays on the order itself; the others are recorded alongside it so
     the shipment reads as coming from all of them. Blank lines are people who
     opened a row and did not use it, and the main supplier is skipped rather
     than listed twice. */
  const extraSuppliers = formData.getAll('extra_supplier_id')
    .map((entry) => String(entry).trim())
    .filter((entry) => entry && entry !== value(formData, 'supplier_id'))
  const uniqueExtras = extraSuppliers.filter((entry, index) => extraSuppliers.indexOf(entry) === index)

  if (created && uniqueExtras.length > 0) {
    const { error: supplierError } = await supabase.from('purchase_order_suppliers').insert(
      uniqueExtras.map((supplierId) => ({
        purchase_order_id: created.id,
        supplier_id: supplierId,
        created_by: userId,
      })),
    )
    if (supplierError) throw new Error(supplierError.message)
  }

  revalidatePath('/purchase-orders')
  revalidatePath('/shipments')
  revalidatePath('/dashboard')
}

export async function addPurchaseOrderItem(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canCreateShipments) redirect(deniedUrl('/shipments', 'add a part to a shipment'))

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
  const perms = await getPermissions()
  if (!perms.canManagePurchasing) redirect(deniedUrl('/shipments', 'change a shipment status'))
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
  const notes = value(formData, 'notes') || null

  // The form carries a one-time token. If the warehouse double-clicks Confirm,
  // or hits back and resubmits, the database replays the original receipt
  // instead of adding the shipment to stock a second time.
  const idempotencyKey = value(formData, 'idempotency_key') || null

  if (qtyReceived <= 0 && qtyDamaged <= 0 && qtyMissing <= 0) {
    throw new Error('Enter at least one quantity.')
  }

  // Single atomic call: locks the shipment line, refuses to over-receive, and
  // writes the receiving event, the stock movement, any damage report and the
  // PO counters together. Previously this was a read-then-write in JS with no
  // lock and no ceiling, so concurrent or repeated receipts inflated stock.
  const { error } = await supabase.rpc('receive_po_item', {
    p_item_id: itemId,
    p_qty_received: qtyReceived,
    p_qty_damaged: qtyDamaged,
    p_qty_missing: qtyMissing,
    p_notes: notes,
    p_user: userId,
    p_idempotency_key: idempotencyKey,
    p_movement_date: movementDate(formData),
  })
  if (error) throw new Error(error.message)

  if (qtyDamaged > 0) {
    await supabase.from('notifications').insert({
      level: 'warning',
      title: 'Damaged inventory received',
      message: `${qtyDamaged} damaged item(s) were reported during receiving. They were not added to stock.`,
      source_type: 'receiving_event',
      created_by: userId,
    })

    const webhook = process.env.SLACK_WEBHOOK_URL
    if (webhook) {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Inventory alert: ${qtyDamaged} damaged item(s) reported during receiving.` }),
      }).catch(() => null)
    }
  }

  revalidatePath('/receiving')
  revalidatePath('/purchase-orders')
  revalidatePath('/shipments')
  revalidatePath('/parts')
  revalidatePath('/damage')
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
      reduced_stock: true,
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
  // One date for every part line this replacement consumes.
  const when = movementDate(formData)
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

  const bomRows = bomItems || []
  const movements = bomRows.map((item: any) => ({
    part_id: item.part_id,
    movement_type: 'replacement_order',
    movement_date: when,
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

  // Atomic: the difference is recomputed against a locked, in-transaction read
  // of on-hand. Previously two people counting the same bin each computed the
  // correction from the same stale baseline, so the second one subtracted the
  // difference a second time and put a hole in the very stock it was fixing.
  const { error } = await supabase.rpc('record_cycle_count', {
    p_part_id: partId,
    p_counted: countedQty,
    p_notes: value(formData, 'notes') || null,
    p_user: userId,
    p_movement_date: movementDate(formData),
  })
  if (error) throw new Error(error.message)

  revalidatePath('/counts')
  revalidatePath('/parts')
  revalidatePath('/usage')
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
    movement_date: movementDate(formData),
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
  // Both halves of a switch share one date so they never straddle two weeks.
  const when = movementDate(formData)
  const fromPartId = value(formData, 'from_part_id')
  const toPartId = value(formData, 'to_part_id')
  const qty = num(formData, 'quantity', 0)
  if (qty <= 0) throw new Error('Quantity must be above zero.')
  if (!toPartId) throw new Error('Choose the part that was actually used.')
  if (fromPartId && fromPartId === toPartId) {
    throw new Error('The original part and the substitute cannot be the same part.')
  }

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

  // A substitution has two sides and must balance to zero.
  //
  // The original version wrote a single -qty leg against the SUBSTITUTE part
  // and nothing at all against the part that was replaced. Since the order had
  // already consumed the original part via its BOM, the original stayed short
  // forever and the substitute was deducted on top -- total on-hand drifted
  // down by the switch quantity every single time, undetectably.
  const reason = `Inventory switch: ${value(formData, 'change_type') || 'substitution'}`
  const notes = value(formData, 'notes') || null
  const movementRows: any[] = [
    {
      part_id: toPartId,
      movement_type: 'inventory_switch',
      quantity: -qty,
      source_type: 'inventory_switch',
      movement_date: when,
      source_id: switchRow.id,
      reason: `${reason} — substitute part consumed`,
      notes,
      created_by: userId,
    },
  ]

  if (fromPartId) {
    // The original part was never actually used, so give it back.
    movementRows.push({
      part_id: fromPartId,
      movement_type: 'inventory_switch',
      quantity: qty,
      source_type: 'inventory_switch',
      movement_date: when,
      source_id: switchRow.id,
      reason: `${reason} — original part returned, was not used`,
      notes,
      created_by: userId,
    })
  }

  const balance = movementRows.reduce((sum, row) => sum + Number(row.quantity), 0)
  if (fromPartId && balance !== 0) {
    throw new Error('Internal error: inventory switch legs did not balance. No stock was changed.')
  }

  const { error: movementError } = await supabase.from('inventory_movements').insert(movementRows)
  if (movementError) throw new Error(movementError.message)
  revalidatePath('/adjustments')
  revalidatePath('/usage')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
}

export async function createManualUnitsSold(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const saleDate = value(formData, 'sale_date') || today()
  const notes = value(formData, 'notes') || null

  function fail(message: string) {
    redirect('/usage?error=' + encodeURIComponent(message))
  }

  // One entry can cover several finished products. A bulk order that was half
  // Navy Holder and half Tan Holder is ONE order with one date, one reference
  // and one note - not two entries. The form repeats the variation and
  // quantity boxes under the same names, so they come back as parallel lists.
  const variationIds = formData.getAll('variation_id').map((v) => String(v).trim())
  const quantities = formData.getAll('quantity').map((v) => Number(String(v).trim()))

  const lines: { variationId: string, qty: number }[] = []
  for (let i = 0; i < variationIds.length; i++) {
    const variationId = variationIds[i]
    const qty = quantities[i]
    // A line someone opened and then did not use is not a mistake, just skip it.
    if (!variationId && !(qty > 0)) continue
    if (!variationId) fail('Line ' + (i + 1) + ': choose a finished product / variation.')
    if (!(qty > 0)) fail('Line ' + (i + 1) + ': quantity must be above zero.')
    lines.push({ variationId, qty })
  }
  if (lines.length === 0) fail('Add at least one product line.')

  // Every line is checked BEFORE anything is written. Otherwise a missing BOM
  // on the second product would leave the first one already booked in, with
  // stock consumed for half an order.
  const boms = new Map<string, any[]>()
  for (const line of lines) {
    if (boms.has(line.variationId)) continue
    const { data: bomItems, error: bomError } = await supabase
      .from('bom_items')
      .select('part_id, quantity_per_unit')
      .eq('variation_id', line.variationId)
    if (bomError) fail(bomError.message)
    if (!bomItems || bomItems.length === 0) {
      fail('One of the products on this entry has no BOM yet. Add the BOM first, then enter manual units sold.')
    }
    boms.set(line.variationId, bomItems || [])
  }

  const reason = value(formData, 'reason') || 'bulk_order_manual_entry'
  const orderReference = value(formData, 'order_reference') || null
  const weekStart = weekStartSundayFromDate(saleDate)

  for (const line of lines) {
    const { data: sale, error: saleError } = await supabase.from('manual_units_sold').insert({
      variation_id: line.variationId,
      quantity: line.qty,
      sale_date: saleDate,
      week_start: weekStart,
      order_reference: orderReference,
      reason,
      notes,
      created_by: userId,
    }).select('id').single()
    if (saleError || !sale) fail(saleError?.message || 'Could not add manual sold units')
    const saleId = (sale as any).id

    const movements = (boms.get(line.variationId) || []).map((item: any) => ({
      part_id: item.part_id,
      movement_type: 'order_consumption',
      quantity: -Number(item.quantity_per_unit) * line.qty,
      source_type: 'manual_units_sold',
      source_id: saleId,
      reason: 'Manual units sold / produced entry',
      notes,
      created_by: userId,
      movement_date: saleDate,
    }))
    const { error: movementError } = await supabase.from('inventory_movements').insert(movements)
    if (movementError) fail(movementError.message)
  }

  revalidatePath('/usage')
  revalidatePath('/adjustments')
  revalidatePath('/predictions/basic')
  revalidatePath('/parts')
  revalidatePath('/dashboard')
  redirect('/usage?notice=' + encodeURIComponent(lines.length + ' product line(s) added'))
}
export async function saveBomMatrix(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const entries = Array.from(formData.entries())
    .filter(([key]) => key.startsWith('bom__'))
    .map(([key, rawValue]) => {
      const [, variationId, partId] = key.split('__')
      const qty = Number(String(rawValue || '').trim() || 0)
      return { variationId, partId, qty: Number.isFinite(qty) ? qty : 0 }
    })

  for (const entry of entries) {
    if (!entry.variationId || !entry.partId) continue
    if (entry.qty > 0) {
      const { error } = await supabase.from('bom_items').upsert({
        variation_id: entry.variationId,
        part_id: entry.partId,
        quantity_per_unit: entry.qty,
        created_by: userId,
      }, { onConflict: 'variation_id,part_id' })
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('bom_items').delete().eq('variation_id', entry.variationId).eq('part_id', entry.partId)
      if (error) throw new Error(error.message)
    }
  }

  revalidatePath('/boms')
}


export async function reportZeroStock(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  // A supply nobody could find in the list: the reporter types the name instead
  // of picking a part. It files the same report, just without a part behind it,
  // and behaves like an untracked part - it goes to the reorder list.
  const customName = value(formData, 'custom_part_name')
  const unlisted = !partId && !!customName
  if (!partId && !customName) redirect('/zero?error=' + encodeURIComponent('Pick a part, or type the name of a supply that is not listed.'))

  const { data: stockRow } = unlisted
    ? { data: null }
    : await supabase.from('part_stock').select('on_hand').eq('part_id', partId).single()
  const systemQty = Number(stockRow?.on_hand || 0)
  const { data: part } = unlisted
    ? { data: null }
    : await supabase.from('parts').select('tracked').eq('id', partId).single()
  const tracked = unlisted ? false : part?.tracked !== false
  const reportType = value(formData, 'report_type') === 'running_low' ? 'running_low' : 'zero'

  // On a TRACKED part this deliberately does NOT change stock. The count is
  // supposed to be right, so a report is a signal that someone needs to go and
  // look -- sometimes there is stock the reporter did not find, and correcting
  // it here would hide that check instead of prompting it.
  const { data: created, error } = await supabase.from('zero_stock_reports').insert({
    part_id: unlisted ? null : partId,
    custom_part_name: unlisted ? customName : null,
    system_quantity_at_report: systemQty,
    warehouse_quantity_reported: num(formData, 'warehouse_quantity_reported', 0),
    // 'zero' means there are none left; 'running_low' means order more before
    // there are none. Waiting for zero is too late on anything with a lead time.
    report_type: reportType,
    order_reference: value(formData, 'order_reference') || null,
    notes: value(formData, 'notes') || null,
    created_by: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)

  /* An UNTRACKED part is the opposite case. Nobody counts these, so the number
     the app holds is a guess and the shelf is the truth. The report is the only
     moment anyone looks, so it is what the stock should follow: none left means
     zero, running low means roughly a quarter of a full shelf. Without this the
     forecast keeps quoting a number nobody has checked in months.

     Recorded against the report, so deleting the report puts the stock back. */
  if (!tracked && created && !unlisted) {
    /* None left means zero. Running low means whatever they counted on the shelf -
       a person standing in front of it beats any number the app was holding, and
       for an untracked part the app's number was only ever a guess. Left blank,
       nothing moves: better an old number than a wrong one. */
    const counted = String(formData.get('warehouse_quantity_reported') ?? '').trim()
    const target = reportType === 'zero'
      ? 0
      : (counted !== '' && Number.isFinite(Number(counted)) ? Number(counted) : null)

    if (target !== null) {
      const delta = target - systemQty
      if (delta !== 0) {
        const { error: moveError } = await supabase.from('inventory_movements').insert({
          part_id: partId,
          movement_type: 'manual_adjustment',
          quantity: delta,
          reason: reportType === 'zero'
            ? 'Warehouse reported none left (part is not tracked)'
            : 'Warehouse counted ' + target + ' on the shelf (part is not tracked)',
          notes: 'Untracked parts follow what the warehouse sees, so the report set the stock. '
            + 'Was ' + systemQty + ', now ' + target + '. Deleting the report puts it back.',
          source_type: 'zero_stock_report',
          source_id: created.id,
          movement_date: movementDate(formData),
          created_by: userId,
        })
        if (moveError) throw new Error(moveError.message)
      }
    }
  }

  await supabase.from('notifications').insert({
    level: 'urgent',
    title: 'Warehouse reported zero stock',
    message: value(formData, 'notes') || 'A part was reported as physically out of stock.',
    source_type: 'zero_stock_report',
    created_by: userId,
  })

  revalidatePath('/zero')
  revalidatePath('/reorder')
  revalidatePath('/reports')
  revalidatePath('/parts')
  revalidatePath('/predictions/basic')
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

export async function updateSupplier(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('suppliers').update({
    name: value(formData, 'name'),
    contact_name: value(formData, 'contact_name') || null,
    email: value(formData, 'email') || null,
    phone: value(formData, 'phone') || null,
    website: value(formData, 'website') || null,
    notes: value(formData, 'notes') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/suppliers')
  revalidatePath(`/suppliers/${id}`)
}

export async function deleteSupplier(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('suppliers').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/suppliers')
  redirect('/suppliers')
}

export async function updatePart(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('parts').update({
    name: value(formData, 'name'),
    sku: value(formData, 'sku'),
    category: value(formData, 'category') || null,
    supplier_id: value(formData, 'supplier_id') || null,
    supplier_part_number: value(formData, 'supplier_part_number') || null,
    unit: value(formData, 'unit') || 'each',
    lead_time_days_min: num(formData, 'lead_time_days_min', 0),
    lead_time_days_max: num(formData, 'lead_time_days_max', 0),
    safety_stock_days: num(formData, 'safety_stock_days', 30),
    reorder_point: num(formData, 'reorder_point', 0),
    target_stock: num(formData, 'target_stock', 0),
    default_order_quantity: num(formData, 'default_order_quantity', 0),
    critical: value(formData, 'critical') === 'on',
    active: value(formData, 'active') !== 'off',
    notes: value(formData, 'notes') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/parts')
  revalidatePath(`/parts/${id}`)
  revalidatePath('/dashboard')
}

export async function archivePart(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const active = value(formData, 'active') === 'true'
  const perms = await getPermissions()
  if (!perms.canManageMasterData) {
    redirect(deniedUrl('/parts/' + id, active ? 'restore a part' : 'archive a part'))
  }
  const { error } = await supabase.from('parts').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/parts')
  revalidatePath(`/parts/${id}`)
}

/**
 * Mute or unmute a part's stock alerts.
 *
 * Not the same as archiving. The part stays in the prediction sheet, the usage
 * grid and every BOM — it simply stops counting toward "out of stock" and
 * "reorder now", and drops off Needs attention. For things bought in bulk and
 * never counted in, the stock figure is noise, and the alert it raises hides
 * the parts that genuinely need ordering.
 */
export async function setPartIgnoreAlerts(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const ignore = value(formData, 'ignore_alerts') === 'true'
  const perms = await getPermissions()
  if (!perms.canManageMasterData) redirect(deniedUrl('/parts/' + id, 'turn alerts on or off for a part'))
  const { error } = await supabase
    .from('parts')
    .update({ ignore_alerts: ignore, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/parts')
  revalidatePath(`/parts/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/predictions/basic')
}

export async function updateProduct(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('products').update({
    name: value(formData, 'name'),
    sku: value(formData, 'sku') || null,
    notes: value(formData, 'notes') || null,
    active: value(formData, 'active') !== 'off',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
}

export async function archiveProduct(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const active = value(formData, 'active') === 'true'
  const { error } = await supabase.from('products').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
}

export async function updateVariation(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const productId = value(formData, 'product_id')
  const { error } = await supabase.from('product_variations').update({
    product_id: productId,
    variation_name: value(formData, 'variation_name'),
    internal_sku: value(formData, 'internal_sku'),
    notes: value(formData, 'notes') || null,
    active: value(formData, 'active') !== 'off',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/products')
  revalidatePath(`/products/${productId}`)
  revalidatePath('/boms')
}

export async function archiveVariation(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const productId = value(formData, 'product_id')
  const active = value(formData, 'active') === 'true'
  const { error } = await supabase.from('product_variations').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/products')
  revalidatePath(`/products/${productId}`)
}

export async function updateBomItem(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('bom_items').update({
    variation_id: value(formData, 'variation_id'),
    part_id: value(formData, 'part_id'),
    quantity_per_unit: num(formData, 'quantity_per_unit', 1),
    notes: value(formData, 'notes') || null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/boms')
}

export async function deleteBomItem(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('bom_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/boms')
}

export async function updateMappingRule(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const mapAction = value(formData, 'map_action') || 'map'
  const variationId = value(formData, 'variation_id') || null
  if (mapAction === 'map' && !variationId) throw new Error('Choose a variation, or choose Ignore / void line.')

  const conditions = conditionsFromForm(formData)
  if (conditions.length === 0) throw new Error('Add at least one condition with something to match on.')

  const { error } = await supabase.from('product_mapping_rules').update({
    platform: value(formData, 'platform'),
    account_name: value(formData, 'account_name') || null,
    match_type: conditions[0].type,
    match_field: conditions[0].field,
    match_value: conditions[0].value,
    conditions,
    condition_logic: conditionLogicFromForm(formData),
    map_action: mapAction,
    variation_id: variationId,
    demand_variation_id: mapAction === 'ignore' ? null : (value(formData, 'demand_variation_id') || null),
    priority: num(formData, 'priority', 100),
    active: value(formData, 'active') !== 'off',
    notes: value(formData, 'notes') || null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/mapping-rules')
}

export async function deleteMappingRule(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('product_mapping_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/mapping-rules')
}

export async function updateImportedOrderRow(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('imported_order_rows').update({
    mapping_status: value(formData, 'mapping_status'),
    mapped_variation_id: value(formData, 'mapped_variation_id') || null,
    demand_variation_id: value(formData, 'demand_variation_id') || null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/imported-orders')
  revalidatePath(`/imported-orders/${id}`)
}

/**
 * Void a single order line.
 *
 * Not the same as Delete and not the same as "Ignored". Delete throws the
 * source row away; Ignored means the line was never mapped. Voiding keeps the
 * line, its mapping and its history, marks WHY it does not count, and hands
 * back any stock it already consumed -- the replacement case: the customer's
 * second unit is not a second sale.
 */
/**
 * Undo a count.
 *
 * A count silently rewrites on-hand, and until now there was no way back from
 * the app — a mistyped quantity was permanent. This archives the adjustment
 * the count made (the movement stays in history, marked reversed) and removes
 * the count row, putting the stock back where it was.
 */
export async function reverseCycleCount(formData: FormData) {
  const { supabase } = await currentUserId()
  const { data, error } = await supabase.rpc('reverse_cycle_count', {
    p_count_id: value(formData, 'id'),
  })
  if (error) redirect(`/counts?error=${encodeURIComponent(error.message)}`)

  const result = Array.isArray(data) ? data[0] : data
  const part = result?.part_name || 'that part'
  const restored = Number(result?.restored || 0)

  revalidatePath('/counts'); revalidatePath('/parts')
  revalidatePath('/dashboard'); revalidatePath('/predictions/basic')
  redirect(`/counts?notice=${encodeURIComponent(
    `Count reversed. ${part} is back to what it was${restored ? ` (${restored > 0 ? '+' : ''}${restored})` : ''}.`
  )}`)
}

export async function voidImportedOrderRow(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'id')
  const { data, error } = await supabase.rpc('void_imported_order_row', {
    p_id: id,
    p_reason: value(formData, 'void_reason') || null,
    p_note: value(formData, 'void_note') || null,
    p_user: userId,
  })
  if (error) throw new Error(error.message)

  const result = Array.isArray(data) ? data[0] : data
  const moves = Number(result?.movements_removed || 0)
  const parts = Number(result?.parts_restored || 0)

  revalidatePath('/imported-orders')
  revalidatePath(`/imported-orders/${id}`)
  revalidatePath('/usage'); revalidatePath('/parts')
  revalidatePath('/dashboard'); revalidatePath('/predictions/basic')

  redirect(`/imported-orders/${id}?notice=${encodeURIComponent(
    moves > 0
      ? `Line voided. ${parts} part(s) put back on the shelf.`
      : 'Line voided. It had not consumed any stock yet, so nothing changed on hand.'
  )}`)
}

/** Put a voided line back in play. It becomes postable again on the next post. */
export async function unvoidImportedOrderRow(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.rpc('unvoid_imported_order_row', { p_id: id })
  if (error) throw new Error(error.message)
  revalidatePath('/imported-orders')
  revalidatePath(`/imported-orders/${id}`)
  revalidatePath('/dashboard')
  redirect(`/imported-orders/${id}?notice=${encodeURIComponent(
    'Line is live again. Run "Post orders to inventory" to deduct its parts.'
  )}`)
}

export async function deleteImportedOrderRow(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('imported_order_rows').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/imported-orders')
  redirect('/imported-orders')
}

export async function updatePurchaseOrder(formData: FormData) {
  const { supabase } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canManagePurchasing) redirect(deniedUrl('/shipments', 'edit a shipment'))
  const id = value(formData, 'purchase_order_id') || value(formData, 'id')
  const { error } = await supabase.from('purchase_orders').update({
    po_number: value(formData, 'po_number'),
    supplier_id: value(formData, 'supplier_id'),
    status: value(formData, 'status') || 'ordered',
    order_date: value(formData, 'order_date') || null,
    expected_date: value(formData, 'expected_date') || null,
    tracking_number: value(formData, 'tracking_number') || null,
    notes: value(formData, 'notes') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/shipments')
  revalidatePath(`/shipments/${id}`)
  revalidatePath('/purchase-orders')
  revalidatePath('/dashboard')
}

export async function deletePurchaseOrder(formData: FormData) {
  const { supabase } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canManagePurchasing) redirect(deniedUrl('/shipments', 'delete a shipment'))
  const id = value(formData, 'id')
  const { error } = await supabase.from('purchase_orders').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/purchase-orders')
  revalidatePath('/shipments')
  revalidatePath('/receiving')
  revalidatePath('/dashboard')
}

export async function updatePurchaseOrderItem(formData: FormData) {
  const { supabase } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canManagePurchasing) redirect(deniedUrl('/shipments', 'edit a shipment line'))
  const id = value(formData, 'id')
  const poId = value(formData, 'purchase_order_id')
  const { error } = await supabase.from('purchase_order_items').update({
    part_id: value(formData, 'part_id'),
    quantity_ordered: num(formData, 'quantity_ordered', 0),
    unit_cost: num(formData, 'unit_cost', 0),
    notes: value(formData, 'notes') || null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/shipments')
  if (poId) revalidatePath(`/shipments/${poId}`)
  revalidatePath('/receiving')
  revalidatePath('/dashboard')
}

export async function deletePurchaseOrderItem(formData: FormData) {
  const { supabase } = await currentUserId()
  const perms = await getPermissions()
  if (!perms.canManagePurchasing) redirect(deniedUrl('/shipments', 'delete a shipment line'))
  const id = value(formData, 'id')
  const poId = value(formData, 'purchase_order_id')
  const { error } = await supabase.from('purchase_order_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/purchase-orders')
  revalidatePath('/shipments')
  if (poId) revalidatePath(`/shipments/${poId}`)
  revalidatePath('/receiving')
  revalidatePath('/dashboard')
}

export async function acknowledgeNotification(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('notifications').update({ acknowledged_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard')
}

export async function deleteUploadBatch(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  await supabase.from('imported_order_rows').delete().eq('upload_batch_id', id)
  const { error } = await supabase.from('upload_batches').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/uploads')
  revalidatePath('/imported-orders')
  redirect('/uploads')
}

/**
 * Mark a warehouse reorder request as handled.
 *
 * Only meaningful for untracked parts: there a report is a task ("we are low
 * on boxes, order some"), and somebody has to be able to say it is done. On a
 * tracked part the report is an alarm about the forecast being wrong, and
 * ticking it off would just hide the failure.
 */
export async function resolveStockReport(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const id = value(formData, 'report_id')
  const { error } = await supabase.from('zero_stock_reports').update({
    resolved_at: new Date().toISOString(),
    resolved_by: userId,
    resolution_note: value(formData, 'resolution_note') || null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/reorder')
  revalidatePath('/zero')
  revalidatePath('/dashboard')
}

export async function reopenStockReport(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'report_id')
  const { error } = await supabase.from('zero_stock_reports').update({
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/reorder')
  revalidatePath('/zero')
  revalidatePath('/dashboard')
}

/** Tracked parts are reordered from the forecast; untracked ones when the warehouse asks. */
export async function setPartTracked(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.from('parts')
    .update({ tracked: value(formData, 'tracked') !== 'false', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/parts')
  revalidatePath('/parts/' + id)
  revalidatePath('/zero')
  revalidatePath('/reorder')
}
