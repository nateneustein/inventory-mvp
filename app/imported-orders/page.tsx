import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateImportedOrderRow, deleteImportedOrderRow, postImportedOrdersToInventory, voidImportedOrderRow, unvoidImportedOrderRow } from '@/lib/actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { VOID_REASONS } from '@/lib/void-reasons'
import { ActionButton } from '@/components/action-button'
import { fetchAmazonCustomizations } from '@/lib/customization-actions'

/* Reading the customization files means waiting on Amazon, eight downloads at a
   time, so this page is allowed longer than the default before it is cut off.
   Without it a press would die at ten seconds with the work half done. */
export const maxDuration = 60

function dedupeBadge(row:any) {
  if (row.voided_at) return <span className="badge voided">voided</span>
  if (row.dedupe_status === 'duplicate') return <span className="badge ignored">duplicate</span>
  return <span className="badge ok">new line</span>
}

export default async function ImportedOrdersPage({ searchParams }: { searchParams?: Promise<{ platform?: string, status?: string, dedupe?: string, q?: string, voided?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const voided = params.voided || ''
  const { supabase } = await requireUser()
  const { data: variations } = await supabase.from('product_variations').select('id, internal_sku, variation_name, products(name)').order('internal_sku')

  // How much mapped demand is still not reflected in stock.
  const { data: waiting } = await supabase
    .from('unposted_order_rows')
    .select('platform, account_name, rows_waiting, units_waiting, oldest_date')
  const totalWaiting = (waiting || []).reduce((sum:number, w:any) => sum + Number(w.rows_waiting || 0), 0)

  /* Amazon custom lines whose choices have not been read yet. A custom listing
     sells every variation under one sku, so until the order's own file is read
     these lines cannot be mapped to a part - they are not "unmapped because you
     forgot a rule", they are "unmapped because nothing yet knows what was
     bought", and that difference is worth showing. */
  const { count: customPending } = await supabase
    .from('imported_order_rows')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'amazon')
    .like('customization_text', 'http%')
    .is('custom_options', null)
  const { count: customRead } = await supabase
    .from('imported_order_rows')
    .select('id', { count: 'exact', head: true })
    .eq('custom_fetch_status', 'ok')
  const { count: customFailed } = await supabase
    .from('imported_order_rows')
    .select('id', { count: 'exact', head: true })
    .eq('custom_fetch_status', 'failed')
    .is('custom_options', null)

  let query = supabase.from('imported_order_rows').select('*, mapped:product_variations!imported_order_rows_mapped_variation_id_fkey(internal_sku, variation_name), demand:product_variations!imported_order_rows_demand_variation_id_fkey(internal_sku, variation_name)').order('created_at', { ascending: false }).limit(500)
  if (params.platform) query = query.eq('platform', params.platform)
  if (params.status) query = query.eq('mapping_status', params.status)
  if (params.dedupe) query = query.eq('dedupe_status', params.dedupe)
  if (voided === 'yes') query = query.not('voided_at', 'is', null)
  if (voided === 'no') query = query.is('voided_at', null)
  // Search has to run in the database. Filtering in JS only searched whichever
  // 500 rows happened to come back, so an order that existed but was older than
  // the newest 500 reported "no results".
  if (q) {
    const term = `%${q.replace(/[%_]/g, '')}%`
    query = query.or([
      `platform_order_id.ilike.${term}`,
      `external_line_key.ilike.${term}`,
      `platform_sku.ilike.${term}`,
      `item_name.ilike.${term}`,
      `variation_text.ilike.${term}`,
      `customization_text.ilike.${term}`,
      `account_name.ilike.${term}`,
    ].join(','))
  }
  const { data: allRows } = await query
  const rows = allRows || []

  return (
    <>
      <div className="page-head"><div><h1>Imported Orders</h1><p className="muted">Raw order rows from Etsy, Amazon, TikTok, and Shopify before they become inventory demand/usage.</p></div><Link className="button" href="/uploads">Upload CSV</Link></div>
      <div className="card alert"><strong>Duplicate protection:</strong> The system dedupes by marketplace order line, not only by order number. Same order with multiple real items still counts each item; overlapping spreadsheet uploads get marked duplicate and ignored for inventory.</div>

      {(customPending || customRead || customFailed) ? (
      <div className={customPending ? 'card danger-soft' : 'card'}>
        <h2>Amazon custom orders</h2>
        <p className="muted">
          An Amazon custom listing sells every variation under one SKU and one ASIN, so the order
          report cannot say which one was bought - two orders for completely different products look
          identical in it. What the buyer actually picked lives in the file behind that order&apos;s
          customized-url. Reading it fills in a <b>Custom options</b> field you can then write ordinary
          mapping rules against, for any custom listing, not just the ones you have today.
        </p>
        <p className="muted small">
          Only the dropdown choices are kept. The same file carries the buyer&apos;s names, message,
          date and location; those are read past and never stored.
        </p>
        <div className="action-row" style={{ marginTop: 10 }}>
          <span className="badge ok">{num(customRead || 0)} read</span>
          {(customPending || 0) > 0 && <span className="badge warn">{num(customPending || 0)} still to read</span>}
          {(customFailed || 0) > 0 && <span className="badge out">{num(customFailed || 0)} could not be read</span>}
        </div>
        {(customPending || 0) > 0 && (
          <form action={fetchAmazonCustomizations} style={{ marginTop: 10 }}>
            <ActionButton busyLabel="Reading…" doneLabel="Read">Read the {num(customPending || 0)} waiting</ActionButton>
            <span className="muted small" style={{ marginLeft: 10 }}>
              Eight downloads run at once, so a normal week finishes in one press. Each file is about
              85KB and comes from Amazon, not from this app&apos;s own storage - all that is kept here
              is the short list of choices. If a week is ever big enough to run out of time it stops
              cleanly and says so; press again to carry on. Anything that failed stays listed and is
              tried again, and nothing is ever downloaded twice.
            </span>
          </form>
        )}
      </div>
      ) : null}

      <div className={totalWaiting > 0 ? 'card danger-soft' : 'card success-soft'}>
        <h2>{totalWaiting > 0 ? `${totalWaiting} mapped order line(s) have not consumed stock yet` : 'All mapped order lines have consumed stock'}</h2>
        <p className="muted">
          Mapped order lines deduct their BOM parts from inventory. Cancelled and refunded
          lines, duplicates, and unmapped lines are skipped. Posting is safe to run as often
          as you like — each line can only ever consume stock once.
        </p>
        {(waiting || []).length > 0 && (
          <div className="wide-table"><table>
            <thead><tr><th>Platform</th><th>Account</th><th>Lines waiting</th><th>Units waiting</th><th>Oldest</th></tr></thead>
            <tbody>{(waiting || []).map((w:any) => (
              <tr key={`${w.platform}-${w.account_name || 'any'}`}>
                <td>{w.platform}</td><td>{w.account_name || '—'}</td>
                <td>{num(w.rows_waiting)}</td><td>{num(w.units_waiting)}</td>
                <td>{date(w.oldest_date)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <form action={postImportedOrdersToInventory}>
          <ActionButton disabled={totalWaiting === 0} busyLabel="Posting to inventory…" doneLabel="Posted">Post orders to inventory</ActionButton>
        </form>
      </div>
      <div className="card"><form className="filter-bar" action="/imported-orders"><label>Search<input name="q" defaultValue={q} placeholder="Order ID, line key, SKU, item, variation" /></label><label className="compact">Platform<select name="platform" defaultValue={params.platform || ''}><option value="">All</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option><option value="shopify">Shopify</option></select></label><label className="compact">Mapping<select name="status" defaultValue={params.status || ''}><option value="">All</option><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label><label className="compact">Import status<select name="dedupe" defaultValue={params.dedupe || ''}><option value="">All</option><option value="new">New lines only</option><option value="duplicate">Duplicates only</option></select></label><label className="compact">Voided<select name="voided" defaultValue={voided}><option value="">All</option><option value="no">Not voided</option><option value="yes">Voided only</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/imported-orders">Clear</Link></form></div>

      <div className="card table-card">
        <div className="table-head"><h2>Imported rows</h2><span className="badge info">{rows.length} shown</span></div>
        <div className="wide-table"><table>
          <thead><tr><th>Source</th><th>Account</th><th>Import status</th><th>Order ID</th><th>Line key</th><th>Date</th><th>Week</th><th>SKU</th><th>Qty</th><th>Item</th><th>Variation</th><th>Customization</th><th>Status</th><th>Mapping</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r:any) => (
              <tr key={r.id} className={r.voided_at ? 'voided-row' : r.dedupe_status === 'duplicate' ? 'muted-row' : ''}>
                <td>{r.platform}</td><td>{r.account_name}</td><td>{dedupeBadge(r)}<br/><span className="small muted">{r.external_line_key_source}</span></td><td><Link className="link" href={`/imported-orders/${r.id}`}>{r.platform_order_id}</Link></td><td><span className="small muted">{r.external_line_key}</span></td><td>{date(r.order_date_parsed || r.order_date)}</td><td>{date(r.week_start)}</td><td>{r.platform_sku}</td><td>{num(r.quantity)}</td><td>{r.item_name}</td><td>{r.variation_text}</td><td>{r.custom_options_text
                  ? r.custom_options_text
                  : r.custom_fetch_status === 'failed'
                    ? <span className="muted small" title={r.custom_fetch_error || ''}>could not be read</span>
                    : String(r.customization_text || '').startsWith('http')
                      ? <span className="muted small">not read yet</span>
                      : r.customization_text}</td><td>{r.order_status}</td><td><span className={`badge ${r.mapping_status}`}>{r.mapping_status}</span><br/><span className="small muted">{r.mapped?.internal_sku}</span></td>
                <td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateImportedOrderRow}><input type="hidden" name="id" value={r.id}/><label>Mapping status<select name="mapping_status" defaultValue={r.mapping_status}><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label><label>Actual variation<SearchSelect name="mapped_variation_id" defaultValue={r.mapped_variation_id || ''} placeholder="Type a product or variation" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label><label>Demand variation<SearchSelect name="demand_variation_id" defaultValue={r.demand_variation_id || ''} placeholder="Same as actual" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label><div className="action-row"><ActionButton busyLabel="Saving…" doneLabel="Saved">Save mapping</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div></form>{r.voided_at ? (<form className="stack card flat" action={unvoidImportedOrderRow}><input type="hidden" name="id" value={r.id}/><p className="small muted">Voided{r.void_reason ? ` — ${r.void_reason}` : ''}. It is not counting as a sale.</p><div className="action-row"><ActionButton className="small-btn secondary" confirm="Put this line back in play?" busyLabel="…" doneLabel="Restored">Un-void this line</ActionButton></div></form>) : (<form className="stack card flat" action={voidImportedOrderRow}><input type="hidden" name="id" value={r.id}/><p className="small muted">Void keeps the line but stops it counting, and puts back any parts it used.</p><label>Void reason<select name="void_reason" defaultValue="Replacement sent">{VOID_REASONS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label><label>Note (optional)<input name="void_note" placeholder="Broken in transit, resent" /></label><div className="action-row"><ActionButton className="danger small-btn" confirm="Confirm: void this line?" busyLabel="Voiding…" doneLabel="Voided">Void this line</ActionButton></div></form>)}<form action={deleteImportedOrderRow}><input type="hidden" name="id" value={r.id}/><div className="action-row"><ActionButton className="danger small-btn" confirm="Permanently delete this source row?" busyLabel="Deleting…" doneLabel="Deleted">Delete row</ActionButton></div></form></details></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={15}><div className="empty-state">No imported rows match this filter.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
