import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createPurchaseOrder, addPurchaseOrderItem, updatePurchaseOrderStatus } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function ShipmentsPage() {
  const { supabase } = await requireUser()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('name')
  const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(50)
  const { data: openItems } = await supabase.from('open_po_items').select('*').limit(100)
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*')

  return (
    <>
      <h1>Shipments / Purchases</h1>
      <p className="muted">This replaces the Purchases section in the spreadsheet. Incoming inventory only becomes real stock after warehouse receiving confirms the quantity.</p>

      {(overdue || []).length > 0 && <div className="card alert"><h2>Overdue shipments</h2><p>{(overdue || []).length} shipment item(s) are past expected date and not fully received.</p></div>}

      <div className="grid">
        <div className="card">
          <h2>Create shipment / PO</h2>
          <form className="stack" action={createPurchaseOrder}>
            <label>PO / shipment number<input name="po_number" required placeholder="PO-1001" /></label>
            <label>Supplier
              <select name="supplier_id" required><option value="">Choose supplier</option>{(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <div className="form-row"><label>Order date<input name="order_date" type="date" /></label><label>Expected arrival<input name="expected_date" type="date" /></label></div>
            <label>Status<select name="status"><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option></select></label>
            <label>Tracking number<input name="tracking_number" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Create shipment</button>
          </form>
        </div>

        <div className="card">
          <h2>Add item to shipment</h2>
          <form className="stack" action={addPurchaseOrderItem}>
            <label>Shipment / PO
              <select name="purchase_order_id" required><option value="">Choose PO</option>{(pos || []).map((po: any) => <option key={po.id} value={po.id}>{po.po_number} · {po.suppliers?.name}</option>)}</select>
            </label>
            <label>Part
              <select name="part_id" required><option value="">Choose part</option>{(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select>
            </label>
            <div className="form-row"><label>Qty ordered<input name="quantity_ordered" type="number" step="0.01" required /></label><label>Unit cost<input name="unit_cost" type="number" step="0.01" defaultValue="0" /></label></div>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Add shipment item</button>
          </form>
        </div>
      </div>

      <div className="card wide-table">
        <h2>Open shipment items</h2>
        <table>
          <thead><tr><th>PO</th><th>Supplier</th><th>Part</th><th>Expected</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead>
          <tbody>
            {(openItems || []).map((r: any) => (
              <tr key={r.purchase_order_item_id}>
                <td>{r.po_number}</td><td>{r.supplier_name}</td><td>{r.part_sku} · {r.part_name}</td><td>{date(r.expected_date)}</td><td>{num(r.quantity_ordered)}</td><td>{num(r.quantity_received)}</td><td>{num(r.remaining_qty)}</td><td>{r.tracking_number}</td><td><Link className="button secondary" href="/receiving">Receive</Link></td>
              </tr>
            ))}
            {(openItems || []).length === 0 && <tr><td colSpan={9}>No open shipment items.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Update shipment status</h2>
        <form className="stack" action={updatePurchaseOrderStatus}>
          <label>Shipment / PO<select name="purchase_order_id" required><option value="">Choose PO</option>{(pos || []).map((po: any) => <option key={po.id} value={po.id}>{po.po_number} · {po.status}</option>)}</select></label>
          <div className="form-row"><label>Status<select name="status"><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="receiving_check">Receiving check</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label><label>Expected date<input name="expected_date" type="date" /></label><label>Tracking<input name="tracking_number" /></label></div>
          <button type="submit">Update shipment</button>
        </form>
      </div>
    </>
  )
}
