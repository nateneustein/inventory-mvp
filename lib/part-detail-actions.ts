'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

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

/** Blank stays blank. A price of 0 and "nobody has filled this in" are not the same thing. */
function numOrNull(formData: FormData, key: string) {
  const raw = value(formData, key)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Pull a number out of something a person typed.
 *
 * Price and MOQ are free text now — "36.31 a box", "500 (250 if they split the
 * run)". The reports and purchase orders still want a plain number, so take the
 * first one in the string and leave the rest as the human note it is.
 */
function looseNumber(raw: string | null | undefined) {
  if (!raw) return null
  const match = String(raw).match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

async function currentUserId() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { supabase, userId: user.id }
}

function revalidatePart(id: string) {
  revalidatePath('/parts')
  revalidatePath('/parts/' + id)
  revalidatePath('/dashboard')
  revalidatePath('/predictions/basic')
  revalidatePath('/predictions/advanced')
  revalidatePath('/zero')
  revalidatePath('/reorder')
}

/**
 * The reorder trigger, and the only thing that decides whether a part shouts.
 *
 * A window in days, not a quantity. "Tell me if this runs out within 90 days."
 * The view works out days of cover from real usage and compares against this,
 * so the alert keeps up on its own as a product gets more or less popular.
 */
export async function setPartReorderHorizon(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const days = num(formData, 'reorder_horizon_days', 90)
  // Goes through an RPC so the change and the reason it was made land in the
  // history table in one transaction.
  const { error } = await supabase.rpc('set_part_reorder_horizon', {
    p_part_id: id,
    p_days: days,
    p_note: value(formData, 'reorder_note') || null,
  })
  if (error) throw new Error(error.message)
  revalidatePart(id)
}

/**
 * How much to buy when this part comes up, and why that was changed.
 *
 * Free text on purpose. "3 months of usage, but check either side of a seasonal
 * spike" is the instruction someone actually needs; a number cannot hold it.
 *
 * Goes through an RPC so the new amount and the reason for it land in the
 * history in one transaction and can never come apart. Together with the
 * reorder window these are the two levers pulled when stock goes wrong, so both
 * keep the same kind of record.
 */
export async function setPartOrderMonths(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const { error } = await supabase.rpc('set_part_order_months', {
    p_part_id: id,
    p_months: value(formData, 'months_of_usage_to_order') || null,
    p_note: value(formData, 'order_months_note') || null,
  })
  if (error) throw new Error(error.message)
  revalidatePart(id)
}

/**
 * Save whatever the form actually sent, and nothing else.
 *
 * The part page used to be one enormous form, so this could safely write every
 * column every time. It is now several small forms — the basics, the supplier
 * instructions — and a form that does not carry "target stock" must not reset
 * target stock to zero just by being saved. So the patch is built from the keys
 * present in the submission rather than from a fixed list.
 *
 * Deliberately does NOT touch reorder_horizon_days: the trigger is set on its
 * own so editing a note can never quietly change when a part starts asking to
 * be ordered.
 */
export async function updatePartDetails(formData: FormData) {
  const { supabase } = await currentUserId()
  const id = value(formData, 'id')
  const patch: Record<string, any> = {}

  const TEXT = [
    'category', 'unit', 'supplier_part_number', 'currency',
    'months_of_usage_to_order',
    'size_dimensions', 'color_finish', 'material_spec', 'supplier_link',
    'supplier_order_instructions', 'packaging_notes', 'backup_supplier_notes', 'notes',
  ]
  for (const key of TEXT) if (formData.has(key)) patch[key] = value(formData, key) || null

  const NUMBERS = [
    'lead_time_days_min', 'lead_time_days_max', 'safety_stock_days',
    'reorder_point', 'target_stock', 'default_order_quantity',
  ]
  for (const key of NUMBERS) if (formData.has(key)) patch[key] = num(formData, key, 0)

  const NULLABLE_NUMBERS = ['unit_price', 'moq', 'order_multiple']
  for (const key of NULLABLE_NUMBERS) if (formData.has(key)) patch[key] = numOrNull(formData, key)

  const IDS = ['supplier_id', 'backup_supplier_id']
  for (const key of IDS) if (formData.has(key)) patch[key] = value(formData, key) || null

  // Name and SKU are required columns: an empty box is a mistake, not an
  // instruction to blank them out.
  if (formData.has('name') && value(formData, 'name')) patch.name = value(formData, 'name')
  if (formData.has('sku') && value(formData, 'sku')) patch.sku = value(formData, 'sku')

  // Both are dropdowns rather than checkboxes: an unticked checkbox sends
  // nothing at all, so "archive this part" could never actually be saved.
  if (formData.has('critical')) {
    const raw = value(formData, 'critical')
    patch.critical = raw === 'yes' || raw === 'on' || raw === 'true'
  }
  if (formData.has('active')) patch.active = value(formData, 'active') !== 'off'
  // Tracked vs untracked decides whether a warehouse report is an alarm about
  // the forecast or simply a request to order more.
  if (formData.has('tracked')) patch.tracked = value(formData, 'tracked') !== 'false'

  if (Object.keys(patch).length === 0) return
  patch.updated_at = new Date().toISOString()

  const { error } = await supabase.from('parts').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePart(id)
}

/**
 * Keep the part's own supplier columns in step with its supplier list.
 *
 * The list is the thing people edit, but purchase orders, the supplier pages
 * and older reports still read parts.supplier_id / unit_price / moq. Mirroring
 * the main supplier back onto the part means none of that had to change and
 * nothing silently goes stale.
 */
async function syncPartFromSuppliers(supabase: any, partId: string) {
  const { data: rows } = await supabase
    .from('part_suppliers')
    .select('*')
    .eq('part_id', partId)
    .order('is_primary', { ascending: false })
    .order('sort_order')
    .order('created_at')

  const list = rows || []
  const primary = list.find((r: any) => r.is_primary) || list[0] || null
  const backup = list.find((r: any) => r.id !== primary?.id && r.supplier_id) || null

  const patch: Record<string, any> = {
    supplier_id: primary?.supplier_id || null,
    backup_supplier_id: backup?.supplier_id || null,
    supplier_part_number: primary?.supplier_part_number || null,
    unit_price: looseNumber(primary?.unit_price),
    moq: looseNumber(primary?.moq),
    updated_at: new Date().toISOString(),
  }
  // 'each' is the fallback the rest of the app assumes when a unit is missing.
  if (primary?.unit) patch.unit = primary.unit

  await supabase.from('parts').update(patch).eq('id', partId)
}

/**
 * Add or update one supplier for a part.
 *
 * The part number, unit, usual price and minimum order live here rather than on
 * the part, because they are the supplier's terms — a backup supplier sells the
 * same thing under a different code, in a different box size, at its own price.
 */
export async function savePartSupplier(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const rowId = value(formData, 'row_id')

  const row = {
    supplier_id: value(formData, 'supplier_id') || null,
    supplier_part_number: value(formData, 'supplier_part_number') || null,
    unit: value(formData, 'unit') || null,
    unit_price: value(formData, 'unit_price') || null,
    moq: value(formData, 'moq') || null,
    updated_at: new Date().toISOString(),
  }

  if (rowId) {
    const { error } = await supabase.from('part_suppliers').update(row).eq('id', rowId)
    if (error) throw new Error(error.message)
  } else {
    // An empty row helps nobody — adding a backup means naming one.
    if (!row.supplier_id) return
    // The first supplier on a part is the main one; anything after is a backup.
    const { count } = await supabase
      .from('part_suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('part_id', partId)
      .eq('is_primary', true)
    const hasPrimary = (count || 0) > 0
    const { error } = await supabase.from('part_suppliers').insert({
      ...row,
      part_id: partId,
      is_primary: !hasPrimary,
      sort_order: hasPrimary ? 100 : 10,
      created_by: userId,
    })
    if (error) throw new Error(error.message)
  }

  await syncPartFromSuppliers(supabase, partId)
  revalidatePart(partId)
}

export async function deletePartSupplier(formData: FormData) {
  const { supabase } = await currentUserId()
  const partId = value(formData, 'part_id')
  const rowId = value(formData, 'row_id')

  const { data: row } = await supabase.from('part_suppliers').select('is_primary').eq('id', rowId).single()

  const { error } = await supabase.from('part_suppliers').delete().eq('id', rowId)
  if (error) throw new Error(error.message)

  // Removing the main supplier promotes the next one, rather than leaving a
  // part holding nothing but backups.
  if (row?.is_primary) {
    const { data: next } = await supabase
      .from('part_suppliers')
      .select('id')
      .eq('part_id', partId)
      .order('sort_order')
      .order('created_at')
      .limit(1)
    if (next && next[0]) {
      await supabase.from('part_suppliers').update({ is_primary: true, sort_order: 10 }).eq('id', next[0].id)
    }
  }

  await syncPartFromSuppliers(supabase, partId)
  revalidatePart(partId)
}

/** A link worth keeping next to the part: the listing, a spec sheet, a reorder page. */
export async function savePartLink(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const rowId = value(formData, 'row_id')

  let url = value(formData, 'url')
  if (!url) return
  // A bare "acme.com/part" is what people paste; make it clickable.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url

  const row = { label: value(formData, 'label') || null, url }

  const { error } = rowId
    ? await supabase.from('part_links').update(row).eq('id', rowId)
    : await supabase.from('part_links').insert({ ...row, part_id: partId, created_by: userId })

  if (error) throw new Error(error.message)
  revalidatePart(partId)
}

export async function deletePartLink(formData: FormData) {
  const { supabase } = await currentUserId()
  const partId = value(formData, 'part_id')
  const rowId = value(formData, 'row_id')
  const { error } = await supabase.from('part_links').delete().eq('id', rowId)
  if (error) throw new Error(error.message)
  revalidatePart(partId)
}

/** An extra labelled line on a part, for anything the fixed fields do not cover. */
export async function savePartCustomField(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const fieldId = value(formData, 'field_id')
  const label = value(formData, 'label')
  if (!label) return

  const row = {
    label,
    value: value(formData, 'value') || null,
    sort_order: num(formData, 'sort_order', 100),
    updated_at: new Date().toISOString(),
  }

  const { error } = fieldId
    ? await supabase.from('part_custom_fields').update(row).eq('id', fieldId)
    : await supabase.from('part_custom_fields').insert({ ...row, part_id: partId, created_by: userId })

  if (error) throw new Error(error.message)
  revalidatePart(partId)
}

export async function deletePartCustomField(formData: FormData) {
  const { supabase } = await currentUserId()
  const partId = value(formData, 'part_id')
  const fieldId = value(formData, 'field_id')
  const { error } = await supabase.from('part_custom_fields').delete().eq('id', fieldId)
  if (error) throw new Error(error.message)
  revalidatePart(partId)
}

/**
 * Upload a photo or spec sheet for a part.
 *
 * The file goes into a private bucket under the part's own folder, and a row is
 * written so the list survives even if someone renames things in storage later.
 * If the row fails to write, the uploaded object is removed again rather than
 * left orphaned in the bucket.
 */
export async function uploadPartFile(formData: FormData) {
  const { supabase, userId } = await currentUserId()
  const partId = value(formData, 'part_id')
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) return

  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin'
  const storagePath = partId + '/' + randomUUID() + '.' + ext

  const { error: uploadError } = await supabase.storage
    .from('part-files')
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false })
  if (uploadError) throw new Error(uploadError.message)

  const { error } = await supabase.from('part_files').insert({
    part_id: partId,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    kind: value(formData, 'kind') || 'supplier_spec',
    caption: value(formData, 'caption') || null,
    send_to_supplier: value(formData, 'send_to_supplier') === 'on',
    created_by: userId,
  })

  if (error) {
    await supabase.storage.from('part-files').remove([storagePath])
    throw new Error(error.message)
  }

  revalidatePart(partId)
}

export async function deletePartFile(formData: FormData) {
  const { supabase } = await currentUserId()
  const partId = value(formData, 'part_id')
  const fileId = value(formData, 'file_id')

  const { data: row } = await supabase.from('part_files').select('storage_path').eq('id', fileId).single()

  const { error } = await supabase.from('part_files').delete().eq('id', fileId)
  if (error) throw new Error(error.message)

  // The same photo is listed on every part in a family - all nine watch case
  // colours share one picture. Only clear the stored file once no row points at
  // it any more, otherwise removing a photo from one colour would blank it on
  // all the others.
  if (row?.storage_path) {
    const { count } = await supabase
      .from('part_files')
      .select('id', { count: 'exact', head: true })
      .eq('storage_path', row.storage_path)
    if (!count) await supabase.storage.from('part-files').remove([row.storage_path])
  }

  revalidatePart(partId)
}
