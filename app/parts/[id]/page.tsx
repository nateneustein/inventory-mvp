import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, reportZeroStock, reportDamage, updatePart, archivePart } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: part } = await supabase.from('inventory_status').select('*').eq('part_id', id).single()
  const { data: details } = await supabase.from('parts').select('*, suppliers(name, website, contact_name, email, phone)').eq('id', id).single()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name')
  const { data: movements } = await supabase.from('inventory_movements').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(75)
  const { data: incoming } = await supabase.from('open_po_items').select('*').eq('part_id', id)
  const { data: zeroReports } = await supabase.from('zero_stock_reports').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(10)
  const { data: damageReports } = await supabase.from('damage_reports').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(10)

  if (!part || !details) return <div className="card"><h1>Part not found</h1><Link className="button" href="/parts">Back to parts</Link></div>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{part.name}</h1>
          <p className="muted">Part card page for QR scanning. URL: <code>/parts/{id}</code></p>
        </div>
        <div className="action-row">
          <Link className="button secondary" href="/parts">Back</Link>
          <Link className="button" href={`/predictions/advanced?part_id=${id}`}>Calculate reorder</Link>
        </div>
      </div>

      <div className="grid">
        <div className="card kpi-card"><div className="muted">On hand</div><div className="kpi">{num(part.on_hand)}</div></div>
        <div className="card kpi-card"><div className="muted">Incoming</div><div className="kpi">{num(part.incoming_qty)}</div></div>
        <div className="card kpi-card"><div className="muted">Projected</div><div className="kpi">{num(part.projected_qty)}</div></div>
        <div className="card kpi-card"><div className="muted">Status</div><div className="kpi"><span className={`badge ${part.stock_status}`}>{part.stock_status}</span></div></div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Edit part / ordering settings</h2>
          <form className="stack" action={updatePart}>
            <input type="hidden" name="id" value={id} />
            <div className="form-row">
              <label>Name<input name="name" defaultValue={details.name || ''} required /></label>
              <label>SKU<input name="sku" defaultValue={details.sku || ''} required /></label>
              <label>Category<input name="category" defaultValue={details.category || ''} /></label>
            </div>
            <div className="form-row">
              <label>Supplier<select name="supplier_id" defaultValue={details.supplier_id || ''}><option value="">No supplier</option>{(suppliers || []).map((s:any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label>Supplier part #<input name="supplier_part_number" defaultValue={details.supplier_part_number || ''} /></label>
              <label>Unit<input name="unit" defaultValue={details.unit || 'each'} /></label>
            </div>
            <div className="form-row">
              <label>Lead min days<input name="lead_time_days_min" type="number" step="0.01" defaultValue={details.lead_time_days_min || 0} /></label>
              <label>Lead max days<input name="lead_time_days_max" type="number" step="0.01" defaultValue={details.lead_time_days_max || 0} /></label>
              <label>Safety days<input name="safety_stock_days" type="number" step="0.01" defaultValue={details.safety_stock_days || 0} /></label>
            </div>
            <div className="form-row">
              <label>Reorder point<input name="reorder_point" type="number" step="0.01" defaultValue={details.reorder_point || 0} /></label>
              <label>Target stock<input name="target_stock" type="number" step="0.01" defaultValue={details.target_stock || 0} /></label>
              <label>Default order qty<input name="default_order_quantity" type="number" step="0.01" defaultValue={details.default_order_quantity || 0} /></label>
            </div>
            <div className="form-row">
              <label className="small"><span><input name="critical" type="checkbox" defaultChecked={details.critical} style={{ width: 'auto', marginRight: 8 }} />Critical</span></label>
              <label className="small"><span><input name="active" type="checkbox" defaultChecked={details.active} style={{ width: 'auto', marginRight: 8 }} />Active</span></label>
            </div>
            <label>Notes<textarea name="notes" defaultValue={details.notes || ''} /></label>
            <button type="submit">Save part</button>
          </form>
          <form action={archivePart} className="inline-form"><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={details.active ? 'false' : 'true'} /><button className="danger" type="submit">{details.active ? 'Archive part' : 'Restore part'}</button></form>
        </div>

        <div className="card">
          <h2>Supplier / order card</h2>
          <dl className="detail-list">
            <div><dt>Supplier</dt><dd>{details.suppliers?.name || 'Not set'}</dd></div>
            <div><dt>Website</dt><dd>{details.suppliers?.website ? <a className="link" href={details.suppliers.website}>{details.suppliers.website}</a> : ''}</dd></div>
            <div><dt>Contact</dt><dd>{details.suppliers?.contact_name} {details.suppliers?.email}</dd></div>
            <div><dt>Lead time</dt><dd>{num(details.lead_time_days_min)}–{num(details.lead_time_days_max)} days</dd></div>
            <div><dt>Buffer</dt><dd>{num(details.safety_stock_days)} days</dd></div>
            <div><dt>Order qty</dt><dd>{num(details.default_order_quantity)}</dd></div>
          </dl>
          <hr />
          <h2>Warehouse quick actions</h2>
          <form className="stack" action={reportZeroStock}>
            <input type="hidden" name="part_id" value={id} />
            <label>Zero report note<textarea name="notes" placeholder="Scanned bin and there are none left" /></label>
            <button type="submit">Report zero</button>
          </form>
          <hr />
          <form className="stack" action={reportDamage}>
            <input type="hidden" name="part_id" value={id} />
            <label>Damaged qty<input name="quantity" type="number" step="0.01" required /></label>
            <label>Reason<select name="reason"><option value="supplier_damaged">Supplier damaged</option><option value="production_damaged">Production damaged</option><option value="wrong_cut">Wrong cut</option><option value="broken_in_shipping">Broken in shipping</option><option value="testing_sample">Testing/sample</option><option value="missing">Missing</option><option value="unknown">Unknown</option></select></label>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Report damage</button>
          </form>
          <hr />
          <form className="stack" action={createManualAdjustment}>
            <input type="hidden" name="part_id" value={id} />
            <label>Adjustment qty<input name="quantity_change" type="number" step="0.01" required placeholder="-3 or 10" /></label>
            <input type="hidden" name="reason" value="Part page manual adjustment" />
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Save adjustment</button>
          </form>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Incoming shipments for this part</h2><Link className="button small-btn secondary" href="/shipments">All shipments</Link></div>
        <table><thead><tr><th>PO</th><th>Supplier</th><th>Expected</th><th>Remaining</th><th>Tracking</th><th></th></tr></thead><tbody>{(incoming || []).map((i: any) => <tr key={i.purchase_order_item_id}><td><Link className="link" href={`/shipments/${i.purchase_order_id}`}>{i.po_number}</Link></td><td>{i.supplier_name}</td><td>{date(i.expected_date)}</td><td>{num(i.remaining_qty)}</td><td>{i.tracking_number}</td><td><Link className="button small-btn secondary" href={`/shipments/${i.purchase_order_id}`}>Open</Link></td></tr>)}{(incoming || []).length === 0 && <tr><td colSpan={6}><div className="empty-state">No incoming shipments.</div></td></tr>}</tbody></table>
      </div>

      <div className="grid two">
        <div className="card table-card"><div className="table-head"><h2>Zero reports</h2></div><table><thead><tr><th>Date</th><th>System qty</th><th>Notes</th></tr></thead><tbody>{(zeroReports || []).map((z:any) => <tr key={z.id}><td>{date(z.created_at)}</td><td>{num(z.system_quantity_at_report)}</td><td>{z.notes}</td></tr>)}{(zeroReports || []).length === 0 && <tr><td colSpan={3}><div className="empty-state">No zero reports for this part.</div></td></tr>}</tbody></table></div>
        <div className="card table-card"><div className="table-head"><h2>Damage reports</h2></div><table><thead><tr><th>Date</th><th>Qty</th><th>Reason</th><th>Notes</th></tr></thead><tbody>{(damageReports || []).map((d:any) => <tr key={d.id}><td>{date(d.created_at)}</td><td>{num(d.quantity)}</td><td>{d.reason}</td><td>{d.notes}</td></tr>)}{(damageReports || []).length === 0 && <tr><td colSpan={4}><div className="empty-state">No damage reports for this part.</div></td></tr>}</tbody></table></div>
      </div>

      <div className="card table-card">
        <div className="table-head"><h2>Recent movements</h2></div>
        <div className="wide-table"><table><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th></tr></thead><tbody>{(movements || []).map((m: any) => <tr key={m.id}><td>{date(m.created_at)}</td><td>{m.movement_type}</td><td>{num(m.quantity)}</td><td>{m.reason}</td><td>{m.notes}</td></tr>)}{(movements || []).length === 0 && <tr><td colSpan={5}><div className="empty-state">No movement history yet.</div></td></tr>}</tbody></table></div>
      </div>
    </>
  )
}
