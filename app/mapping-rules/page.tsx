import { requireUser } from '@/lib/require-user'
import { createMappingRule } from '@/lib/actions'

export default async function MappingRulesPage() {
  const { supabase } = await requireUser()
  const { data: variations } = await supabase
    .from('product_variations')
    .select('id, variation_name, internal_sku, products(name)')
    .order('internal_sku')
  const { data: rules } = await supabase
    .from('product_mapping_rules')
    .select('*, product_variations(internal_sku, variation_name, products(name))')
    .order('priority')

  return (
    <>
      <h1>Product Mapping Rules</h1>
      <p className="muted">This is where we tell the system how to split imported variations into separate finished products. Example: passport holder colors are separate, but baby night light designs can all map to one product.</p>

      <div className="card">
        <h2>Add mapping rule</h2>
        <form className="stack" action={createMappingRule}>
          <div className="form-row">
            <label>Platform
              <select name="platform" required>
                <option value="all">All platforms</option>
                <option value="etsy">Etsy</option>
                <option value="amazon">Amazon</option>
                <option value="tiktok">TikTok Shop</option>
                <option value="shopify">Shopify</option>
              </select>
            </label>
            <label>Account/shop name<input name="account_name" placeholder="Optional" /></label>
            <label>Priority<input name="priority" type="number" defaultValue="100" /></label>
          </div>
          <div className="form-row">
            <label>Match field
              <select name="match_field" required>
                <option value="sku">SKU</option>
                <option value="item_name">Item name</option>
                <option value="variation">Variation</option>
                <option value="customization">Customization</option>
              </select>
            </label>
            <label>Match type
              <select name="match_type" required>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="starts_with">starts with</option>
              </select>
            </label>
            <label>Match value<input name="match_value" required placeholder="Pink Holder + Tag, BB-RN-H-PINK, Baby Night Light, etc." /></label>
          </div>
          <div className="form-row">
            <label>Actual finished product / variation used
              <select name="variation_id" required>
                <option value="">Choose variation</option>
                {(variations || []).map((v: any) => <option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}
              </select>
            </label>
            <label>Demand variation, optional
              <select name="demand_variation_id">
                <option value="">Same as actual</option>
                {(variations || []).map((v: any) => <option key={v.id} value={v.id}>{v.internal_sku} · {v.products?.name} · {v.variation_name}</option>)}
              </select>
            </label>
          </div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add rule</button>
        </form>
      </div>

      <div className="card">
        <h2>Rules</h2>
        <table>
          <thead><tr><th>Platform</th><th>Account</th><th>Rule</th><th>Maps to</th><th>Priority</th><th>Notes</th></tr></thead>
          <tbody>
            {(rules || []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.platform}</td><td>{r.account_name || 'Any'}</td><td>{r.match_field} {r.match_type} “{r.match_value}”</td><td>{r.product_variations?.internal_sku} · {r.product_variations?.variation_name}</td><td>{r.priority}</td><td>{r.notes}</td>
              </tr>
            ))}
            {(rules || []).length === 0 && <tr><td colSpan={6}>No mapping rules yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
