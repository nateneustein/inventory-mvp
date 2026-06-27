import { requireUser } from '@/lib/require-user'
import { createProduct, createVariation } from '@/lib/actions'

export default async function ProductsPage() {
  const { supabase } = await requireUser()
  const { data: products } = await supabase.from('products').select('*').order('name')
  const { data: variations } = await supabase
    .from('product_variations')
    .select('*, products(name)')
    .order('created_at', { ascending: false })

  return (
    <>
      <h1>Products / Variations</h1>
      <p className="muted">Map every sellable variation to one internal SKU. Later, platform orders will map to these SKUs.</p>

      <div className="grid">
        <div className="card">
          <h2>Add product</h2>
          <form className="stack" action={createProduct}>
            <label>Product name<input name="name" required placeholder="Custom Night Light" /></label>
            <label>Product SKU, optional<input name="sku" placeholder="NL" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Add product</button>
          </form>
        </div>
        <div className="card">
          <h2>Add variation</h2>
          <form className="stack" action={createVariation}>
            <label>Product
              <select name="product_id" required>
                <option value="">Choose product</option>
                {(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Variation name<input name="variation_name" required placeholder="Dinosaur / color-changing base" /></label>
            <label>Internal SKU<input name="internal_sku" required placeholder="NL-DINO-COLOR" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Add variation</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Variations</h2>
        <table>
          <thead><tr><th>Product</th><th>Variation</th><th>Internal SKU</th><th>Notes</th></tr></thead>
          <tbody>
            {(variations || []).map((v: any) => (
              <tr key={v.id}>
                <td>{v.products?.name}</td><td>{v.variation_name}</td><td>{v.internal_sku}</td><td>{v.notes}</td>
              </tr>
            ))}
            {(variations || []).length === 0 && <tr><td colSpan={4}>No variations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
