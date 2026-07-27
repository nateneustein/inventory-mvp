import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateImportedOrderRow, deleteImportedOrderRow } from '@/lib/actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'

export default async function ImportedOrderRowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: row } = await supabase.from('imported_order_rows').select('*, upload_batches(file_name), mapped:product_variations!imported_order_rows_mapped_variation_id_fkey(internal_sku, variation_name, products(name)), demand:product_variations!imported_order_rows_demand_variation_id_fkey(internal_sku, variation_name, products(name))').eq('id', id).single()
  const { data: variations } = await supabase.from('product_variations').select('id, internal_sku, variation_name, products(name)').order('internal_sku')

  if (!row) return <div className="card"><h1>Imported row not found</h1><Link className="button" href="/imported-orders">Back</Link></div>
  const raw = row.raw_data || {}

  return (
    <>
      <div className="page-head"><div><h1>Imported order row</h1><p className="muted">Source row from {row.platform} · {row.account_name}</p></div><Link className="button secondary" href="/imported-orders">Back to imported orders</Link></div>
      <div className="grid two">
        <div className="card">
          <h2>Order details</h2>
          <dl className="detail-list"><div><dt>Import status</dt><dd><span className={`badge ${row.dedupe_status === 'duplicate' ? 'ignored' : 'ok'}`}>{row.dedupe_status || 'new'}</span></dd></div><div><dt>Line key</dt><dd>{row.external_line_key}</dd></div><div><dt>Line key source</dt><dd>{row.external_line_key_source}</dd></div><div><dt>Order ID</dt><dd>{row.platform_order_id}</dd></div><div><dt>Date</dt><dd>{date(row.order_date_parsed || row.order_date)}</dd></div><div><dt>Week start</dt><dd>{date(row.week_start)}</dd></div><div><dt>SKU</dt><dd>{row.platform_sku}</dd></div><div><dt>Qty</dt><dd>{num(row.quantity)}</dd></div><div><dt>Item</dt><dd>{row.item_name}</dd></div><div><dt>Variation</dt><dd>{row.variation_text}</dd></div><div><dt>Customization</dt><dd>{row.customization_text}</dd></div><div><dt>Status</dt><dd>{row.order_status}</dd></div><div><dt>File</dt><dd>{row.upload_batches?.file_name}</dd></div></dl>
        </div>
        <div className="card">
          <h2>Mapping / review</h2>{row.dedupe_status === 'duplicate' && <div className="card alert"><strong>Duplicate line:</strong> This row came from an overlapping upload and is ignored so it does not count twice. Keep it ignored unless you are sure this is a separate real line.</div>}
          <form className="stack" action={updateImportedOrderRow}>
            <input type="hidden" name="id" value={id}/>
            <label>Mapping status<select name="mapping_status" defaultValue={row.mapping_status}><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label>
            <label>Actual variation used<SearchSelect name="mapped_variation_id" defaultValue={row.mapped_variation_id || ''} placeholder="Type a product or variation" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.internal_sku} · ${v.products?.name} · ${v.variation_name}` }))} /></label>
            <label>Demand variation<SearchSelect name="demand_variation_id" defaultValue={row.demand_variation_id || ''} placeholder="Same as actual" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.internal_sku} · ${v.products?.name} · ${v.variation_name}` }))} /></label>
            <button type="submit">Save mapping</button>
          </form>
          <form action={deleteImportedOrderRow}><input type="hidden" name="id" value={id}/><button className="danger" type="submit">Delete imported row</button></form>
        </div>
      </div>
      <div className="card table-card"><div className="table-head"><h2>Raw source data</h2></div><table><thead><tr><th>Column</th><th>Value</th></tr></thead><tbody>{Object.entries(raw).map(([k,v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}</tbody></table></div>
    </>
  )
}
