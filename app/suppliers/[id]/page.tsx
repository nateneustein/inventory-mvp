import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { updateSupplier, deleteSupplier } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: supplier } = await supabase.from('suppliers').select('*').eq('id', id).single()
  const { data: parts } = await supabase.from('parts').select('*').eq('supplier_id', id).order('name')
  const { data: pos } = await supabase.from('purchase_orders').select('*').eq('supplier_id', id).order('created_at', { ascending: false }).limit(50)

  if (!supplier) return <div className="card"><h1>Supplier not found</h1><Link className="button" href="/suppliers">Back</Link></div>

  return (
    <>
      <div className="page-head"><div><h1>{supplier.name}</h1><p className="muted">Supplier profile, linked parts, and shipment history.</p></div><Link className="button secondary" href="/suppliers">Back to suppliers</Link></div>
      <div className="grid two">
        <div className="card">
          <h2>Edit supplier</h2>
          <form className="stack" action={updateSupplier}>
            <input type="hidden" name="id" value={id} />
            <div className="form-row"><label>Name<input name="name" defaultValue={supplier.name || ''} required /></label><label>Contact<input name="contact_name" defaultValue={supplier.contact_name || ''} /></label></div>
            <div className="form-row"><label>Email<input name="email" type="email" defaultValue={supplier.email || ''} /></label><label>Phone<input name="phone" defaultValue={supplier.phone || ''} /></label></div>
            <label>Website<input name="website" defaultValue={supplier.website || ''} /></label>
            <label>Notes<textarea name="notes" defaultValue={supplier.notes || ''} /></label>
            <button type="submit">Save supplier</button>
          </form>
          <form action={deleteSupplier}><input type="hidden" name="id" value={id} /><button className="danger" type="submit">Delete supplier</button></form>
        </div>
        <div className="card">
          <h2>Supplier card</h2>
          <dl className="detail-list">
            <div><dt>Contact</dt><dd>{supplier.contact_name}</dd></div>
            <div><dt>Email</dt><dd>{supplier.email}</dd></div>
            <div><dt>Phone</dt><dd>{supplier.phone}</dd></div>
            <div><dt>Website</dt><dd>{supplier.website && <a className="link" href={supplier.website}>{supplier.website}</a>}</dd></div>
            <div><dt>Created</dt><dd>{date(supplier.created_at)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Parts from this supplier</h2><Link className="button small-btn secondary" href="/parts">All parts</Link></div><table><thead><tr><th>Part</th><th className="sku-col">SKU</th><th>Category</th><th>Unit</th><th>Status</th><th></th></tr></thead><tbody>{(parts || []).map((p:any) => <tr key={p.id}><td><Link className="link" href={`/parts/${p.id}`}>{p.name}</Link></td><td className="sku-col">{p.sku}</td><td>{p.category}</td><td>{p.unit}</td><td><span className={`badge ${p.active ? 'ok' : 'archived'}`}>{p.active ? 'active' : 'archived'}</span></td><td><Link className="button small-btn secondary" href={`/parts/${p.id}`}>Open</Link></td></tr>)}{(parts || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No parts linked to this supplier.</div></td></tr>}</tbody></table></div>

      <div className="card table-card"><div className="table-head"><h2>Recent shipments / POs</h2><Link className="button small-btn secondary" href="/shipments">All shipments</Link></div><table><thead><tr><th>PO</th><th>Status</th><th>Order date</th><th>Expected</th><th>Tracking</th><th></th></tr></thead><tbody>{(pos || []).map((po:any) => <tr key={po.id}><td><Link className="link" href={`/shipments/${po.id}`}>{po.po_number}</Link></td><td><span className="badge info">{po.status}</span></td><td>{date(po.order_date)}</td><td>{date(po.expected_date)}</td><td>{po.tracking_number}</td><td><Link className="button small-btn secondary" href={`/shipments/${po.id}`}>Open</Link></td></tr>)}{(pos || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No POs for this supplier.</div></td></tr>}</tbody></table></div>
    </>
  )
}
