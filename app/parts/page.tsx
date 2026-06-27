import { requireUser } from '@/lib/require-user'
import { createPart } from '@/lib/actions'
import { num } from '@/lib/format'

export default async function PartsPage() {
  const { supabase } = await requireUser()
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name')
  const { data: parts } = await supabase.from('inventory_status').select('*').order('name')

  return (
    <>
      <h1>Parts / Supplies</h1>
      <p className="muted">All raw inventory: acrylic, bases, boxes, envelopes, labels, watch cases, passport holders, etc.</p>

      <div className="card">
        <h2>Add part</h2>
        <form className="stack" action={createPart}>
          <div className="form-row">
            <label>Part name<input name="name" required /></label>
            <label>Internal SKU<input name="sku" required placeholder="LED-BASE-WHITE" /></label>
            <label>Category<input name="category" placeholder="Acrylic, packaging, base, etc." /></label>
          </div>
          <div className="form-row">
            <label>Supplier
              <select name="supplier_id">
                <option value="">No supplier yet</option>
                {(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Supplier part #<input name="supplier_part_number" /></label>
            <label>Unit<input name="unit" defaultValue="each" /></label>
          </div>
          <div className="form-row">
            <label>Lead time min days<input name="lead_time_days_min" type="number" step="0.01" defaultValue="0" /></label>
            <label>Lead time max days<input name="lead_time_days_max" type="number" step="0.01" defaultValue="0" /></label>
            <label>Safety stock days<input name="safety_stock_days" type="number" step="0.01" defaultValue="30" /></label>
          </div>
          <div className="form-row">
            <label>Reorder point<input name="reorder_point" type="number" step="0.01" defaultValue="0" /></label>
            <label>Target stock<input name="target_stock" type="number" step="0.01" defaultValue="0" /></label>
            <label>Default order qty<input name="default_order_quantity" type="number" step="0.01" defaultValue="0" /></label>
          </div>
          <label className="small"><input name="critical" type="checkbox" style={{ width: 'auto' }} /> Critical part, production stops if this runs out</label>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add part</button>
        </form>
      </div>

      <div className="card">
        <h2>Part inventory</h2>
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Reorder point</th><th>Target</th><th>Status</th></tr></thead>
          <tbody>
            {(parts || []).map((p: any) => (
              <tr key={p.part_id}>
                <td>{p.name}</td><td>{p.sku}</td><td>{num(p.on_hand)}</td><td>{num(p.incoming_qty)}</td><td>{num(p.projected_qty)}</td><td>{num(p.reorder_point)}</td><td>{num(p.target_stock)}</td>
                <td><span className={`badge ${p.stock_status === 'ok' ? 'ok' : p.stock_status === 'out' ? 'danger' : 'warning'}`}>{p.stock_status}</span></td>
              </tr>
            ))}
            {(parts || []).length === 0 && <tr><td colSpan={8}>No parts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
