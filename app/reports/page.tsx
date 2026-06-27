import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export default async function ReportsPage() {
  const { supabase } = await requireUser()
  const { data: movements } = await supabase
    .from('inventory_movements')
    .select('*, parts(name, sku)')
    .order('created_at', { ascending: false })
    .limit(150)

  const { data: status } = await supabase
    .from('inventory_status')
    .select('*')
    .order('stock_status', { ascending: false })

  const { data: receiving } = await supabase
    .from('receiving_events')
    .select('*, parts(name, sku), purchase_orders(po_number)')
    .or('quantity_damaged.gt.0,quantity_missing.gt.0')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <>
      <h1>Reports</h1>
      <p className="muted">First MVP reports: reorder risk, movement history, and supplier receiving discrepancies.</p>

      <div className="card">
        <h2>Reorder / stock risk</h2>
        <table>
          <thead><tr><th>Part</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Reorder point</th><th>Target</th><th>Status</th></tr></thead>
          <tbody>
            {(status || []).filter((r: any) => r.stock_status !== 'ok').map((r: any) => (
              <tr key={r.part_id}>
                <td>{r.sku} - {r.name}</td><td>{num(r.on_hand)}</td><td>{num(r.incoming_qty)}</td><td>{num(r.projected_qty)}</td><td>{num(r.reorder_point)}</td><td>{num(r.target_stock)}</td><td>{r.stock_status}</td>
              </tr>
            ))}
            {(status || []).filter((r: any) => r.stock_status !== 'ok').length === 0 && <tr><td colSpan={7}>No current reorder risks.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Supplier shortage / damage on receiving</h2>
        <table>
          <thead><tr><th>Date</th><th>PO</th><th>Part</th><th>Received</th><th>Damaged</th><th>Missing</th><th>Notes</th></tr></thead>
          <tbody>
            {(receiving || []).map((r: any) => (
              <tr key={r.id}>
                <td>{date(r.created_at)}</td><td>{r.purchase_orders?.po_number}</td><td>{r.parts?.sku} - {r.parts?.name}</td><td>{num(r.quantity_received)}</td><td>{num(r.quantity_damaged)}</td><td>{num(r.quantity_missing)}</td><td>{r.notes}</td>
              </tr>
            ))}
            {(receiving || []).length === 0 && <tr><td colSpan={7}>No supplier discrepancies logged yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Inventory movement history</h2>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th></tr></thead>
          <tbody>
            {(movements || []).map((m: any) => (
              <tr key={m.id}>
                <td>{date(m.created_at)}</td><td>{m.parts?.sku} - {m.parts?.name}</td><td>{m.movement_type}</td><td>{num(m.quantity, 4)}</td><td>{m.reason}</td><td>{m.notes}</td>
              </tr>
            ))}
            {(movements || []).length === 0 && <tr><td colSpan={6}>No inventory movements yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
