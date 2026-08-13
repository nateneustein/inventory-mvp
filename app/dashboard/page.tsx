import Link from 'next/link'
import { requirePageAccess } from '@/lib/permissions'
import { requireUser } from '@/lib/require-user'
import { acknowledgeNotification } from '@/lib/actions'
import { num, date } from '@/lib/format'
import { CoverCell } from '@/components/cover-cell'

function statusBadge(status: string) {
  const cls = status === 'out' ? 'danger' : status === 'ok' ? 'ok' : 'warning'
  return <span className={`badge ${cls}`}>{status}</span>
}

export default async function DashboardPage() {
  /* Closed to the floor. Checked here, on the server, on every render. */
  await requirePageAccess('canViewDashboard', '/dashboard')

  const { supabase } = await requireUser()

  const { data: statusRows } = await supabase.from('inventory_status').select('*').order('stock_status', { ascending: false }).limit(300)
  const { data: openPoItems } = await supabase.from('open_po_items').select('*').limit(12)
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*').limit(30)
  const { data: notifications } = await supabase.from('notifications').select('*').is('acknowledged_at', null).order('created_at', { ascending: false }).limit(12)
  const { data: importedSummary } = await supabase.from('imported_order_summary').select('*')
  const { data: deadStock } = await supabase.from('dead_stock_candidates').select('*').neq('dead_stock_status', 'active').limit(12)
  const { data: partFlags } = await supabase.from('parts').select('id, tracked')
  const { data: reportRows } = await supabase.from('stock_report_board').select('*').limit(500)
  const { data: awaitingShipments } = await supabase.from('shipments_awaiting_receipt').select('purchase_order_id')
  const { data: gapParts } = await supabase.from('stock_gap_before_shipment').select('part_id')

  const rows = statusRows || []
  // Parts with alerts turned off are deliberately excluded from every count and
  // from Needs attention. They are still stocked and still appear on the parts
  // list and the prediction sheet — they just do not shout.
  const alerting = rows.filter((r: any) => !r.ignore_alerts)
  const ignoredCount = rows.length - alerting.length
  const unmapped = (importedSummary || []).reduce((sum: number, r: any) => sum + Number(r.unmapped_rows || 0), 0)

  // The six boxes.
  //
  // Each one answers a different person's question, so each is counted from the
  // thing that person acts on rather than from one shared list:
  //   - the forecast boxes come from the projection, before anyone has complained
  //   - the two report boxes come from what the warehouse actually reported
  //   - a report already covered by a shipment is nobody's job, so it stays out
  //     of the reorder counts entirely
  const trackedIds = new Set((partFlags || []).filter((p: any) => p.tracked !== false).map((p: any) => p.id))
  const trackedAlerting = alerting.filter((r: any) => trackedIds.has(r.part_id))
  const forecastOut = trackedAlerting.filter((r: any) => r.stock_status === 'out').length
  // This number is a to-do list, so it only counts what somebody has to order
  // TODAY, judged on the steady three month pace. An early warning is not a job
  // yet, and a part that only looks urgent because of one busy week usually
  // settles by itself - counting either of those meant the number could never
  // reach zero, so nobody ever finished it. Both still appear in the list below.
  const forecastLow = trackedAlerting.filter((r: any) =>
    r.days_of_cover_3mo_rate !== null &&
    r.days_of_cover_3mo_rate !== undefined &&
    Number(r.days_of_cover_3mo_rate) <= Number(r.reorder_horizon_days)).length

  const openReports = (reportRows || []).filter((r: any) => !r.is_done)
  const covered = (r: any) => r.covered_by_incoming || r.awaiting_receipt
  const alarmZero = openReports.filter((r: any) => r.tracked && r.report_type === 'zero').length
  const alarmLow = openReports.filter((r: any) => r.tracked && r.report_type === 'running_low' && !covered(r)).length
  const supplyZero = openReports.filter((r: any) => !r.tracked && r.report_type === 'zero' && !covered(r)).length
  const supplyLow = openReports.filter((r: any) => !r.tracked && r.report_type === 'running_low' && !covered(r)).length

  const awaitingCount = (awaitingShipments || []).length
  const gapCount = (gapParts || []).length

  const tone = (n: number, colour: string) => 'kpi ' + (n > 0 ? colour : 'none')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">Inventory health, incoming shipments, mapping problems, and warehouse alerts.</p>
        </div>
        {/* Both of these were a third copy of a sidebar link. Every card below
            already carries its own way in, so the header stays a heading. */}
      </div>

      <div className="grid kpis">
        <Link className="card kpi-card" href="/predictions/basic">
          <div className="muted">Forecast says we run out - tracked parts</div>
          <div className="kpi-twin">
            <div className="kpi-stat"><div className={tone(forecastOut, 'bad')}>{forecastOut}</div><div className="kpi-c">out of stock</div></div>
            <div className="kpi-stat"><div className={tone(forecastLow, 'todo')}>{forecastLow}</div><div className="kpi-c">to order now</div></div>
          </div>
        </Link>
        <Link className="card kpi-card" href="/zero">
          <div className="muted">Forecast Failure - zero &amp; running low alarms</div>
          <div className="kpi-twin">
            <div className="kpi-stat"><div className={tone(alarmZero, 'bad')}>{alarmZero}</div><div className="kpi-c">at zero</div></div>
            <div className="kpi-stat"><div className={tone(alarmLow, 'todo')}>{alarmLow}</div><div className="kpi-c">low, none coming</div></div>
          </div>
        </Link>
        <Link className="card kpi-card" href="/reorder">
          <div className="muted">Small supplies &amp; untracked - needs reordering</div>
          <div className="kpi-twin">
            <div className="kpi-stat"><div className={tone(supplyZero, 'bad')}>{supplyZero}</div><div className="kpi-c">none left</div></div>
            <div className="kpi-stat"><div className={tone(supplyLow, 'todo')}>{supplyLow}</div><div className="kpi-c">running low</div></div>
          </div>
        </Link>
        <Link className="card kpi-card" href="/predictions/basic">
          <div className="muted">Will run out before new shipment arrives</div>
          <div className="kpi-twin">
            <div className="kpi-stat"><div className={tone(gapCount, 'todo')}>{gapCount}</div><div className="kpi-c">need a top-up</div></div>
          </div>
        </Link>
        <Link className="card kpi-card" href="/receiving">
          <div className="muted">Shipments need to be received</div>
          <div className="kpi-twin">
            <div className="kpi-stat"><div className={tone(awaitingCount, 'moving')}>{awaitingCount}</div><div className="kpi-c">awaiting receipt</div></div>
          </div>
        </Link>
        <Link className="card kpi-card" href="/imported-orders?status=unmapped">
          <div className="muted">Unmapped order rows</div>
          <div className="kpi-twin">
            <div className="kpi-stat"><div className={tone(unmapped, 'todo')}>{unmapped}</div><div className="kpi-c">need mapping</div></div>
          </div>
        </Link>
      </div>

      <div className="grid two">
        <section className="card table-card">
          <div className="table-head"><h2>Notifications</h2><Link className="button small-btn secondary" href="/reports">Reports</Link></div>
          <div className="wide-table">
            <table>
              <thead><tr><th>Date</th><th>Level</th><th>Title</th><th>Message</th><th></th></tr></thead>
              <tbody>
                {(notifications || []).map((n: any) => (
                  <tr key={n.id}>
                    <td>{date(n.created_at)}</td>
                    <td><span className={`badge ${n.level === 'urgent' ? 'danger' : n.level === 'warning' ? 'warning' : 'ok'}`}>{n.level}</span></td>
                    <td>{n.title}</td><td>{n.message}</td>
                    <td>
                      <form action={acknowledgeNotification}><input type="hidden" name="id" value={n.id} /><button className="small-btn secondary" type="submit">Done</button></form>
                    </td>
                  </tr>
                ))}
                {(notifications || []).length === 0 && <tr><td colSpan={5}><div className="empty-state">No open notifications.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card table-card">
          <div className="table-head"><h2>Incoming shipments</h2><Link className="button small-btn secondary" href="/shipments">Open shipments</Link></div>
          <div className="wide-table">
            <table>
              <thead><tr><th>PO</th><th>Supplier</th><th>Part</th><th>Expected</th><th>Remaining</th><th></th></tr></thead>
              <tbody>
                {(openPoItems || []).map((r: any) => (
                  <tr key={r.purchase_order_item_id}>
                    <td><Link className="link" href={`/shipments/${r.purchase_order_id}`}>{r.po_number}</Link></td><td>{r.supplier_name}</td><td>{r.part_name}</td><td>{date(r.expected_date)}</td><td>{num(r.remaining_qty)}</td><td><Link className="button small-btn secondary" href={`/shipments/${r.purchase_order_id}`}>Open</Link></td>
                  </tr>
                ))}
                {(openPoItems || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No open incoming shipments yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {(overdue || []).length > 0 && (
        <div className="card alert">
          <div className="kpi-row"><div><h2>Overdue shipments</h2><p>{(overdue || []).length} shipment item(s) are past expected date and not fully received.</p></div><Link className="button" href="/shipments?status=overdue">Review</Link></div>
        </div>
      )}

      <div className="card table-card">
        <div className="table-head"><h2>Needs attention</h2><div className="table-tools">{ignoredCount > 0 && <Link className="badge ignored-alerts" href="/parts?alerts=off" title="Parts you have told the app not to alert on">{ignoredCount} ignored</Link>}<Link className="button small-btn secondary" href="/predictions/basic">Prediction sheet</Link></div></div>
        <div className="wide-table compact-rows">
          <table>
            <thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Reorder at</th><th>Cover / risk</th><th>Status</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {alerting.filter((r: any) => r.stock_status !== 'ok').map((r: any) => (
                <tr key={r.part_id}>
                  <td title={r.name}><Link className="link" href={`/parts/${r.part_id}`}>{r.name}</Link></td><td className="sku-cell" title={r.sku}>{r.sku}</td><td>{num(r.on_hand)}</td><td>{num(r.incoming_qty)}</td><td>{num(r.projected_qty)}</td><td className="target-cell">{num(r.reorder_horizon_days)} days<span className="sku-under">of cover wanted</span></td><CoverCell row={r} /><td>{statusBadge(r.stock_status)}</td>
                  <td className="actions-cell"><div className="action-row"><Link className="button small-btn secondary" href={`/parts/${r.part_id}`}>Open</Link><Link className="button small-btn" href={`/predictions/advanced?part_id=${r.part_id}`}>Calculate</Link></div></td>
                </tr>
              ))}
              {alerting.filter((r: any) => r.stock_status !== 'ok').length === 0 && <tr><td colSpan={8}><div className="empty-state">No urgent inventory alerts yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two">
        <div className="card table-card">
          <div className="table-head"><h2>Imported order summary</h2><Link className="button small-btn secondary" href="/imported-orders">Open orders</Link></div>
          <table><thead><tr><th>Source</th><th>Account</th><th>Rows</th><th>Unmapped</th></tr></thead><tbody>{(importedSummary || []).map((s:any) => <tr key={`${s.platform}-${s.account_name}`}><td>{s.platform}</td><td>{s.account_name}</td><td>{s.imported_rows}</td><td><span className={`badge ${s.unmapped_rows > 0 ? 'warning' : 'ok'}`}>{s.unmapped_rows}</span></td></tr>)}{(importedSummary || []).length === 0 && <tr><td colSpan={4}><div className="empty-state">No order imports yet.</div></td></tr>}</tbody></table>
        </div>
        <div className="card table-card">
          <div className="table-head"><h2>Dead stock watch</h2><Link className="button small-btn secondary" href="/reports">Full report</Link></div>
          <table><thead><tr><th>Part</th><th>On hand</th><th>Status</th></tr></thead><tbody>{(deadStock || []).map((d:any) => <tr key={d.part_id}><td><Link className="link" href={`/parts/${d.part_id}`}>{d.sku} · {d.name}</Link></td><td>{num(d.on_hand)}</td><td><span className="badge warning">{d.dead_stock_status}</span></td></tr>)}{(deadStock || []).length === 0 && <tr><td colSpan={3}><div className="empty-state">No dead stock warnings yet.</div></td></tr>}</tbody></table>
        </div>
      </div>
    </>
  )
}
