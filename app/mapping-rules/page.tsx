import { requireUser } from '@/lib/require-user'
import { createMappingRule, updateMappingRule, deleteMappingRule, applyMappingRulesToUnmappedRows } from '@/lib/actions'

function variationLabel(v:any) {
  return `${v.products?.name} · ${v.variation_name} · ${v.internal_sku}`
}

function ruleTarget(r:any) {
  if (r.map_action === 'ignore') return 'Ignored / void line'
  return `${r.product_variations?.variation_name || ''} · ${r.product_variations?.internal_sku || ''}`
}

export default async function MappingRulesPage({ searchParams }: { searchParams?: Promise<{ q?: string, platform?: string, error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const platform = params.platform || ''
  const error = params.error || ''
  const notice = params.notice || ''
  const { supabase } = await requireUser()
  const { data: variations } = await supabase.from('product_variations').select('id, variation_name, internal_sku, products(name)').eq('active', true).order('internal_sku')
  const { data: allRules } = await supabase.from('product_mapping_rules').select('*, product_variations!variation_id(internal_sku, variation_name, products(name))').order('priority')
  const rules = (allRules || []).filter((r:any) => (!q || `${r.platform} ${r.account_name||''} ${r.match_field} ${r.match_value} ${r.map_action||''} ${r.product_variations?.internal_sku||''} ${r.product_variations?.variation_name||''}`.toLowerCase().includes(q.toLowerCase())) && (!platform || r.platform === platform))

  return (
    <>
      <div className="page-head"><div><h1>Product Mapping Rules</h1><p className="muted">Rules that decide how uploaded marketplace rows become internal finished products, or whether they should be ignored.</p></div><form action={applyMappingRulesToUnmappedRows}><button type="submit">Apply rules to existing rows</button></form></div>
      {error && <div className="card danger-soft"><strong>Rule was not saved:</strong> {error}</div>}
      {notice && <div className="card success-soft"><strong>{notice}</strong></div>}
      <div className="card alert"><strong>Tip:</strong> Use <b>Ignore / void line</b> for rows like BB FBA that should not touch inventory. Those rows will stop showing up as items needing attention. For multiple possible words like Stars, Butterfly, or Rainbow, create separate rules for each word unless the uploaded row contains the full phrase exactly.</div>
      <div className="card"><form className="filter-bar" action="/mapping-rules"><label>Search rules<input name="q" defaultValue={q} placeholder="SKU, product, variation, account" /></label><label className="compact">Platform<select name="platform" defaultValue={platform}><option value="">All</option><option value="all">All platforms</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option><option value="shopify">Shopify</option></select></label><button type="submit">Filter</button></form></div>

      <div className="card">
        <h2>Add mapping rule</h2>
        <form className="stack" action={createMappingRule}>
          <div className="form-row"><label>Platform<select name="platform" required><option value="all">All platforms</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok Shop</option><option value="shopify">Shopify</option></select></label><label>Account/shop name<input name="account_name" placeholder="Optional" /></label><label>Priority<input name="priority" type="number" defaultValue="100" /></label></div>
          <div className="form-row"><label>Match field<select name="match_field" required><option value="sku">SKU</option><option value="item_name">Item name</option><option value="variation">Variation</option><option value="customization">Customization</option></select></label><label>Match type<select name="match_type" required><option value="contains">contains</option><option value="equals">equals</option><option value="starts_with">starts with</option></select></label><label>Match value<input name="match_value" required placeholder="BB FBA, Pink Holder + Tag, etc." /></label></div>
          <div className="form-row"><label>What should happen?<select name="map_action" defaultValue="map"><option value="map">Map to finished product</option><option value="ignore">Ignore / void line</option></select></label><label>Actual finished product / variation used<select name="variation_id"><option value="">Choose variation, unless ignored</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label><label>Demand variation, optional<select name="demand_variation_id"><option value="">Same as actual</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label></div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add rule</button>
        </form>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Rules</h2><span className="badge info">{rules.length} shown</span></div><div className="wide-table"><table><thead><tr><th>Platform</th><th>Account</th><th>Rule</th><th>Action</th><th>Maps to</th><th>Priority</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{rules.map((r:any)=><tr key={r.id}><td>{r.platform}</td><td>{r.account_name || 'Any'}</td><td>{r.match_field} {r.match_type} “{r.match_value}”</td><td><span className={`badge ${r.map_action === 'ignore' ? 'ignored':'mapped'}`}>{r.map_action === 'ignore' ? 'void / ignore':'map'}</span></td><td>{ruleTarget(r)}</td><td>{r.priority}</td><td><span className={`badge ${r.active ? 'ok':'archived'}`}>{r.active ? 'active':'inactive'}</span></td><td>{r.notes}</td><td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateMappingRule}><input type="hidden" name="id" value={r.id}/><div className="form-row"><label>Platform<select name="platform" defaultValue={r.platform}><option value="all">All</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option><option value="shopify">Shopify</option></select></label><label>Account<input name="account_name" defaultValue={r.account_name || ''}/></label><label>Priority<input name="priority" type="number" defaultValue={r.priority}/></label></div><div className="form-row"><label>Field<select name="match_field" defaultValue={r.match_field}><option value="sku">SKU</option><option value="item_name">Item name</option><option value="variation">Variation</option><option value="customization">Customization</option></select></label><label>Type<select name="match_type" defaultValue={r.match_type}><option value="contains">contains</option><option value="equals">equals</option><option value="starts_with">starts with</option></select></label><label>Value<input name="match_value" defaultValue={r.match_value}/></label></div><div className="form-row"><label>Action<select name="map_action" defaultValue={r.map_action || 'map'}><option value="map">Map to finished product</option><option value="ignore">Ignore / void line</option></select></label><label>Actual variation<select name="variation_id" defaultValue={r.variation_id || ''}><option value="">None / ignored</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label><label>Demand variation<select name="demand_variation_id" defaultValue={r.demand_variation_id || ''}><option value="">Same as actual</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label></div><label className="small"><span><input name="active" type="checkbox" defaultChecked={r.active} style={{width:'auto', marginRight: 8}}/>Active</span></label><label>Notes<textarea name="notes" defaultValue={r.notes || ''}/></label><button type="submit">Save</button></form><form action={deleteMappingRule}><input type="hidden" name="id" value={r.id}/><button className="danger small-btn" type="submit">Delete rule</button></form></details></td></tr>)}{rules.length === 0 && <tr><td colSpan={9}><div className="empty-state">No rules match this filter.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
