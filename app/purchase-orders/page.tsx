import { requireUser } from '@/lib/require-user'
import { addPurchaseOrderItem, createPurchaseOrder, updatePurchaseOrderStatus } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function PurchaseOrdersPage() {
  const { supabase } = await requireUser()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('name')
  const { data: purchaseOrders } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name)')
    .order('created_at', { ascending: false })
  const { data: poItems } = await supabase
    .from('purchase_order_items')
    .select('*, parts(name, sku), purchase_orders(po_number)')
    .order('created_at', { ascending: false })

  return (
    <>
      <h1>Purchase Orders / Incoming Shipments</h1>
      <p className="muted">Add supplier orders here. They count as incoming, but do not become usable stock until receiving confirms the quantity.</p>

      <div className="grid">
        <div className="card">
          <h2>Create PO</h2>
          <form className="stack" action={createPurchaseOrder}>
            <label>PO number<input name="po_number" required placeholder="PO-1001" /></label>
            <label>Supplier
              <select name="supplier_id" required>
                <option value="">Choose supplier</option>
                {(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label>Status
                <select name="status" defaultValue="ordered">
                  <option value="draft">Draft</option>
                  <option value="ordered">Ordered</option>
                  <option value="in_production">In production</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                  <option value="receiving_check">Receiving check</option>
                </select>
              </label>
              <label>Order date<input name="order_date" type="date" /></label>
              <label>Expected date<input name="expected_date" type="date" /></label>
            </div>
            <label>Tracking number<input name="tracking_number" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Create PO</button>
          </form>
        </div>

        <div className="card">
          <h2>Add item to PO</h2>
          <form className="stack" action={addPurchaseOrderItem}>
            <label>PO
              <select name="purchase_order_id" required>
                <option value="">Choose PO</option>
                {(purchaseOrders || []).map((po: any) => <option key={po.id} value={po.id}>{po.po_number} - {po.suppliers?.name}</option>)}
              </select>
            </label>
            <label>Part
              <select name="part_id" required>
                <option value="">Choose part</option>
                {(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label>Qty ordered<input name="quantity_ordered" type="number" step="0.01" required /></label>
              <label>Unit cost<input name="unit_cost" type="number" step="0.0001" defaultValue="0" /></label>
            </div>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Add PO item</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Open POs</h2>
        <table>
          <thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Order date</th><th>Expected</th><th>Tracking</th><th>Update</th></tr></thead>
          <tbody>
            {(purchaseOrders || []).map((po: any) => (
              <tr key={po.id}>
                <td>{po.po_number}</td>
                <td>{po.suppliers?.name}</td>
                <td><span className="badge">{po.status}</span></td>
                <td>{date(po.order_date)}</td>
                <td>{date(po.expected_date)}</td>
                <td>{po.tracking_number}</td>
                <td>
                  <form className="stack" action={updatePurchaseOrderStatus}>
                    <input type="hidden" name="purchase_order_id" value={po.id} />
                    <select name="status" defaultValue={po.status}>
                      <option value="draft">Draft</option>
                      <option value="ordered">Ordered</option>
                      <option value="in_production">In production</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                      <option value="receiving_check">Receiving check</option>
                      <option value="partially_received">Partially received</option>
                      <option value="received">Received</option>
                      <option value="closed">Closed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <input name="expected_date" type="date" defaultValue={po.expected_date || ''} />
                    <input name="tracking_number" defaultValue={po.tracking_number || ''} />
                    <button type="submit" className="secondary">Save</button>
                  </form>
                </td>
              </tr>
            ))}
            {(purchaseOrders || []).length === 0 && <tr><td colSpan={7}>No POs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>PO items</h2>
        <table>
          <thead><tr><th>PO</th><th>Part</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Unit cost</th></tr></thead>
          <tbody>
            {(poItems || []).map((i: any) => (
              <tr key={i.id}>
                <td>{i.purchase_orders?.po_number}</td>
                <td>{i.parts?.sku} - {i.parts?.name}</td>
                <td>{num(i.quantity_ordered)}</td>
                <td>{num(i.quantity_received)}</td>
                <td>{num(Number(i.quantity_ordered || 0) - Number(i.quantity_received || 0))}</td>
                <td>{num(i.unit_cost, 4)}</td>
              </tr>
            ))}
            {(poItems || []).length === 0 && <tr><td colSpan={6}>No PO items yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
