import { randomUUID } from 'crypto'
import { requireUser } from '@/lib/require-user'
import { receivePurchaseOrderItem } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function ReceivingPage() {
  const { supabase } = await requireUser()
  // No .limit(): the Data API caps the response anyway, and an arbitrary 200
  // meant that past 200 open lines the warehouse simply could not select the
  // item it was holding. Ordered so the oldest expected arrivals come first.
  const { data: openItems } = await supabase
    .from('open_po_items')
    .select('*')
    .order('expected_date', { ascending: true, nullsFirst: false })

  // One-shot token: if Confirm is double-clicked or the form is resubmitted via
  // browser-back, the database replays the original receipt instead of adding
  // the shipment to stock a second time.
  const idempotencyKey = randomUUID()
  const { data: events } = await supabase
    .from('receiving_events')
    .select('*, parts(name, sku), purchase_orders(po_number)')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <>
      <h1>Receiving Check</h1>
      <p className="muted">Delivered shipments become real inventory only after the warehouse confirms the quantity received.</p>

      <div className="card">
        <h2>Receive shipment item</h2>
        <form className="stack" action={receivePurchaseOrderItem}>
          <input type="hidden" name="idempotency_key" value={idempotencyKey} />
          <label>Open PO item
            <select name="purchase_order_item_id" required>
              <option value="">Choose item</option>
              {(openItems || []).map((i: any) => (
                <option key={i.purchase_order_item_id} value={i.purchase_order_item_id}>
                  {i.po_number} - {i.supplier_name} - {i.part_sku} {i.part_name} - remaining {num(i.remaining_qty)} - expected {date(i.expected_date)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>Qty received usable<input name="quantity_received" type="number" step="0.01" defaultValue="0" /></label>
            <label>Qty damaged from supplier<input name="quantity_damaged" type="number" step="0.01" defaultValue="0" /></label>
            <label>Qty missing / short<input name="quantity_missing" type="number" step="0.01" defaultValue="0" /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Example: Box 3 had 5 broken bases. Supplier shipped 492 instead of 500." /></label>
          <button type="submit">Confirm receiving</button>
        </form>
      </div>

      <div className="card">
        <h2>Recent receiving events</h2>
        <table>
          <thead><tr><th>Date</th><th>PO</th><th>Part</th><th>Received</th><th>Damaged</th><th>Missing</th><th>Notes</th></tr></thead>
          <tbody>
            {(events || []).map((e: any) => (
              <tr key={e.id}>
                <td>{date(e.created_at)}</td><td>{e.purchase_orders?.po_number}</td><td>{e.parts?.sku} - {e.parts?.name}</td><td>{num(e.quantity_received)}</td><td>{num(e.quantity_damaged)}</td><td>{num(e.quantity_missing)}</td><td>{e.notes}</td>
              </tr>
            ))}
            {(events || []).length === 0 && <tr><td colSpan={7}>No receiving events yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
