import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createProduct, createVariation, archiveProduct, archiveVariation } from '@/lib/actions'
import { deleteProduct, deleteVariation } from '@/lib/record-actions'

function match(row:any, q:string) {
  return `${row.name||''} ${row.sku||''} ${row.variation_name||''} ${row.internal_sku||''}`.toLowerCase().includes(q.toLowerCase())
}

export default async function ProductsPage({ searchParams }: { searchParams?: Promise<{ q?: string, active?: string, error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const active = params.active || ''
  const { supabase } = await requireUser()
  const { data: allProducts } = await supabase.from('products').select('*').order('name')
  const { data: allVariations } = await supabase.from('product_variations').select('*, products(name)').order('created_at', { ascending: false })
  const products = (allProducts || []).filter((p:any) => (!q || match(p, q)) && (!active || String(p.active) === active))
  const variations = (allVariations || []).filter((v:any) => !q || match({ ...v, name: v.products?.name }, q))

  return (
    <>
      <div className="page-head"><div><h1>Finished Products</h1><p className="muted">Internal products and variations that imported orders map into.</p></div><Link className="button secondary" href="/mapping-rules">Mapping rules</Link></div>
      {params.error && <div className="card danger-soft"><strong>Product change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card"><form className="filter-bar" action="/products"><label>Search products / SKUs<input name="q" defaultValue={q} placeholder="Passport holder, NL, pink, etc." /></label><label className="compact">Status<select name="active" defaultValue={active}><option value="">All</option><option value="true">Active</option><option value="false">Archived</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/products">Clear</Link></form></div>

      <div className="grid two">
        <div className="card">
          <details className="add-panel"><summary className="button">+ Add product</summary></details>
          <form className="stack" action={createProduct}>
            <label>Product name<input name="name" required placeholder="Custom Night Light" /></label>
            <label>Product SKU, optional<input name="sku" placeholder="NL" /></label>
            <label>Notes<textarea name="notes" /></label>
            <div className="action-row"><button type="submit">Add product</button><button type="button" className="button secondary cancel-btn">Cancel</button></div>
          </form>
        </div>
        <div className="card">
          <details className="add-panel"><summary className="button">+ Add variation</summary></details>
          <form className="stack" action={createVariation}>
            <label>Product<select name="product_id" required><option value="">Choose product</option>{(allProducts || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Variation name<input name="variation_name" required placeholder="Pink Holder + Tag" /></label>
            <label>Internal SKU<input name="internal_sku" required placeholder="PH-PINK-HOLDER-TAG" /></label>
            <label>Notes<textarea name="notes" /></label>
            <div className="action-row"><button type="submit">Add variation</button><button type="button" className="button secondary cancel-btn">Cancel</button></div>
          </form>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Products</h2><span className="badge info">{products.length} shown</span></div>
        <table><thead><tr><th>Product</th><th>SKU</th><th>Status</th><th>Notes</th><th className="actions-cell">Actions</th></tr></thead><tbody>{products.map((p:any) => <tr key={p.id}><td><Link className="link" href={`/products/${p.id}`}>{p.name}</Link></td><td>{p.sku}</td><td><span className={`badge ${p.active ? 'ok' : 'archived'}`}>{p.active ? 'active' : 'archived'}</span></td><td>{p.notes}</td><td><div className="action-row"><Link className="button small-btn secondary" href={`/products/${p.id}`}>Open</Link><form action={archiveProduct}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? 'false' : 'true'} /><button className="small-btn ghost" type="submit">{p.active ? 'Archive' : 'Restore'}</button></form><form action={deleteProduct}><input type="hidden" name="id" value={p.id} /><button className="small-btn danger" type="submit">Remove</button></form></div></td></tr>)}{products.length === 0 && <tr><td colSpan={5}><div className="empty-state">No products match this filter.</div></td></tr>}</tbody></table>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Variations</h2><Link className="button small-btn secondary" href="/boms">BOMs</Link></div>
        <div className="wide-table"><table><thead><tr><th>Product</th><th>Variation</th><th>Internal SKU</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{variations.map((v:any) => <tr key={v.id}><td>{v.products?.name}</td><td>{v.variation_name}</td><td>{v.internal_sku}</td><td><span className={`badge ${v.active ? 'ok' : 'archived'}`}>{v.active ? 'active' : 'archived'}</span></td><td>{v.notes}</td><td><div className="action-row"><Link className="button small-btn secondary" href={`/products/${v.product_id}`}>Open product</Link><form action={archiveVariation}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="product_id" value={v.product_id} /><input type="hidden" name="active" value={v.active ? 'false' : 'true'} /><button className="small-btn ghost" type="submit">{v.active ? 'Archive' : 'Restore'}</button></form><form action={deleteVariation}><input type="hidden" name="id" value={v.id} /><button className="small-btn danger" type="submit">Remove</button></form></div></td></tr>)}{variations.length === 0 && <tr><td colSpan={6}><div className="empty-state">No variations yet.</div></td></tr>}</tbody></table></div>
      </div>
    </>
  )
}
