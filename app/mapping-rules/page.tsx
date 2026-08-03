import { requireUser } from '@/lib/require-user'
import { createMappingRule, updateMappingRule, deleteMappingRule, applyMappingRulesToUnmappedRows } from '@/lib/actions'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'
import { RuleConditions } from '@/components/rule-conditions'
import { conditionSummary } from '@/lib/rule-conditions'
import { StickySelect } from '@/components/sticky-select'

function variationLabel(v:any) {
  return `${v.variation_name || ''} · ${v.products?.name || ''}`
}

function ruleTarget(r:any) {
  if (r.map_action === 'ignore') return 'Ignored / void line'
  return `${r.product_variations?.internal_sku || ''} · ${r.product_variations?.variation_name || ''}`
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
  const rules = (allRules || []).filter((r:any) => (!q || `${r.platform} ${r.account_name||''} ${r.match_field} ${r.match_value} ${(Array.isArray(r.conditions) ? r.conditions : []).map((c:any) => `${c?.field||''} ${c?.value||''}`).join(' ')} ${r.map_action||''} ${r.product_variations?.internal_sku||''} ${r.product_variations?.variation_name||''}`.toLowerCase().includes(q.toLowerCase())) && (!platform || r.platform === platform))

  return (
    <>
      <div className="page-head"><div><h1>Product Mapping Rules</h1><p className="muted">Rules that decide how uploaded marketplace rows become internal finished products, or whether they should be ignored.</p></div><form action={applyMappingRulesToUnmappedRows}><ActionButton busyLabel="Applying rules…" doneLabel="Rules applied">Apply rules to existing rows</ActionButton></form></div>
      {error && <div className="card danger-soft"><strong>Rule was not saved:</strong> {error}</div>}
      {notice && <div className="card success-soft"><strong>{notice}</strong></div>}
      <div className="card alert"><strong>Tip:</strong> Use <b>Ignore / void line</b> for rows like BB FBA that should not touch inventory. Those rows will stop showing up as items needing attention. A rule can have more than one condition. Pick <b>ALL of these</b> when every condition has to be true — say the item name contains “holder” <b>and</b> the variation contains “pink”. Pick <b>ANY of these</b> for alternatives, like a variation containing Stars, Butterfly, <b>or</b> Rainbow, which used to need a separate rule per word.</div>
      <div className="card"><form className="filter-bar" action="/mapping-rules"><label>Search rules<input name="q" defaultValue={q} placeholder="SKU, product, variation, account" /></label><label className="compact">Platform<select name="platform" defaultValue={platform}><option value="">All</option><option value="all">All platforms</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option><option value="shopify">Shopify</option></select></label><button type="submit">Filter</button></form></div>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Add mapping rule</summary></details>
        <form className="stack" action={createMappingRule}>
          <div className="form-row"><label>Platform<select name="platform" required><option value="all">All platforms</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok Shop</option><option value="shopify">Shopify</option></select></label><label>Account/shop name<input name="account_name" placeholder="Optional" /></label><label>Priority<input name="priority" type="number" defaultValue="100" /></label></div>
          <RuleConditions idPrefix="new-rule" />
          <div className="form-row"><label>What should happen?<select name="map_action" defaultValue="map"><option value="map">Map to finished product</option><option value="ignore">Ignore / void line</option></select></label><label>Actual finished product / variation used<SearchSelect name="variation_id" placeholder="Type a product or variation" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label><label>Demand variation, optional<SearchSelect name="demand_variation_id" placeholder="Same as actual" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label></div>
          <label>Notes<textarea name="notes" /></label>
          <div className="action-row"><ActionButton busyLabel="Adding rule…" doneLabel="Rule added">Add rule</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
        </form>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Rules</h2><span className="badge info">{rules.length} shown</span></div><div className="wide-table"><table><thead><tr><th>Platform</th><th>Account</th><th>Rule</th><th>Action</th><th>Maps to</th><th>Priority</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{rules.map((r:any)=><tr key={r.id}><td>{r.platform}</td><td>{r.account_name || 'Any'}</td><td className="rule-summary-cell">{conditionSummary(r)}</td><td><span className={`badge ${r.map_action === 'ignore' ? 'ignored':'mapped'}`}>{r.map_action === 'ignore' ? 'void / ignore':'map'}</span></td><td>{ruleTarget(r)}</td><td>{r.priority}</td><td><span className={`badge ${r.active ? 'ok':'archived'}`}>{r.active ? 'active':'inactive'}</span></td><td>{r.notes}</td><td><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updateMappingRule}><input type="hidden" name="id" value={r.id}/><div className="form-row"><label>Platform<StickySelect name="platform" value={r.platform}><option value="all">All</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option><option value="shopify">Shopify</option></StickySelect></label><label>Account<input name="account_name" defaultValue={r.account_name || ''}/></label><label>Priority<input name="priority" type="number" defaultValue={r.priority}/></label></div><RuleConditions idPrefix={`rule-${r.id}`} defaultConditions={(Array.isArray(r.conditions) && r.conditions.length) ? r.conditions : [{ field: r.match_field || 'sku', type: r.match_type || 'contains', value: r.match_value || '' }]} defaultLogic={r.condition_logic || 'all'} /><div className="form-row"><label>Action<select name="map_action" defaultValue={r.map_action || 'map'}><option value="map">Map to finished product</option><option value="ignore">Ignore / void line</option></select></label><label>Actual variation<SearchSelect name="variation_id" defaultValue={r.variation_id || ''} placeholder="None / ignored" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label><label>Demand variation<SearchSelect name="demand_variation_id" defaultValue={r.demand_variation_id || ''} placeholder="Same as actual" options={(variations || []).map((v: any) => ({ value: v.id, label: `${v.variation_name || ''} · ${v.products?.name || ''}`, hint: v.internal_sku }))} /></label></div><label className="checkbox"><input name="active" type="checkbox" defaultChecked={r.active}/>Active</label><label>Notes<textarea name="notes" defaultValue={r.notes || ''}/></label><div className="action-row"><ActionButton busyLabel="Saving…" doneLabel="Saved">Save</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div></form><form action={deleteMappingRule}><input type="hidden" name="id" value={r.id}/><div className="action-row"><ActionButton className="danger small-btn" confirm="Really delete this rule?" busyLabel="Deleting…" doneLabel="Deleted">Delete rule</ActionButton></div></form></details></td></tr>)}{rules.length === 0 && <tr><td colSpan={9}><div className="empty-state">No rules match this filter.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
