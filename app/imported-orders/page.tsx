import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateImportedOrderRow, deleteImportedOrderRow } from '@/lib/actions'
import { date, num } from '@/lib/format'

function rowMatch(r:any, q:string) {
  return `${r.platform_order_id||''} ${r.platform_sku||''} ${r.item_name||''} ${r.variation_text||''} ${r.customization_text||''} ${r.account_name||''}`.toLowerCase().includes(q.toLowerCase())
}

export default async function ImportedOrdersPage({ searchParams }: { searchParams?: Promise<{ platform?: string, status?: string, q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: variations } = await supabase.from('product_variations').select('id, internal_sku, variation_name, products(name)').order('internal_sku')

  let query = supabase.from('imported_order_rows').select('*, mapped:product_variations!imported_order_rows_mapped_variation_id_fkey(internal_sku, variation_name), demand:product_variations!imported_order_rows_demand_variation_id_fkey(internal_sku, variation_name)').order('created_at', { ascending: false }).limit(500)
  if (params.platform) query = query.eq('platform', params.platform)
  if (params.status) query = query.eq('mapping_status', params.status)
  const { data: allRows } = await query
  const rows = (allRows || []).filter((r:any) => !q || rowMatch(r, q))

  return (
    <>
      <div className="page-head"><div><h1>Imported Orders</h1><p className="muted">Raw order rows from Etsy, Amazon, TikTok, and Shopify before they become inventory demand/usage.</p></div><Link className="button" href="/uploads">Upload CSV</Link></div>
      <div className="card"><form className="filter-bar" action="/imported-orders"><label>Search<input name="q" defaultValue={q} placeholder="Order ID, SKU, item, variation, customization" /></label><label className="compact">Platform<select name="platform" defaultValue={params.platform || ''}><option value="">All</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option><option value="shopify">Shopify</option></select></label><label className="compact">Mapping<select name="status" defaultValue={params.status || ''}><option value="">All</option><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/imported-orders">Clear</Link></form></div>

      <div className="card table-card">
        <div className="table-head"><h2>Imported rows</h2><span className="badge info">{rows.length} shown</span></div>
        <div className="wide-table"><table>
          <thead><tr><th>Source</th><th>Account</th><th>Order ID</th><th>Date</th><th>Week</th><th>SKU</th><th>Qty</th><th>Item</th><th>Variation</th><th>Customization</th><th>Status</th><th>Mapping</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r:any) => (
              <tr key={r.id}>
                <td>{r.platform}</td><td>{r.account_name}</td><td><Link className="link" href={`/imported-orders/${r.id}`}>{r.platform_order_id}</Link></td><td>{date(r.order_date_parsed || r.order_date)}</td><td>{date(r.week_start)}</td><td>{r.platform_sku}</td><td>{num(r.quantity)}</td><td>{r.item_name}</td><td>{r.variation_text}</td><td>{r.customization_text}</td><td>{r.order_status}</td><td><span className={`badge ${r.mapping_status}`}>{r.mapping_status}</span><br/><span className="small muted">{r.mapped?.internal_sku}</span></td>
                <td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateImportedOrderRow}><input type="hidden" name="id" value={r.id}/><label>Mapping status<select name="mapping_status" defaultValue={r.mapping_status}><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label><label>Actual variation<select name="mapped_variation_id" defaultValue={r.mapped_variation_id || ''}><option value="">None</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}</select></label><label>Demand variation<select name="demand_variation_id" defaultValue={r.demand_variation_id || ''}><option value="">Same/none</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}</select></label><button type="submit">Save mapping</button></form><form action={deleteImportedOrderRow}><input type="hidden" name="id" value={r.id}/><button className="danger small-btn" type="submit">Delete row</button></form></details></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13}><div className="empty-state">No imported rows match this filter.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
