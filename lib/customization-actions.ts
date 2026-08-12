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
 * Which lines actually need their file opened.
 *
 * Downloading a file for every custom order would be work nobody asked for.
 * The mapping rules already say which listings need the choice to be known -
 * a rule is only written against Custom options when the sku on its own is not
 * enough. So the rules decide the work: if no rule cares about a sku, its
 * orders are left alone.
 *
 * If a rule uses Custom options but names no sku, it could apply to anything,
 * so nothing can be safely skipped and everything is read. That is the honest
 * answer rather than a guess.
 * ------------------------------------------------------------------ */
async function skusTheRulesCareAbout(supabase: any) {
  const { data: rules } = await supabase
    .from('product_mapping_rules')
    .select('match_field, match_type, match_value, conditions, active')
    .eq('active', true)

  const skus = new Set<string>()
  let everything = false

  for (const rule of rules || []) {
    const conds = Array.isArray(rule.conditions) && rule.conditions.length
      ? rule.conditions
      : [{ field: rule.match_field, type: rule.match_type, value: rule.match_value }]
    if (!conds.some((c: any) => c && c.field === 'custom_options')) continue

    const skuConds = conds.filter((c: any) => c && c.field === 'sku' && String(c.value || '').trim())
    if (!skuConds.length) { everything = true; continue }
    for (const c of skuConds) skus.add(String(c.value).trim().toLowerCase())
  }
  return { skus, everything }
}

function rowIsWanted(row: any, skus: Set<string>, everything: boolean) {
  if (everything) return true
  const sku = String(row.platform_sku || '').toLowerCase()
  if (!sku) return false
  for (const want of skus) {
    if (sku === want || sku.includes(want) || want.includes(sku)) return true
  }
  return false
}

/** Every custom line that has not been read yet, newest first. */
async function pendingRows(supabase: any, limit: number) {
  const { data } = await supabase
    .from('imported_order_rows')
    .select('id, platform_order_id, platform_sku, customization_text')
    .eq('platform', 'amazon')
    .like('customization_text', 'http%')
    .is('custom_options', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

/** What the page shows above the button. */
export async function customizationStatus() {
  const supabase = await createClient()
  const { skus, everything } = await skusTheRulesCareAbout(supabase)
  const rows = await pendingRows(supabase, MAX_ROWS)

  const wanted = rows.filter((r: any) => rowIsWanted(r, skus, everything))
  const bySku: Record<string, number> = {}
  for (const r of rows) {
    const k = String(r.platform_sku || 'no sku')
    bySku[k] = (bySku[k] || 0) + 1
  }

  const { count: read } = await supabase
    .from('imported_order_rows')
    .select('id', { count: 'exact', head: true })
    .eq('custom_fetch_status', 'ok')
  const { count: failed } = await supabase
    .from('imported_order_rows')
    .select('id', { count: 'exact', head: true })
    .eq('custom_fetch_status', 'failed')
    .is('custom_options', null)

  return {
    pending: rows.length,
    wanted: wanted.length,
    skipped: rows.length - wanted.length,
    read: read || 0,
    failed: failed || 0,
    bySku,
    rulesNarrow: !everything && skus.size > 0,
  }
}

/* ------------------------------------------------------------------ *
 * Reading the files.
 *
 * Two things decide how much one press gets through: how many downloads run at
 * once, and how long the whole press is allowed to take.
 *
 * The files are small - about 85KB each - and the time is nearly all waiting on
 * Amazon rather than working, so running eight at a time turns a minute of
 * queueing into a few seconds. Eight is deliberate: enough to make the waiting
 * overlap, few enough that Amazon is never hit hard enough to notice.
 *
 * The stop condition is a clock, not a count. A press keeps going until either
 * nothing is left or the budget is nearly spent, so a normal week finishes in
 * one press. A count would be too small on a light week and time out on a heavy
 * one; a clock is right on both.
 * ------------------------------------------------------------------ */
const CONCURRENCY = 8
const TIME_BUDGET_MS = 45000
const MAX_ROWS = 1000

async function readInto(supabase: any, rows: any[]) {
  const startedAt = Date.now()
  let done = 0
  let failed = 0
  let stoppedEarly = false

  async function readOne(row: any) {
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

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedEarly = true; break }
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(readOne))
  }
  return { done, failed, stoppedEarly }
}

function finish(done: number, failed: number, stoppedEarly: boolean, extra?: string) {
  revalidatePath('/imported-orders')
  const parts = [done + ' order(s) read']
  if (failed) parts.push(failed + ' could not be read')
  if (stoppedEarly) parts.push('stopped on time - press again to carry on')
  if (extra) parts.push(extra)
  redirect('/imported-orders?notice=' + encodeURIComponent(parts.join(', ')))
}

/** The everyday button: only the lines a mapping rule actually needs. */
export async function fetchAmazonCustomizations() {
  const perms = await getPermissions()
  if (!perms.canUploadOrders) {
    redirect(deniedUrl('/imported-orders', 'read the Amazon customization files'))
  }
  const supabase = await createClient()
  const { skus, everything } = await skusTheRulesCareAbout(supabase)
  const rows = (await pendingRows(supabase, MAX_ROWS)).filter((r: any) => rowIsWanted(r, skus, everything))

  const { done, failed, stoppedEarly } = await readInto(supabase, rows)
  finish(done, failed, stoppedEarly)
}

/**
 * The chicken-and-egg button.
 *
 * You cannot write a rule against Custom options until you know what a listing
 * calls its dropdowns, and nothing narrows to that listing until the rule
 * exists. This reads exactly ONE order per sku so the wording appears on screen,
 * then you write the rule and the button above does the rest.
 */
export async function fetchOneSampleEachSku() {
  const perms = await getPermissions()
  if (!perms.canUploadOrders) {
    redirect(deniedUrl('/imported-orders', 'read the Amazon customization files'))
  }
  const supabase = await createClient()
  const rows = await pendingRows(supabase, MAX_ROWS)

  const oneEach: any[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const sku = String(row.platform_sku || '')
    if (seen.has(sku)) continue
    seen.add(sku)
    oneEach.push(row)
  }

  const { done, failed, stoppedEarly } = await readInto(supabase, oneEach)
  finish(done, failed, stoppedEarly, 'one sample per SKU')
}
