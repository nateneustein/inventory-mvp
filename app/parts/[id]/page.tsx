import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualAdjustment, reportZeroStock, reportDamage } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: part } = await supabase.from('inventory_status').select('*').eq('part_id', id).single()
  const { data: details } = await supabase.from('parts').select('*, suppliers(name, website, contact_name, email, phone)').eq('id', id).single()
  const { data: movements } = await supabase.from('inventory_movements').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(50)
  const { data: incoming } = await supabase.from('open_po_items').select('*').eq('part_id', id)

  if (!part) return <div className="card"><h1>Part not found</h1></div>

  return (
    <>
      <h1>{part.name}</h1>
      <p className="muted">Part card page for QR scanning. URL: <code>/parts/{id}</code></p>

      <div className="grid">
        <div className="card"><div className="muted">On hand</div><div className="kpi">{num(part.on_hand)}</div></div>
        <div className="card"><div className="muted">Incoming</div><div className="kpi">{num(part.incoming_qty)}</div></div>
        <div className="card"><div className="muted">Projected</div><div className="kpi">{num(part.projected_qty)}</div></div>
        <div className="card"><div className="muted">Status</div><div className="kpi">{part.stock_status}</div></div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Supplier / ordering info</h2>
          <table><tbody>
            <tr><th>SKU</th><td>{part.sku}</td></tr>
            <tr><th>Supplier</th><td>{details?.suppliers?.name}</td></tr>
            <tr><th>Website</th><td>{details?.suppliers?.website}</td></tr>
            <tr><th>Contact</th><td>{details?.suppliers?.contact_name} {details?.suppliers?.email}</td></tr>
            <tr><th>Lead time</th><td>{num(details?.lead_time_days_min)}–{num(details?.lead_time_days_max)} days</td></tr>
            <tr><th>Safety buffer</th><td>{num(details?.safety_stock_days)} days</td></tr>
            <tr><th>Reorder point</th><td>{num(details?.reorder_point)}</td></tr>
            <tr><th>Target stock</th><td>{num(details?.target_stock)}</td></tr>
            <tr><th>Default order qty</th><td>{num(details?.default_order_quantity)}</td></tr>
            <tr><th>Notes</th><td>{details?.notes}</td></tr>
          </tbody></table>
          <p><Link className="button secondary" href={`/predictions/advanced?part_id=${id}`}>Calculate reorder amount</Link></p>
        </div>

        <div className="card">
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
            <input type="hidden" name="reason" value="QR card manual adjustment" />
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Save adjustment</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Incoming shipments for this part</h2>
        <table><thead><tr><th>PO</th><th>Supplier</th><th>Expected</th><th>Remaining</th><th>Tracking</th></tr></thead><tbody>{(incoming || []).map((i: any) => <tr key={i.purchase_order_item_id}><td>{i.po_number}</td><td>{i.supplier_name}</td><td>{date(i.expected_date)}</td><td>{num(i.remaining_qty)}</td><td>{i.tracking_number}</td></tr>)}{(incoming || []).length === 0 && <tr><td colSpan={5}>No incoming shipments.</td></tr>}</tbody></table>
      </div>

      <div className="card">
        <h2>Recent movements</h2>
        <table><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reason</th><th>Notes</th></tr></thead><tbody>{(movements || []).map((m: any) => <tr key={m.id}><td>{date(m.created_at)}</td><td>{m.movement_type}</td><td>{num(m.quantity)}</td><td>{m.reason}</td><td>{m.notes}</td></tr>)}</tbody></table>
      </div>
    </>
  )
}
