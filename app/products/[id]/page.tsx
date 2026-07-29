import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateProduct, archiveProduct, updateVariation, archiveVariation, createVariation, createBomItem, updateBomItem, deleteBomItem } from '@/lib/actions'
import { num } from '@/lib/format'
import { ActionButton } from '@/components/action-button'
import { SearchSelect } from '@/components/search-select'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: product } = await supabase.from('products').select('*').eq('id', id).single()
  const { data: variations } = await supabase.from('product_variations').select('*').eq('product_id', id).order('internal_sku')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sku')
  const variationIds = (variations || []).map((v:any) => v.id)
  const { data: bomItems } = variationIds.length ? await supabase.from('bom_items').select('*, parts(name, sku), product_variations(internal_sku, variation_name)').in('variation_id', variationIds).order('created_at', { ascending: false }) : { data: [] as any[] }

  if (!product) return <div className="card"><h1>Product not found</h1><Link className="button" href="/products">Back</Link></div>

  return (
    <>
      <div className="page-head"><div><h1>{product.name}</h1><p className="muted">Product setup, internal variations, and BOM recipes.</p></div><div className="action-row"><Link className="button secondary" href="/products">Back</Link><Link className="button" href="/mapping-rules">Mapping rules</Link></div></div>
      <div className="grid two">
        <div className="card">
          <h2>Edit product</h2>
          <form className="stack" action={updateProduct}>
            <input type="hidden" name="id" value={id} />
            <label>Name<input name="name" defaultValue={product.name || ''} required /></label>
            <label>SKU<input name="sku" defaultValue={product.sku || ''} /></label>
            <label className="small"><span><input name="active" type="checkbox" defaultChecked={product.active} style={{ width:'auto', marginRight: 8 }} />Active</span></label>
            <label>Notes<textarea name="notes" defaultValue={product.notes || ''} /></label>
            <button type="submit">Save product</button>
          </form>
          <form action={archiveProduct}><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={product.active ? 'false' : 'true'} /><button className="danger" type="submit">{product.active ? 'Archive product' : 'Restore product'}</button></form>
        </div>
        <div className="card">
          <details className="add-panel"><summary className="button">+ Add variation</summary></details>
          <form className="stack" action={createVariation}>
            <input type="hidden" name="product_id" value={id} />
            <label>Variation name<input name="variation_name" required /></label>
            <label>Internal SKU<input name="internal_sku" required /></label>
            <label>Notes<textarea name="notes" /></label>
            <div className="action-row"><button type="submit">Add variation</button><button type="button" className="button secondary cancel-btn">Cancel</button></div>
          </form>
        </div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Variations</h2></div><div className="wide-table"><table><thead><tr><th>Variation</th><th>Internal SKU</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{(variations || []).map((v:any) => <tr key={v.id}><td>{v.variation_name}</td><td>{v.internal_sku}</td><td><span className={`badge ${v.active ? 'ok' : 'archived'}`}>{v.active ? 'active' : 'archived'}</span></td><td>{v.notes}</td><td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateVariation}><input type="hidden" name="id" value={v.id}/><input type="hidden" name="product_id" value={id}/><label>Variation<input name="variation_name" defaultValue={v.variation_name}/></label><label>Internal SKU<input name="internal_sku" defaultValue={v.internal_sku}/></label><label className="small"><span><input name="active" type="checkbox" defaultChecked={v.active} style={{ width:'auto', marginRight:8 }}/>Active</span></label><label>Notes<textarea name="notes" defaultValue={v.notes || ''}/></label><div className="action-row"><button type="submit">Save</button><button type="button" className="button secondary cancel-btn">Cancel</button></div></form><form action={archiveVariation}><input type="hidden" name="id" value={v.id}/><input type="hidden" name="product_id" value={id}/><input type="hidden" name="active" value={v.active ? 'false' : 'true'}/><button className="danger small-btn" type="submit">{v.active ? 'Archive' : 'Restore'}</button></form></details></td></tr>)}{(variations || []).length === 0 && <tr><td colSpan={5}><div className="empty-state">No variations yet.</div></td></tr>}</tbody></table></div></div>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Add BOM item</summary></details>
        <form className="stack" action={createBomItem}>
          <div className="form-row"><label>Variation<SearchSelect name="variation_id" required placeholder="Type a variation" options={(variations || []).map((v: any) => ({ value: v.id, label: v.variation_name, hint: v.internal_sku }))} /></label><label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Qty per unit<input name="quantity_per_unit" type="number" step="0.0001" required defaultValue="1" /></label></div>
          <label>Notes<textarea name="notes" /></label>
          <div className="action-row"><button type="submit">Add BOM item</button><button type="button" className="button secondary cancel-btn">Cancel</button></div>
        </form>
      </div>

      <div className="card table-card"><div className="table-head"><h2>BOM recipe for this product</h2><Link className="button small-btn secondary" href="/boms">Full BOM sheet</Link></div><table><thead><tr><th>Variation</th><th>Part</th><th>Qty per unit</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{(bomItems || []).map((b:any) => <tr key={b.id}><td className="name-cell">{b.product_variations?.variation_name}<span className="sku-under">{b.product_variations?.internal_sku}</span></td><td className="name-cell">{b.parts?.name}<span className="sku-under">{b.parts?.sku}</span></td><td>{num(b.quantity_per_unit)}</td><td>{b.notes}</td><td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateBomItem}><input type="hidden" name="id" value={b.id}/><label>Variation<SearchSelect name="variation_id" defaultValue={b.variation_id} placeholder="Type a variation" options={(variations || []).map((v: any) => ({ value: v.id, label: v.variation_name, hint: v.internal_sku }))} /></label><label>Part<SearchSelect name="part_id" defaultValue={b.part_id} placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Qty<input name="quantity_per_unit" type="number" step="0.0001" defaultValue={b.quantity_per_unit}/></label><label>Notes<textarea name="notes" defaultValue={b.notes || ''}/></label><div className="action-row"><button type="submit">Save</button><button type="button" className="button secondary cancel-btn">Cancel</button></div></form><form action={deleteBomItem}><input type="hidden" name="id" value={b.id}/><div className="action-row"><ActionButton className="danger small-btn" confirm="Delete this BOM line?" busyLabel="…" doneLabel="Deleted">Delete</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div></form></details></td></tr>)}{(bomItems || []).length === 0 && <tr><td colSpan={5}><div className="empty-state">No BOM items for this product yet.</div></td></tr>}</tbody></table></div>
    </>
  )
}
