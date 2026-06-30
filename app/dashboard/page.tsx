import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { acknowledgeNotification } from '@/lib/actions'
import { num, date } from '@/lib/format'

function statusBadge(status: string) {
  const cls = status === 'out' ? 'danger' : status === 'ok' ? 'ok' : 'warning'
  return <span className={`badge ${cls}`}>{status}</span>
}

export default async function DashboardPage() {
  const { supabase } = await requireUser()

  const { data: statusRows } = await supabase.from('inventory_status').select('*').order('stock_status', { ascending: false }).limit(300)
  const { data: openPoItems } = await supabase.from('open_po_items').select('*').limit(12)
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*').limit(30)
  const { data: notifications } = await supabase.from('notifications').select('*').is('acknowledged_at', null).order('created_at', { ascending: false }).limit(12)
  const { data: importedSummary } = await supabase.from('imported_order_summary').select('*')
  const { data: deadStock } = await supabase.from('dead_stock_candidates').select('*').neq('dead_stock_status', 'active').limit(12)

  const rows = statusRows || []
  const outRows = rows.filter((r: any) => r.stock_status === 'out')
  const reorderRows = rows.filter((r: any) => r.stock_status === 'reorder_now')
  const lowRows = rows.filter((r: any) => r.stock_status === 'getting_low')
  const parts = rows.length
  const unmapped = (importedSummary || []).reduce((sum: number, r: any) => sum + Number(r.unmapped_rows || 0), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Inventory health, incoming shipments, mapping problems, and warehouse alerts.</p>
        </div>
        <div className="action-row">
          <Link className="button" href="/uploads">Upload order CSV</Link>
          <Link className="button secondary" href="/zero">Report zero</Link>
        </div>
      </div>

      <div className="grid">
        <Link className="card kpi-card highlight" href="/parts"><div className="muted">Total parts</div><div className="kpi">{parts}</div><span className="badge info">View parts</span></Link>
        <Link className="card kpi-card" href="/parts?status=out"><div className="muted">Out of stock</div><div className="kpi">{outRows.length}</div><span className="badge danger">urgent</span></Link>
        <Link className="card kpi-card" href="/parts?status=reorder_now"><div className="muted">Reorder now</div><div className="kpi">{reorderRows.length}</div><span className="badge warning">needs order</span></Link>
        <Link className="card kpi-card" href="/imported-orders?status=unmapped"><div className="muted">Unmapped rows</div><div className="kpi">{unmapped}</div><span className="badge warning">mapping needed</span></Link>
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
        <div className="table-head"><h2>Needs attention</h2><div className="table-tools"><Link className="button small-btn secondary" href="/predictions/basic">Prediction sheet</Link></div></div>
        <div className="wide-table">
          <table>
            <thead><tr><th>Part</th><th className="sku-col">SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Reorder point</th><th>Status</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {rows.filter((r: any) => r.stock_status !== 'ok').map((r: any) => (
                <tr key={r.part_id}>
                  <td><Link className="link" href={`/parts/${r.part_id}`}>{r.name}</Link></td><td className="sku-col">{r.sku}</td><td>{num(r.on_hand)}</td><td>{num(r.incoming_qty)}</td><td>{num(r.projected_qty)}</td><td>{num(r.reorder_point)}</td><td>{statusBadge(r.stock_status)}</td>
                  <td><div className="action-row"><Link className="button small-btn secondary" href={`/parts/${r.part_id}`}>Open</Link><Link className="button small-btn" href={`/predictions/advanced?part_id=${r.part_id}`}>Calculate</Link></div></td>
                </tr>
              ))}
              {rows.filter((r: any) => r.stock_status !== 'ok').length === 0 && <tr><td colSpan={8}><div className="empty-state">No urgent inventory alerts yet.</div></td></tr>}
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
          <table><thead><tr><th>Part</th><th>On hand</th><th>Status</th></tr></thead><tbody>{(deadStock || []).map((d:any) => <tr key={d.part_id}><td><div className="entity-stack"><Link className="entity-name link" href={`/parts/${d.part_id}`}>{d.name}</Link><span className="sku-small">{d.sku}</span></div></td><td>{num(d.on_hand)}</td><td><span className="badge warning">{d.dead_stock_status}</span></td></tr>)}{(deadStock || []).length === 0 && <tr><td colSpan={3}><div className="empty-state">No dead stock warnings yet.</div></td></tr>}</tbody></table>
        </div>
      </div>
    </>
  )
}
