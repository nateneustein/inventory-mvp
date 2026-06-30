import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createPurchaseOrder, addPurchaseOrderItem, updatePurchaseOrder, deletePurchaseOrder } from '@/lib/actions'
import { date, num } from '@/lib/format'

function matchPo(po:any, q:string) {
  return `${po.po_number||''} ${po.suppliers?.name||''} ${po.status||''} ${po.tracking_number||''} ${po.notes||''}`.toLowerCase().includes(q.toLowerCase())
}

export default async function ShipmentsPage({ searchParams }: { searchParams?: Promise<{ q?: string, status?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const status = params.status || ''
  const { supabase } = await requireUser()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name')
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('name')
  const { data: allPos } = await supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(100)
  const { data: openItems } = await supabase.from('open_po_items').select('*').limit(100)
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*')
  const pos = (allPos || []).filter((po:any) => (!q || matchPo(po, q)) && (!status || (status === 'overdue' ? (overdue || []).some((o:any) => o.purchase_order_id === po.id) : po.status === status)))

  return (
    <>
      <div className="page-head"><div><h1>Shipments / Purchases</h1><p className="muted">Incoming inventory. Stock only increases after warehouse receiving confirms the quantity.</p></div><Link className="button secondary" href="/receiving">Receiving screen</Link></div>
      {(overdue || []).length > 0 && <div className="card alert"><div className="kpi-row"><div><h2>Overdue shipments</h2><p>{(overdue || []).length} shipment item(s) are past expected date and not fully received.</p></div><Link className="button" href="/shipments?status=overdue">Show overdue</Link></div></div>}

      <div className="card"><form className="filter-bar" action="/shipments"><label>Search<input name="q" defaultValue={q} placeholder="PO, supplier, tracking, notes" /></label><label className="compact">Status<select name="status" defaultValue={status}><option value="">All</option><option value="overdue">Overdue</option><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="receiving_check">Receiving check</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/shipments">Clear</Link></form></div>

      <div className="grid two">
        <div className="card"><h2>Create shipment / PO</h2><form className="stack" action={createPurchaseOrder}><label>PO / shipment number<input name="po_number" required placeholder="PO-1001" /></label><label>Supplier<select name="supplier_id" required><option value="">Choose supplier</option>{(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="form-row"><label>Order date<input name="order_date" type="date" /></label><label>Expected arrival<input name="expected_date" type="date" /></label></div><label>Status<select name="status"><option value="ordered">Ordered</option><option value="in_production">In production</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option></select></label><label>Tracking number<input name="tracking_number" /></label><label>Notes<textarea name="notes" /></label><button type="submit">Create shipment</button></form></div>
        <div className="card"><h2>Add item to shipment</h2><form className="stack" action={addPurchaseOrderItem}><label>Shipment / PO<select name="purchase_order_id" required><option value="">Choose PO</option>{(allPos || []).map((po: any) => <option key={po.id} value={po.id}>{po.po_number} · {po.suppliers?.name}</option>)}</select></label><label>Part<select name="part_id" required><option value="">Choose part</option>{(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><div className="form-row"><label>Qty ordered<input name="quantity_ordered" type="number" step="0.01" required /></label><label>Unit cost<input name="unit_cost" type="number" step="0.01" defaultValue="0" /></label></div><label>Notes<textarea name="notes" /></label><button type="submit">Add shipment item</button></form></div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Shipments / POs</h2><span className="badge info">{pos.length} shown</span></div><div className="wide-table"><table><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Order date</th><th>Expected</th><th>Tracking</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{pos.map((po:any) => <tr key={po.id}><td><Link className="link" href={`/shipments/${po.id}`}>{po.po_number}</Link></td><td>{po.suppliers?.name}</td><td><span className="badge info">{po.status}</span></td><td>{date(po.order_date)}</td><td>{date(po.expected_date)}</td><td>{po.tracking_number}</td><td>{po.notes}</td><td><div className="action-row"><Link className="button small-btn secondary" href={`/shipments/${po.id}`}>Open</Link><form action={deletePurchaseOrder}><input type="hidden" name="id" value={po.id}/><button className="small-btn danger" type="submit">Delete</button></form></div></td></tr>)}{pos.length === 0 && <tr><td colSpan={8}><div className="empty-state">No shipments match this filter.</div></td></tr>}</tbody></table></div></div>

      <div className="card table-card"><div className="table-head"><h2>Open shipment items</h2></div><div className="wide-table"><table><thead><tr><th>PO</th><th>Supplier</th><th>Part</th><th>Expected</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead><tbody>{(openItems || []).map((r: any) => <tr key={r.purchase_order_item_id}><td><Link className="link" href={`/shipments/${r.purchase_order_id}`}>{r.po_number}</Link></td><td>{r.supplier_name}</td><td><Link className="link" href={`/parts/${r.part_id}`}>{r.part_sku} · {r.part_name}</Link></td><td>{date(r.expected_date)}</td><td>{num(r.quantity_ordered)}</td><td>{num(r.quantity_received)}</td><td>{num(r.remaining_qty)}</td><td>{r.tracking_number}</td><td><Link className="button small-btn secondary" href={`/shipments/${r.purchase_order_id}`}>Receive</Link></td></tr>)}{(openItems || []).length === 0 && <tr><td colSpan={9}><div className="empty-state">No open shipment items.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
