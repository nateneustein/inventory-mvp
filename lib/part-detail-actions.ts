// PASTE TEST LINE 1
const x = { a: 1 }
  indented
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

async function currentUserId() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { supabase, userId: user.id }
}

function revalidatePart(id: string) {
  revalidatePath('/parts')
  revalidatePath(`/parts/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/predictions/basic')
  revalidatePath('/predictions/advanced')
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
  const { error } = await supabase
    .from('parts')
    .update({ reorder_horizon_days: days, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePart(id)
}

/**
 * Everything the buyer needs to know to place the order.
 *
 * Deliberately does NOT touch reorder_horizon_days — the trigger is set on its
 * own so that editing a price or a note can never quietly change when a part
 * starts asking to be ordered.
 */
export async function updatePartDetails(formData: FormData) {
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
    unit_price: numOrNull(formData, 'unit_price'),
    currency: value(formData, 'currency') || 'USD',
    moq: numOrNull(formData, 'moq'),
    order_multiple: numOrNull(formData, 'order_multiple'),
    size_dimensions: value(formData, 'size_dimensions') || null,
    color_finish: value(formData, 'color_finish') || null,
    material_spec: value(formData, 'material_spec') || null,
    supplier_link: value(formData, 'supplier_link') || null,
    supplier_order_instructions: value(formData, 'supplier_order_instructions') || null,
    packaging_notes: value(formData, 'packaging_notes') || null,
    backup_supplier_id: value(formData, 'backup_supplier_id') || null,
    backup_supplier_notes: value(formData, 'backup_supplier_notes') || null,
    critical: value(formData, 'critical') === 'on',
    active: value(formData, 'active') !== 'off',
    notes: value(formData, 'notes') || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePart(id)
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
  const storagePath = `${partId}/${randomUUID()}.${ext}`

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

  if (row?.storage_path) {
    await supabase.storage.from('part-files').remove([row.storage_path])
  }

  revalidatePart(partId)
}
