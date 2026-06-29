import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateImportedOrderRow, deleteImportedOrderRow } from '@/lib/actions'
import { date, num } from '@/lib/format'

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
          <dl className="detail-list"><div><dt>Order ID</dt><dd>{row.platform_order_id}</dd></div><div><dt>Date</dt><dd>{date(row.order_date)}</dd></div><div><dt>SKU</dt><dd>{row.platform_sku}</dd></div><div><dt>Qty</dt><dd>{num(row.quantity)}</dd></div><div><dt>Item</dt><dd>{row.item_name}</dd></div><div><dt>Variation</dt><dd>{row.variation_text}</dd></div><div><dt>Customization</dt><dd>{row.customization_text}</dd></div><div><dt>Status</dt><dd>{row.order_status}</dd></div><div><dt>File</dt><dd>{row.upload_batches?.file_name}</dd></div></dl>
        </div>
        <div className="card">
          <h2>Mapping / review</h2>
          <form className="stack" action={updateImportedOrderRow}>
            <input type="hidden" name="id" value={id}/>
            <label>Mapping status<select name="mapping_status" defaultValue={row.mapping_status}><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option><option value="needs_review">Needs review</option><option value="ignored">Ignored</option></select></label>
            <label>Actual variation used<select name="mapped_variation_id" defaultValue={row.mapped_variation_id || ''}><option value="">None</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}</select></label>
            <label>Demand variation<select name="demand_variation_id" defaultValue={row.demand_variation_id || ''}><option value="">Same/none</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}</select></label>
            <button type="submit">Save mapping</button>
          </form>
          <form action={deleteImportedOrderRow}><input type="hidden" name="id" value={id}/><button className="danger" type="submit">Delete imported row</button></form>
        </div>
      </div>
      <div className="card table-card"><div className="table-head"><h2>Raw source data</h2></div><table><thead><tr><th>Column</th><th>Value</th></tr></thead><tbody>{Object.entries(raw).map(([k,v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}</tbody></table></div>
    </>
  )
}
