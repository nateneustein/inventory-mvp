import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualUnitsSold } from '@/lib/actions'
import { ManualUsageRows } from '@/components/manual-usage-actions'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

function iso(d: Date) { return d.toISOString().slice(0, 10) }
function variationLabel(v: any) { return `${v.internal_sku} · ${v.products?.name} · ${v.variation_name}` }

function zoomValue(raw?: string) {
  const allowed = ['50', '60', '70', '80', '90', '100', '110', '125', '150']
  return allowed.includes(raw || '') ? raw || '100' : '100'
}
function usageHref(params: any, zoom: string) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  query.set('zoom', zoom)
  return `/usage?${query.toString()}`
}

export default async function UsagePage({ searchParams }: { searchParams?: Promise<{ q?: string, zoom?: string, error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = (params.q || '').toLowerCase()
  const zoom = zoomValue(params.zoom)
  const { supabase } = await requireUser()

  const { data: status } = await supabase.from('inventory_status').select('*').order('name')
  const { data: variations } = await supabase.from('product_variations').select('id, internal_sku, variation_name, products(name)').eq('active', true).order('internal_sku')

  // Aggregated in Postgres: one row per week, not one row per movement.
  // The old version pulled every inventory_movements row and grouped them in JS,
  // which silently hit the Supabase max-rows cap and truncated the timeline.
  const { data: weekRows, error: weekError } = await supabase
    .from('weekly_usage_grid')
    .select('week_start, week_end, week_number, month_name, year, usage')
    .order('week_start', { ascending: false })

  const { data: anchorRow } = await supabase
    .from('usage_anchor')
    .select('anchor_date, earliest_date, usage_row_count')
    .single()

  // Broader than just negatives: a part pinned at exactly zero while orders
  // keep consuming it is the same kind of lie as a negative balance.
  const { data: negativeParts } = await supabase
    .from('needs_physical_count')
    .select('part_id, name, sku, on_hand, starting_balance, total_received, total_used, last_used_on, count_reason')
    .order('on_hand')

  const { data: manualRows } = await supabase
    .from('manual_units_sold')
    .select('*, product_variations(internal_sku, variation_name, products(name))')
    .is('archived_at', null)
    .order('sale_date', { ascending: false })
    .limit(100)

  const parts = (status || []).filter((p: any) => !q || `${p.name || ''} ${p.sku || ''} ${p.category || ''}`.toLowerCase().includes(q))
  const weeks = weekRows || []
  const anchorDate = anchorRow?.anchor_date || null

  return (
    <>
      <div className="page-head"><div><h1>Inventory Usage</h1><p className="muted">Sunday-to-Saturday usage timeline. This is the replacement for the weekly usage section in the spreadsheet.</p></div></div>
      {params.error && <div className="card danger-soft"><strong>Manual usage was not saved:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}
      {weekError && <div className="card danger-soft"><strong>Usage timeline could not be loaded:</strong> {weekError.message}</div>}

      {(negativeParts || []).length > 0 && (
        <div className="card danger-soft">
          <h2>Needs a physical count</h2>
          <p className="muted">Two things land here. <strong>Negative stock</strong> means more usage was recorded than stock ever received — a gap in the imported history, not a real quantity. <strong>Zero but still selling</strong> means the system says zero while orders kept consuming the part in the last 4 weeks, so the real shelf count is almost certainly not zero. Either way the number cannot be trusted until somebody counts it. Use <strong>Report Zero</strong> to enter the real quantity and the system will correct itself.</p>
          <div className="wide-table"><table>
            <thead><tr><th>Part</th><th>SKU</th><th>Why</th><th>System says</th><th>Opening</th><th>Received</th><th>Used</th><th>Last used</th></tr></thead>
            <tbody>{(negativeParts || []).map((p: any) => (
              <tr key={p.part_id}>
                <td><Link className="link" href={`/parts/${p.part_id}`}>{p.name}</Link></td>
                <td>{p.sku}</td>
                <td><span className={`badge ${p.count_reason === 'negative_stock' ? 'urgent' : 'warning'}`}>{p.count_reason === 'negative_stock' ? 'negative stock' : 'zero but still selling'}</span></td>
                <td className="cell-danger">{num(p.on_hand)}</td>
                <td>{num(p.starting_balance)}</td>
                <td>{num(p.total_received)}</td>
                <td>{num(p.total_used)}</td>
                <td>{date(p.last_used_on)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="card">
        <h2>Add manual products produced / sold</h2>
        <p className="muted">Use this for bulk orders or any order line that actually represents multiple finished products. It will consume inventory using the BOM.</p>
        <form className="stack" action={createManualUnitsSold}>
          <div className="form-row"><label>Finished product / variation<select name="variation_id" required><option value="">Choose variation</option>{(variations || []).map((v: any) => <option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label><label>Quantity produced/sold<input name="quantity" type="number" step="0.01" required /></label><label>Date<input name="sale_date" type="date" defaultValue={iso(new Date())} required /></label></div>
          <div className="form-row"><label>Reason<select name="reason" defaultValue="bulk_order_manual_entry"><option value="bulk_order_manual_entry">Bulk order/manual split</option><option value="missing_from_platform_upload">Missing from platform upload</option><option value="correction">Correction</option><option value="other">Other</option></select></label><label>Order/reference<input name="order_reference" placeholder="Optional order number" /></label></div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add manual sold units</button>
        </form>
      </div>

      <div className="card"><form className="filter-bar" action="/usage"><label>Filter parts<input name="q" defaultValue={params.q || ''} placeholder="Part name, SKU, category" /></label><button type="submit">Filter</button><Link className="button ghost" href="/usage">Clear</Link></form></div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>Weekly usage timeline</h2>
            <p className="muted small">
              Each row is one Sunday-to-Saturday week. Columns are parts/components.
              {anchorDate
                ? ` Usage imported through ${date(anchorDate)} — ${num(anchorRow?.usage_row_count, 0)} usage records from ${date(anchorRow?.earliest_date)} onward.`
                : ' No usage has been imported yet.'}
            </p>
          </div>
          <div className="table-tools"><div className="zoom-controls"><span>Zoom</span>{['50', '60', '70', '80', '90', '100', '110', '125', '150'].map(z => <Link key={z} className={`button small-btn ${zoom === z ? '' : 'secondary'}`} href={usageHref(params, z)}>{z}%</Link>)}</div><span className="badge info">{weeks.length} weeks</span></div>
        </div>
        <div className={`wide-table sheet-scroll sheet-sticky-head sheet-zoom-${zoom} usage-grid`}><table>
          <thead><tr><th className="sticky-col date-col">Week range</th><th>Week #</th><th>Month</th><th>Year</th>{parts.map((p: any) => <th key={p.part_id}>{p.name}<br /><span className="muted small">{p.sku}</span></th>)}</tr></thead>
          <tbody>{weeks.map((w: any) => {
            const usage = (w.usage || {}) as Record<string, number>
            return (
              <tr key={w.week_start}>
                <td className="sticky-col date-col"><strong>{date(w.week_start)}</strong><br /><span className="muted small">to {date(w.week_end)}</span></td>
                <td>{w.week_number}</td>
                <td>{w.month_name}</td>
                <td>{w.year}</td>
                {parts.map((p: any) => <td key={p.part_id}>{num(usage[p.part_id] || 0)}</td>)}
              </tr>
            )
          })}
          {weeks.length === 0 && <tr><td colSpan={parts.length + 4}><div className="empty-state">No usage recorded yet.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Current stock summary</h2></div><div className="wide-table"><table><thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Status</th></tr></thead><tbody>{parts.map((p: any) => <tr key={p.part_id}><td><Link className="link" href={`/parts/${p.part_id}`}>{p.name}</Link></td><td>{p.sku}</td><td className={Number(p.on_hand) < 0 ? 'cell-danger' : ''}>{num(p.on_hand)}</td><td>{num(p.incoming_qty)}</td><td>{num(p.projected_qty)}</td><td><span className={`badge ${p.stock_status}`}>{p.stock_status}</span></td></tr>)}</tbody></table></div></div>

      <div className="card table-card">
        <div className="table-head"><h2>Recent manual sold/produced entries</h2></div>
        <div className="wide-table"><table><thead><tr><th>Date</th><th>Week start</th><th>Variation</th><th>Qty</th><th>Reference</th><th>Reason</th><th>Notes</th><th>Actions</th></tr></thead><tbody><ManualUsageRows rows={manualRows || []} variations={variations || []} />{(manualRows || []).length === 0 && <tr><td colSpan={8}><div className="empty-state">No manual sold/produced entries yet.</div></td></tr>}</tbody></table></div>
      </div>
    </>
  )
}
