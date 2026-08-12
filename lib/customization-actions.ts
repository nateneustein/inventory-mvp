'use server'

import { inflateRawSync } from 'node:zlib'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, deniedUrl } from '@/lib/permissions'
import { conditionsOf, type RuleCondition } from '@/lib/rule-conditions'
import { applyMappingRulesToUnmappedRows } from '@/lib/actions'

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
 * The rules already say this, and they say it in full - not just by sku.
 * A rule like
 *
 *     Item name contains "Star Map for Anniversary Light"
 *     AND Custom options contains "U Shaped Base"
 *
 * is really two halves. The first half can be checked against the order report
 * on its own, and it is exactly the list of lines whose file is worth opening.
 * The second half is the part that needs the file. So: take every active rule
 * that asks about Custom options, throw away that one condition, and whatever
 * is left is the test for "does this line need downloading".
 *
 * Nothing here knows about star maps, item names or skus in particular. It
 * evaluates whatever conditions the rule happens to carry.
 * ------------------------------------------------------------------ */

/** The same fields the mapping matcher reads, minus the one that needs the file. */
function fieldValue(row: any, field: string) {
  if (field === 'sku') return String(row.platform_sku || '')
  if (field === 'item_name') return String(row.item_name || '')
  if (field === 'variation') return String(row.variation_text || '')
  if (field === 'customization') return String(row.customization_text || '')
  return ''
}

/** Must stay in step with the matcher in lib/actions.ts - same three types. */
function conditionHits(condition: RuleCondition, row: any) {
  const haystack = fieldValue(row, condition.field).toLowerCase()
  const needle = String(condition.value || '').trim().toLowerCase()
  if (!needle) return false
  if (condition.type === 'equals') return haystack === needle
  if (condition.type === 'starts_with') return haystack.startsWith(needle)
  return haystack.includes(needle)
}

type Narrowed = { others: RuleCondition[], anyLogic: boolean }

async function rulesThatNeedTheFile(supabase: any): Promise<Narrowed[]> {
  const { data } = await supabase
    .from('product_mapping_rules')
    .select('match_field, match_type, match_value, conditions, condition_logic, active')
    .eq('active', true)

  const out: Narrowed[] = []
  for (const rule of data || []) {
    const conds = conditionsOf(rule)
    if (!conds.some((c) => c.field === 'custom_options')) continue
    out.push({
      others: conds.filter((c) => c.field !== 'custom_options'),
      // "Any of these" means the Custom options condition could carry the rule
      // by itself, so the other conditions cannot rule a line out.
      anyLogic: ['or', 'any'].includes(String(rule.condition_logic || 'all').toLowerCase()),
    })
  }
  return out
}

function rowNeedsFile(row: any, rules: Narrowed[]) {
  for (const rule of rules) {
    if (rule.anyLogic || rule.others.length === 0) return true
    if (rule.others.every((c) => conditionHits(c, row))) return true
  }
  return false
}

/** Every custom line that has not been read yet, newest first. */
async function pendingRows(supabase: any, limit: number) {
  const { data } = await supabase
    .from('imported_order_rows')
    .select('id, platform_order_id, platform_sku, item_name, variation_text, customization_text')
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
  const rules = await rulesThatNeedTheFile(supabase)
  const rows = await pendingRows(supabase, MAX_ROWS)
  const wanted = rows.filter((r: any) => rowNeedsFile(r, rules))

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
    ruleCount: rules.length,
  }
}

/* ------------------------------------------------------------------ *
 * Reading the files.
 *
 * The files are small - about 85KB each - and the time is nearly all waiting on
 * Amazon rather than working, so eight run at once. The stop condition is a
 * clock, not a count, so a normal week finishes in one press.
 * ------------------------------------------------------------------ */
const CONCURRENCY = 8
const TIME_BUDGET_MS = 45000
const MAX_ROWS = 1000

export async function fetchAmazonCustomizations() {
  const perms = await getPermissions()
  if (!perms.canUploadOrders) {
    redirect(deniedUrl('/imported-orders', 'read the Amazon customization files'))
  }
  const supabase = await createClient()
  const startedAt = Date.now()

  const rules = await rulesThatNeedTheFile(supabase)
  const rows = (await pendingRows(supabase, MAX_ROWS)).filter((r: any) => rowNeedsFile(r, rules))

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

  /* The choices only matter because a rule is waiting on them. Mapping ran at
     upload time, before these lines had any options to match, so running it
     again here is what finishes the job - otherwise the page would read
     "13 read" and the same 13 lines would still sit there unmapped, which is
     exactly the half-done state this button exists to avoid. It is safe to run
     repeatedly: a line can only ever consume stock once. */
  if (done > 0) await applyMappingRulesToUnmappedRows()

  revalidatePath('/imported-orders')
  const parts = [done + ' order(s) read']
  if (failed) parts.push(failed + ' could not be read')
  if (stoppedEarly) parts.push('stopped on time - press again to carry on')
  redirect('/imported-orders?notice=' + encodeURIComponent(parts.join(', ')))
}
