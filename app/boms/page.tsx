import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createBomItem, updateBomItem, deleteBomItem } from '@/lib/actions'
import { num } from '@/lib/format'

function match(b:any, q:string) {
  const v = b.product_variations
  return `${v?.internal_sku||''} ${v?.variation_name||''} ${v?.products?.name||''} ${b.parts?.sku||''} ${b.parts?.name||''}`.toLowerCase().includes(q.toLowerCase())
}

export default async function BomsPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: variations } = await supabase.from('product_variations').select('id, variation_name, internal_sku, product_id, products(name)').order('internal_sku')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sku')
  const { data: allBomItems } = await supabase.from('bom_items').select('*, parts(name, sku), product_variations(id, internal_sku, variation_name, product_id, products(name))').order('created_at', { ascending: false })
  const bomItems = (allBomItems || []).filter((b:any) => !q || match(b, q))

  return (
    <>
      <div className="page-head"><div><h1>BOM / Master File</h1><p className="muted">The recipe sheet: how much of each part is used for each finished product variation.</p></div><Link className="button secondary" href="/products">Products</Link></div>
      <div className="card"><form className="filter-bar" action="/boms"><label>Search BOM<input name="q" defaultValue={q} placeholder="Product, variation, SKU, part" /></label><button type="submit">Filter</button><Link className="button ghost" href="/boms">Clear</Link></form></div>

      <div className="card">
        <h2>Add BOM item</h2>
        <form className="stack" action={createBomItem}>
          <div className="form-row">
            <label>Finished product / variation<select name="variation_id" required><option value="">Choose variation</option>{(variations || []).map((v:any) => <option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}</select></label>
            <label>Part used<select name="part_id" required><option value="">Choose part</option>{(parts || []).map((p:any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
            <label>Qty used per unit<input name="quantity_per_unit" type="number" step="0.0001" required defaultValue="1" /></label>
          </div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add BOM item</button>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>BOM sheet</h2><span className="badge info">{bomItems.length} rows</span></div>
        <div className="wide-table"><table>
          <thead><tr><th>Product</th><th>Variation</th><th>Internal SKU</th><th>Part</th><th>Part SKU</th><th>Qty per unit</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>
            {bomItems.map((b:any) => (
              <tr key={b.id}>
                <td><Link className="link" href={`/products/${b.product_variations?.product_id}`}>{b.product_variations?.products?.name}</Link></td><td>{b.product_variations?.variation_name}</td><td>{b.product_variations?.internal_sku}</td><td><Link className="link" href={`/parts/${b.part_id}`}>{b.parts?.name}</Link></td><td>{b.parts?.sku}</td><td>{num(b.quantity_per_unit)}</td><td>{b.notes}</td>
                <td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateBomItem}><input type="hidden" name="id" value={b.id}/><label>Variation<select name="variation_id" defaultValue={b.variation_id}>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{v.internal_sku} · {v.variation_name}</option>)}</select></label><label>Part<select name="part_id" defaultValue={b.part_id}>{(parts || []).map((p:any)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><label>Qty<input name="quantity_per_unit" type="number" step="0.0001" defaultValue={b.quantity_per_unit}/></label><label>Notes<textarea name="notes" defaultValue={b.notes || ''}/></label><button type="submit">Save</button></form><form action={deleteBomItem}><input type="hidden" name="id" value={b.id}/><button className="danger small-btn" type="submit">Delete</button></form></details></td>
              </tr>
            ))}
            {bomItems.length === 0 && <tr><td colSpan={8}><div className="empty-state">No BOM rows match this search.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
