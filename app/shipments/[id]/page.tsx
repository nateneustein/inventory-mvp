import { randomUUID } from 'crypto'
import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updatePurchaseOrder, deletePurchaseOrder, addPurchaseOrderItem, updatePurchaseOrderItem, deletePurchaseOrderItem, receivePurchaseOrderItem } from '@/lib/actions'
import { date, num, supplierHint, today } from '@/lib/format'
import { ActionButton } from '@/components/action-button'
import { SearchSelect } from '@/components/search-select'
import { StickySelect } from '@/components/sticky-select'
import { ShipmentTimeline } from '@/components/shipment-timeline'
import { addShipmentSupplier, removeShipmentSupplier, setShipmentTracking } from '@/lib/shipment-actions'
import { getPermissions } from '@/lib/permissions'

/** Defaults to today, so a shipment checked in late still books into the week
 *  it actually arrived. */

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const perms = await getPermissions()
  const { data: po } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('id', id).single()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name, contact_name, email, phone').order('name')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('sku')
  const { data: items } = await supabase.from('purchase_order_items').select('*, parts(name, sku)').eq('purchase_order_id', id).order('created_at')
  const { data: alsoFrom } = await supabase.from('purchase_order_suppliers').select('id, supplier_id, suppliers(name, contact_name, phone, email)').eq('purchase_order_id', id)
const { data: receives } = await supabase.from('receiving_events').select('*, parts(name, sku)').eq('purchase_order_id', id).order('created_at', { ascending: false })

  if (!po) return <div className="card"><h1>Shipment not found</h1><Link className="button" href="/shipments">Back</Link></div>

  return (
    <>
      <div className="page-head"><div><h1>{po.po_number}</h1><p className="muted">Shipment / purchase order detail.</p></div><div className="action-row"><Link className="button secondary" href="/shipments">Back</Link><Link className="button" href="/receiving">Receiving screen</Link></div></div>
      {(items || []).length === 0 && (
        /* A shipment with nothing in it never lands in stock and never shows on
           the receiving screen, so it has to be loud rather than quietly empty. */
        <div className="card danger-soft">
          <strong>No part has been added to this shipment.</strong> Nothing will arrive into stock
          and it will not appear on the receiving screen until at least one part is added below.
        </div>
      )}
      <ShipmentTimeline po={po} />
      {/* The whole supplier card. Not drawn for anyone the database would not
          answer about suppliers anyway. */}
      {perms.canSeeSuppliers && (
      <div className="card">
<div className="table-head"><h2>Suppliers on this shipment</h2><span className="badge info">{1 + (alsoFrom || []).length}</span></div>
<p className="muted small">The main supplier is the one on the shipment itself, set in the edit form below. Add the others here when a container is packed at more than one factory.</p>
<ul className="mini-list">
<li><strong>{po.suppliers?.name || 'No supplier set'}</strong><span className="muted small">main supplier</span></li>
{(alsoFrom || []).map((row: any) => (
<li key={row.id} data-confirm-label={row.suppliers?.name || 'this supplier'}>
<span>{row.suppliers?.name}</span>
{row.suppliers?.contact_name && <span className="muted small">{row.suppliers.contact_name}</span>}
{row.suppliers?.phone && <span className="muted small">{row.suppliers.phone}</span>}
{perms.canManagePurchasing && <form className="inline-form push-right" action={removeShipmentSupplier}>
<input type="hidden" name="purchase_order_id" value={id} />
<input type="hidden" name="row_id" value={row.id} />
<ActionButton className="small-btn danger" busyLabel="…" doneLabel="Removed">Remove</ActionButton>
</form>}
</li>
))}
</ul>
<details className="mini-add">
<summary className="button small-btn secondary">+ Add another supplier</summary>
{perms.canManagePurchasing && <form className="stack card flat" action={addShipmentSupplier}>
<input type="hidden" name="purchase_order_id" value={id} />
<label>Supplier<SearchSelect name="supplier_id" required placeholder="Type a supplier or contact name" options={(suppliers || []).map((s: any) => ({ value: s.id, label: s.name, hint: supplierHint(s) }))} /></label>
<div className="action-row">
<ActionButton className="small-btn" busyLabel="Adding…" doneLabel="Added">Add supplier</ActionButton>
<button type="button" className="button secondary cancel-btn">Cancel</button>
</div>
</form>}
</details>
</div>
      )}
<div className="grid two">
        {!perms.canManagePurchasing && (
          <div className="card">
            <h2>Tracking number</h2>
            <p className="muted small">Add or correct the tracking number for this shipment. Everything else on the shipment is set by a manager.</p>
            <form className="stack" action={setShipmentTracking}>
              <input type="hidden" name="id" value={id} />
              <label>Tracking<input name="tracking_number" defaultValue={po.tracking_number || ''} placeholder="Carrier tracking number" /></label>
              <ActionButton busyLabel="Saving…" doneLabel="Saved">Save tracking number</ActionButton>
            </form>
          </div>
        )}
        {perms.canManagePurchasing && (
        <div className="card"><h2>Edit shipment</h2><form className="stack" action={updatePurchaseOrder}><input type="hidden" name="id" value={id}/><label>PO number<input name="po_number" defaultValue={po.po_number || ''} required /></label><label>Supplier<SearchSelect name="supplier_id" defaultValue={po.supplier_id} placeholder="Type a supplier" options={(suppliers || []).map((s: any) => ({ value: s.id, label: s.name, hint: supplierHint(s) }))} /></label><div className="form-row"><label>Status<StickySelect name="status" value={po.status}><option value="draft">Draft</option><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="receiving_check">Receiving check</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></StickySelect></label><label>Order date<input name="order_date" type="date" defaultValue={po.order_date || ''}/></label><label>Expected date<input name="expected_date" type="date" defaultValue={po.expected_date || ''}/></label></div><label>Tracking<input name="tracking_number" defaultValue={po.tracking_number || ''}/></label><label>Notes<textarea name="notes" defaultValue={po.notes || ''}/></label><button type="submit">Save shipment</button></form><form action={deletePurchaseOrder}><input type="hidden" name="id" value={id}/><button className="danger" type="submit">Delete shipment</button></form></div>
        )}
        <div className="card"><details className="add-panel"><summary className="button">+ Add item</summary></details><form className="stack" action={addPurchaseOrderItem}><input type="hidden" name="purchase_order_id" value={id}/><label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><div className="form-row"><label>Qty ordered<input name="quantity_ordered" type="number" step="0.01" required/></label><label>Unit cost<input name="unit_cost" type="number" step="0.01" defaultValue="0"/></label></div><label>Notes<textarea name="notes"/></label><div className="action-row"><button type="submit">Add item</button><button type="button" className="button secondary cancel-btn">Cancel</button></div></form></div>
      </div>
<div className="card table-card"><div className="table-head"><h2>Items in shipment</h2></div><div className="wide-table"><table><thead><tr><th>Part</th><th>Ordered</th><th>Received</th><th>Unit cost</th><th>Notes</th><th>Receive now</th><th>Actions</th></tr></thead><tbody>{(items || []).map((i:any) => <tr key={i.id}><td className="name-cell"><Link className="link" href={`/parts/${i.part_id}`}>{i.parts?.name}</Link><span className="sku-under">{i.parts?.sku}</span></td><td>{num(i.quantity_ordered)}</td><td>{num(i.quantity_received)}</td><td>{num(i.unit_cost)}</td><td>{i.notes}</td><td><form className="stack" action={receivePurchaseOrderItem}><input type="hidden" name="purchase_order_item_id" value={i.id}/><input type="hidden" name="idempotency_key" value={randomUUID()}/><div className="form-row"><label>Good<input name="quantity_received" type="number" step="0.01" defaultValue="0"/></label><label>Damaged<input name="quantity_damaged" type="number" step="0.01" defaultValue="0"/></label><label>Missing<input name="quantity_missing" type="number" step="0.01" defaultValue="0"/></label></div><label>Date it arrived<input name="movement_date" type="date" defaultValue={today()}/></label><label>Note<textarea name="notes"/></label><ActionButton className="small-btn" confirm="Confirm this receipt into stock?" busyLabel="Receiving…" doneLabel="Received">Receive</ActionButton></form></td><td>{perms.canManagePurchasing ? (<><details><summary className="button small-btn secondary">Edit</summary><form className="stack card flat" action={updatePurchaseOrderItem}><input type="hidden" name="id" value={i.id}/><input type="hidden" name="purchase_order_id" value={id}/><label>Part<SearchSelect name="part_id" defaultValue={i.part_id} placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.id, label: p.name, hint: p.sku }))} /></label><label>Qty ordered<input name="quantity_ordered" type="number" step="0.01" defaultValue={i.quantity_ordered}/></label><label>Unit cost<input name="unit_cost" type="number" step="0.01" defaultValue={i.unit_cost}/></label><label>Notes<textarea name="notes" defaultValue={i.notes || ''}/></label><div className="action-row"><button type="submit">Save</button><button type="button" className="button secondary cancel-btn">Cancel</button></div></form><form action={deletePurchaseOrderItem}><input type="hidden" name="id" value={i.id}/><input type="hidden" name="purchase_order_id" value={id}/><div className="action-row"><ActionButton className="danger small-btn" confirm="Delete this shipment item?" busyLabel="…" doneLabel="Deleted">Delete item</ActionButton></div></form></details></>) : <span className="muted small">Manager only</span>}</td></tr>)}{(items || []).length === 0 && <tr><td colSpan={7}><div className="empty-state">No items added to this shipment.</div></td></tr>}</tbody></table></div></div>
      <div className="card table-card"><div className="table-head"><h2>Receiving history</h2></div><table><thead><tr><th>Date</th><th>Part</th><th>Good</th><th>Damaged</th><th>Missing</th><th>Notes</th></tr></thead><tbody>{(receives || []).map((r:any)=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.parts?.sku} · {r.parts?.name}</td><td>{num(r.quantity_received)}</td><td>{num(r.quantity_damaged)}</td><td>{num(r.quantity_missing)}</td><td>{r.notes}</td></tr>)}{(receives || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No receiving events yet.</div></td></tr>}</tbody></table></div>
    </>
  )
}
