import { requireUser } from '@/lib/require-user'
import { createBomItem } from '@/lib/actions'
import { num } from '@/lib/format'

export default async function BomsPage() {
  const { supabase } = await requireUser()
  const { data: variations } = await supabase
    .from('product_variations')
    .select('id, variation_name, internal_sku, products(name)')
    .order('internal_sku')
  const { data: parts } = await supabase.from('parts').select('id, name, sku, unit').order('name')
  const { data: bomItems } = await supabase
    .from('bom_items')
    .select('*, parts(name, sku, unit), product_variations(variation_name, internal_sku, products(name))')
    .order('created_at', { ascending: false })

  return (
    <>
      <h1>BOM Recipes</h1>
      <p className="muted">Each sellable variation needs a recipe of the parts it consumes.</p>

      <div className="card">
        <h2>Add BOM item</h2>
        <form className="stack" action={createBomItem}>
          <div className="form-row">
            <label>Variation
              <select name="variation_id" required>
                <option value="">Choose variation</option>
                {(variations || []).map((v: any) => (
                  <option key={v.id} value={v.id}>{v.internal_sku} - {v.products?.name} - {v.variation_name}</option>
                ))}
              </select>
            </label>
            <label>Part
              <select name="part_id" required>
                <option value="">Choose part</option>
                {(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
              </select>
            </label>
            <label>Quantity per unit<input name="quantity_per_unit" type="number" step="0.0001" defaultValue="1" required /></label>
          </div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add to BOM</button>
        </form>
      </div>

      <div className="card">
        <h2>BOM list</h2>
        <table>
          <thead><tr><th>Variation SKU</th><th>Product</th><th>Variation</th><th>Part</th><th>Qty per unit</th><th>Unit</th></tr></thead>
          <tbody>
            {(bomItems || []).map((b: any) => (
              <tr key={b.id}>
                <td>{b.product_variations?.internal_sku}</td>
                <td>{b.product_variations?.products?.name}</td>
                <td>{b.product_variations?.variation_name}</td>
                <td>{b.parts?.sku} - {b.parts?.name}</td>
                <td>{num(b.quantity_per_unit, 4)}</td>
                <td>{b.parts?.unit}</td>
              </tr>
            ))}
            {(bomItems || []).length === 0 && <tr><td colSpan={6}>No BOM items yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
