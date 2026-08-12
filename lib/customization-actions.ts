'use server'

import { inflateRawSync } from 'node:zlib'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, deniedUrl } from '@/lib/permissions'

/**
 * Reading the choices off an Amazon custom order.
 *
 * A custom listing sells every variation under ONE sku and ONE asin, so the
 * order report cannot say which one was bought - two orders for completely
 * different physical products look identical in the spreadsheet. The choice
 * only exists inside the zip behind the customized-url column.
 *
 * NOTHING HERE KNOWS ABOUT ANY PARTICULAR LISTING. It does not look for a
 * dropdown by name and has no idea what a star map or a light base is. It reads
 * EVERY dropdown the buyer was offered and writes them down as
 * label -> chosen value. A listing you add next year works the day it launches:
 * the only thing you do is write a mapping rule against whatever its own
 * options happen to be called.
 *
 * What is deliberately NOT read: the same file carries the buyer's names, their
 * message, the date and the location. Those are needed to engrave the product,
 * not to count stock, so this walks past them and never stores them. The only
 * thing that reaches the database is the list of choices.
 */

/* ------------------------------------------------------------------ *
 * A very small zip reader.
 *
 * Rather than take on a dependency for four files a week, this reads the
 * archive directly. A zip ends with a record saying where its table of
 * contents is; the table of contents lists each file and where its bytes
 * start. Deflate is the only compression zip normally uses, and Node can
 * already undo that.
 * ------------------------------------------------------------------ */
function unzipJson(buf: Buffer): any {
  // The end-of-archive record is last, but may be followed by a comment, so
  // scan backwards for its signature rather than assuming the final 22 bytes.
  let eocd = -1
  const floor = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('That download is not a zip file.')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    if (name.toLowerCase().endsWith('.json')) {
      // The local header repeats the name and extra fields, and their lengths
      // can differ from the copy in the table of contents, so read them again.
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(start, start + compSize)
      const text = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8')
      return JSON.parse(text)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('No customization file inside that zip.')
}

/* ------------------------------------------------------------------ *
 * Every dropdown, whatever it is called.
 * ------------------------------------------------------------------ */
function collectOptions(node: any, out: Record<string, string>) {
  if (Array.isArray(node)) {
    for (const child of node) collectOptions(child, out)
    return
  }
  if (!node || typeof node !== 'object') return

  if (node.type === 'OptionCustomization') {
    const label = String(node.label || node.name || '').trim()
    const chosen = node.optionSelection || {}
    const value = String(chosen.label || chosen.name || '').trim()
    if (label && value) out[label] = value
  }

  // Only ever step down through the document structure. Text the buyer typed
  // hangs off other keys and is none of our business.
  if (Array.isArray(node.children)) collectOptions(node.children, out)
}

/** One searchable line, which is what a mapping rule is matched against. */
function flatten(options: Record<string, string>) {
  return Object.keys(options)
    .sort()
    .map((k) => k + ': ' + options[k])
    .join(' | ')
}

/** Exported so the same reading can be reused (tests, a manual upload, etc). */
export async function readCustomizationZip(bytes: ArrayBuffer) {
  const doc = unzipJson(Buffer.from(bytes))
  const options: Record<string, string> = {}
  collectOptions(doc?.customizationData, options)
  return {
    orderId: String(doc?.orderId || ''),
    orderItemId: String(doc?.orderItemId || ''),
    asin: String(doc?.asin || ''),
    options,
    text: flatten(options),
  }
}

/* ------------------------------------------------------------------ *
 * The action the page calls.
 *
 * Deliberately done in batches rather than during the CSV upload itself: a
 * weekly file can hold fifty custom lines, and fifty downloads inside one
 * upload request is how an upload times out halfway and leaves you guessing
 * what landed. Press it again to carry on; anything that failed stays listed
 * and is retried, so it can never quietly skip a line.
 * ------------------------------------------------------------------ */
const BATCH = 25

export async function fetchAmazonCustomizations() {
  const perms = await getPermissions()
  if (!perms.canUploadOrders) {
    redirect(deniedUrl('/imported-orders', 'read the Amazon customization files'))
  }
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from('imported_order_rows')
    .select('id, platform_order_id, customization_text')
    .eq('platform', 'amazon')
    .like('customization_text', 'http%')
    .is('custom_options', null)
    .order('created_at', { ascending: false })
    .limit(BATCH)

  if (error) redirect('/imported-orders?error=' + encodeURIComponent(error.message))

  let done = 0
  let failed = 0

  for (const row of rows || []) {
    try {
      const res = await fetch(row.customization_text, { cache: 'no-store' })
      if (!res.ok) throw new Error('Amazon answered ' + res.status + ' for that link.')
      const read = await readCustomizationZip(await res.arrayBuffer())

      if (!Object.keys(read.options).length) {
        throw new Error('That order has no dropdown choices on it.')
      }
      // A mismatch here would mean a link points at somebody else's order, which
      // must never be quietly written onto this line.
      if (read.orderId && row.platform_order_id && read.orderId !== row.platform_order_id) {
        throw new Error('That file is for order ' + read.orderId + ', not ' + row.platform_order_id + '.')
      }

      await supabase
        .from('imported_order_rows')
        .update({
          custom_options: read.options,
          custom_options_text: read.text,
          custom_fetch_status: 'ok',
          custom_fetch_error: null,
          custom_fetched_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      done++
    } catch (e: any) {
      failed++
      await supabase
        .from('imported_order_rows')
        .update({
          custom_fetch_status: 'failed',
          custom_fetch_error: String(e?.message || e).slice(0, 300),
          custom_fetched_at: new Date().toISOString(),
        })
        .eq('id', row.id)
    }
  }

  revalidatePath('/imported-orders')
  const note = done + ' read' + (failed ? ', ' + failed + ' could not be read' : '')
  redirect('/imported-orders?notice=' + encodeURIComponent(note))
}
