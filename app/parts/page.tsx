import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createPart, archivePart, setPartIgnoreAlerts } from '@/lib/actions'
import { deletePart } from '@/lib/record-actions'
import { num, supplierHint } from '@/lib/format'
import { CoverCell } from '@/components/cover-cell'
import { SearchSelect } from '@/components/search-select'
import { ActionButton } from '@/components/action-button'

function matches(row: any, q: string) {
  const hay = `${row.name || ''} ${row.sku || ''} ${row.category || ''}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

export default async function PartsPage({ searchParams }: { searchParams?: Promise<{ q?: string, status?: string, category?: string, alerts?: string, error?: string, notice?: string, unlisted?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const status = params.status || ''
  const category = params.category || ''
  const alerts = params.alerts || ''
  const { supabase } = await requireUser()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name, contact_name, email, phone').order('name')
  const { data: allParts } = await supabase.from('inventory_status').select('*').order('sort_order', { ascending: true, nullsFirst: false }).order('name')

  const categories = Array.from(new Set((allParts || []).map((p: any) => p.category).filter(Boolean))).sort()
  const parts = (allParts || []).filter((p: any) => (!q || matches(p, q)) && (!status || p.stock_status === status) && (!category || p.category === category)
    && (!alerts || (alerts === 'off' ? p.ignore_alerts : !p.ignore_alerts)))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Parts / Supplies</h1>
          <p className="muted">Raw inventory with quick actions, reorder settings, supplier links, and QR-friendly part pages.</p>
        </div>
        <Link className="button secondary" href="/scanner">Scanner page</Link>
      </div>
      {params.error && <div className="card danger-soft"><strong>Part change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card">
        <form className="filter-bar" action="/parts">
          <label>Search<input name="q" defaultValue={q} placeholder="Search name, SKU, category" /></label>
          <label className="compact">Status<select name="status" defaultValue={status}><option value="">All</option><option value="out">Out</option><option value="reorder_now">Reorder now</option><option value="getting_low">Getting low</option><option value="ok">OK</option></select></label>
          <label className="compact">Category<select name="category" defaultValue={category}><option value="">All</option>{categories.map((c: any) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="compact">Alerts<select name="alerts" defaultValue={alerts}><option value="">All parts</option><option value="on">Alerting</option><option value="off">Ignored</option></select></label>
          <button type="submit">Filter</button>
          <Link className="button ghost" href="/parts">Clear</Link>
        </form>
      </div>

      <div className="card">
        <details className="add-panel"><summary className="button">+ Add part</summary></details>
        <form className="stack" action={createPart}>
          <div className="form-row"><label>Part name<input name="name" required /></label><label>Internal SKU<input name="sku" required placeholder="LED-BASE-WHITE" /></label><label>Category<input name="category" placeholder="Acrylic, packaging, base, etc." /></label></div>
          <div className="form-row"><label>Supplier<SearchSelect name="supplier_id" placeholder="No supplier yet" options={(suppliers || []).map((s: any) => ({ value: s.id, label: s.name, hint: supplierHint(s) }))} /></label><label>Supplier part #<input name="supplier_part_number" /></label><label>Unit<input name="unit" defaultValue="each" /></label></div>
          <div className="form-row"><label>Lead time min days<input name="lead_time_days_min" type="number" step="0.01" defaultValue="0" /></label><label>Lead time max days<input name="lead_time_days_max" type="number" step="0.01" defaultValue="0" /></label><label>Safety stock days<input name="safety_stock_days" type="number" step="0.01" defaultValue="30" /></label></div>
          <div className="form-row">{/* Reorder point is no longer used - cover days drive the alerts now. Kept as a hidden zero so existing rows and the create action keep working. */}
<input type="hidden" name="reorder_point" value="0" />
<label>Target stock<input name="target_stock" type="number" step="0.01" defaultValue="0" /></label><label>Default order qty<input name="default_order_quantity" type="number" step="0.01" defaultValue="0" /></label></div>
          <label className="checkbox"><input name="critical" type="checkbox" />Critical part, production stops if this runs out</label>
          <label>Notes<textarea name="notes" /></label>
          <div className="action-row"><ActionButton busyLabel="Adding…" doneLabel="Part added">Add part</ActionButton><button type="button" className="button secondary cancel-btn">Cancel</button></div>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Part inventory</h2><div className="table-tools"><span className="badge info">{parts.length} shown</span></div></div>
        <div className="wide-table compact-rows"><table><thead><tr><th>Part</th><th>SKU</th><th>Category</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Reorder at</th><th>Cover / risk</th><th>Status</th><th className="actions-cell">Actions</th></tr></thead><tbody>{parts.map((p: any) => <tr key={p.part_id}><td className="name-cell"><Link className="link" href={`/parts/${p.part_id}`}>{p.name}</Link></td><td className="sku-cell" title={p.sku}>{p.sku}</td><td>{p.category}</td><td>{num(p.on_hand)}</td><td>{num(p.incoming_qty)}</td><td>{num(p.projected_qty)}</td><td className="target-cell">{num(p.reorder_horizon_days)} days<span className="sku-under">of cover wanted</span></td><CoverCell row={p} /><td><span className={`badge ${p.ignore_alerts ? 'ignored-alerts' : p.stock_status}`}>{p.stock_status}</span>{p.ignore_alerts && <span className="badge ignored-alerts" style={{ marginLeft: 6 }}>alerts off</span>}</td><td className="actions-cell"><div className="action-row"><Link className="button small-btn secondary" href={`/parts/${p.part_id}`}>Open</Link><details className="row-menu"><summary className="row-menu-btn" title="More actions for this part">⋯</summary><div className="row-menu-list"><form className="inline-form" action={setPartIgnoreAlerts}><input type="hidden" name="id" value={p.part_id} /><input type="hidden" name="ignore_alerts" value={p.ignore_alerts ? 'false' : 'true'} /><ActionButton className="small-btn ghost" title={p.ignore_alerts ? 'Start alerting on this part again' : 'Stop this part raising stock alerts'} confirm={p.ignore_alerts ? `Alert on ${p.name} again?` : `Stop alerts for ${p.name}?`} busyLabel="…" doneLabel="Saved">{p.ignore_alerts ? 'Turn alerts ON' : 'Turn alerts OFF'}</ActionButton></form><Link className="button small-btn" href={`/predictions/advanced?part_id=${p.part_id}`}>Reorder</Link><form className="inline-form" action={archivePart}><input type="hidden" name="id" value={p.part_id} /><input type="hidden" name="active" value={p.active ? 'false' : 'true'} /><ActionButton className="small-btn ghost" confirm={p.active ? `Archive ${p.name}?` : `Restore ${p.name}?`} busyLabel="…" doneLabel="Saved">{p.active ? 'Archive' : 'Restore'}</ActionButton></form><form className="inline-form" action={deletePart}><input type="hidden" name="id" value={p.part_id} /><ActionButton className="small-btn danger" confirm={`Permanently remove ${p.name}?`} busyLabel="Removing…" doneLabel="Removed">Remove</ActionButton></form></div></details></div></td></tr>)}{parts.length === 0 && <tr><td colSpan={10}><div className="empty-state">No parts match this filter.</div></td></tr>}</tbody></table></div>
      </div>
    </>
  )
}
