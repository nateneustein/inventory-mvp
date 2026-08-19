import { requireUser } from '@/lib/require-user'
import { requirePageAccess } from '@/lib/permissions'
import { date, num } from '@/lib/format'

export default async function ReportsPage() {
  /* Closed to the floor. Checked here, on the server, on every render. */
  await requirePageAccess('canViewReports', '/reports')

  const { supabase } = await requireUser()
  /* Alarms only.
     A report is an alarm when the app was supposed to be predicting the part
     (tracked) and nothing was already on its way. Reports on untracked supplies
     are just how ordering starts, and a report already covered by a shipment is
     nobody's failure - both belong on the reorder list, not in a failure report. */
  const { data: reportRows } = await supabase.from('stock_report_board').select('*').order('created_at', { ascending: false }).limit(300)
  const zeroReports = (reportRows || []).filter((r: any) =>
    r.tracked && !r.covered_by_incoming && !r.awaiting_receipt)
  const { data: deadStock } = await supabase.from('dead_stock_candidates').select('*').neq('dead_stock_status', 'active').order('dead_stock_status')
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*')
  const { data: switches } = await supabase.from('inventory_switches').select('*, to_part:parts!inventory_switches_to_part_id_fkey(name, sku), from_part:parts!inventory_switches_from_part_id_fkey(name, sku)').eq('change_type', 'forced_due_to_stockout').order('created_at', { ascending: false }).limit(100)

  return (
    <>
      <h1>Reports</h1>
      <p className="muted">Reports for actual zero events, dead stock, overdue shipments, and prediction/system failures.</p>

      <div className="grid">
        <div className="card"><div className="muted">Alarms - tracked, nothing coming</div><div className="kpi">{zeroReports.length}</div><p className="muted small">{zeroReports.filter((r: any) => !r.is_done).length} not yet reviewed</p></div>
        <div className="card"><div className="muted">Dead stock candidates</div><div className="kpi">{deadStock?.length || 0}</div></div>
        <div className="card"><div className="muted">Overdue shipment items</div><div className="kpi">{overdue?.length || 0}</div></div>
        <div className="card"><div className="muted">Forced switches</div><div className="kpi">{switches?.length || 0}</div></div>
      </div>

      <div className="card">
        <h2>Alarms - the forecast missed</h2>
        <p className="muted small">Tracked parts the warehouse reported at zero or running low with <strong>no shipment already on the way</strong>. Untracked supplies and reports already covered by a shipment are on the reorder list instead. This is the history, so a report stays here after it has been reviewed - the forecast still missed, whether or not somebody has since looked at it.</p>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>Type</th><th>Counted</th><th>System said</th><th>Reported by</th><th>Reviewed</th><th>Notes</th></tr></thead>
          <tbody>{zeroReports.map((r: any) => <tr key={r.id}><td>{date(r.created_at)}</td><td>{r.part_sku} · {r.part_name}</td><td>{r.report_type}</td><td>{r.warehouse_quantity_reported != null ? <strong>{num(r.warehouse_quantity_reported)}</strong> : <span className="muted">not counted</span>}</td><td>{num(r.system_quantity_at_report)}</td><td className="ap-reporter">{r.reporter_name}</td><td>{r.is_done ? <><span className="badge ok">reviewed</span><span className="sku-under">{date(r.resolved_at)}{r.reviewer_name ? ' · ' + r.reviewer_name : ''}</span>{r.resolution_note && <span className="sku-under">{r.resolution_note}</span>}</> : <span className="badge warning">still open</span>}</td><td>{r.notes}</td></tr>)}{zeroReports.length === 0 && <tr><td colSpan={8}><div className="empty-state">No alarms. Every open report is either on an untracked supply or already covered by a shipment.</div></td></tr>}</tbody>
        </table>
      </div>

      <div className="card">
        <h2>Dead stock / slow stock</h2>
        <p className="muted small">Tracked parts sitting on more than <strong>365 days of cover</strong> (far more stock than they sell), or not used in a while. <strong>Slow</strong> means nothing has consumed it in over 120 days, or there is over a year of cover; <strong>dead</strong> means over 270 days untouched. A part with no recent usage at all shows no cover figure, because there is no rate to divide by. These are candidates to stop reordering or run down.</p>
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Months of cover</th><th>Last used</th><th>Status</th></tr></thead>
          <tbody>{(deadStock || []).map((r: any) => <tr key={r.part_id}><td>{r.name}</td><td>{r.sku}</td><td>{num(r.on_hand)}</td><td>{r.months_of_cover != null ? r.months_of_cover + ' mo' : '—'}</td><td>{date(r.last_used_at)}</td><td>{r.dead_stock_status}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card">
        <h2>Forced switches because we ran out</h2>
        <table>
          <thead><tr><th>Date</th><th>Original demand</th><th>Actual used</th><th>Qty</th><th>Order</th><th>Notes</th></tr></thead>
          <tbody>{(switches || []).map((s: any) => <tr key={s.id}><td>{date(s.created_at)}</td><td>{s.from_part?.sku} · {s.from_part?.name}</td><td>{s.to_part?.sku} · {s.to_part?.name}</td><td>{num(s.quantity)}</td><td>{s.order_reference}</td><td>{s.notes}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  )
}
