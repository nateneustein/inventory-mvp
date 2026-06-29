import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { num, date } from '@/lib/format'

export default async function DashboardPage() {
  const { supabase } = await requireUser()

  const { data: statusRows } = await supabase
    .from('inventory_status')
    .select('*')
    .order('stock_status', { ascending: false })
    .limit(200)

  const { data: openPoItems } = await supabase
    .from('open_po_items')
    .select('*')
    .limit(20)

  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*').limit(20)
  const { data: notifications } = await supabase.from('notifications').select('*').is('acknowledged_at', null).order('created_at', { ascending: false }).limit(20)
  const { data: importedSummary } = await supabase.from('imported_order_summary').select('*')

  const rows = statusRows || []
  const out = rows.filter((r: any) => r.stock_status === 'out').length
  const reorder = rows.filter((r: any) => r.stock_status === 'reorder_now').length
  const low = rows.filter((r: any) => r.stock_status === 'getting_low').length
  const parts = rows.length
  const unmapped = (importedSummary || []).reduce((sum: number, r: any) => sum + Number(r.unmapped_rows || 0), 0)

  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">Inventory health, incoming shipments, imported order issues, and urgent warehouse alerts.</p>

      <div className="grid">
        <div className="card"><div className="muted">Total parts</div><div className="kpi">{parts}</div></div>
        <div className="card"><div className="muted">Out of stock</div><div className="kpi">{out}</div></div>
        <div className="card"><div className="muted">Reorder now</div><div className="kpi">{reorder}</div></div>
        <div className="card"><div className="muted">Unmapped order rows</div><div className="kpi">{unmapped}</div></div>
      </div>

      <div className="card">
        <h2>Notifications</h2>
        <table>
          <thead><tr><th>Date</th><th>Level</th><th>Title</th><th>Message</th></tr></thead>
          <tbody>
            {(notifications || []).map((n: any) => <tr key={n.id}><td>{date(n.created_at)}</td><td><span className={`badge ${n.level === 'urgent' ? 'danger' : n.level === 'warning' ? 'warning' : 'ok'}`}>{n.level}</span></td><td>{n.title}</td><td>{n.message}</td></tr>)}
            {(notifications || []).length === 0 && <tr><td colSpan={4}>No notifications yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {(overdue || []).length > 0 && (
        <div className="card alert">
          <h2>Overdue shipments</h2>
          <p>{(overdue || []).length} shipment item(s) are past expected date and not fully received.</p>
          <Link className="button" href="/shipments">Review shipments</Link>
        </div>
      )}

      <div className="card">
        <h2>Needs attention</h2>
        <table>
          <thead>
            <tr>
              <th>Part</th><th>SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Reorder point</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r: any) => r.stock_status !== 'ok').map((r: any) => (
              <tr key={r.part_id}>
                <td><Link href={`/parts/${r.part_id}`}>{r.name}</Link></td><td>{r.sku}</td><td>{num(r.on_hand)}</td><td>{num(r.incoming_qty)}</td><td>{num(r.projected_qty)}</td><td>{num(r.reorder_point)}</td>
                <td><span className={`badge ${r.stock_status === 'out' ? 'danger' : 'warning'}`}>{r.stock_status}</span></td>
                <td><Link className="button secondary" href={`/predictions/advanced?part_id=${r.part_id}`}>Calculate</Link></td>
              </tr>
            ))}
            {rows.filter((r: any) => r.stock_status !== 'ok').length === 0 && <tr><td colSpan={8}>No urgent inventory alerts yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Incoming shipments</h2>
        <table>
          <thead><tr><th>PO</th><th>Supplier</th><th>Part</th><th>Expected</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead>
          <tbody>
            {(openPoItems || []).map((r: any) => (
              <tr key={r.purchase_order_item_id}>
                <td>{r.po_number}</td><td>{r.supplier_name}</td><td>{r.part_name}</td><td>{date(r.expected_date)}</td><td>{num(r.remaining_qty)}</td><td>{r.tracking_number}</td><td><Link className="button secondary" href="/receiving">Receive</Link></td>
              </tr>
            ))}
            {(openPoItems || []).length === 0 && <tr><td colSpan={7}>No open incoming shipments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
