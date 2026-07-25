import { requireUser } from '@/lib/require-user'
import { reportZeroStock } from '@/lib/actions'
import { deleteZeroStockReport } from '@/lib/record-actions'
import { date, num } from '@/lib/format'

export default async function ZeroPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('*').order('name')
  const { data: reports } = await supabase.from('zero_stock_reports').select('*, parts(name, sku)').order('created_at', { ascending: false }).limit(50)

  return (
    <>
      <h1>Report Zero / Out of Stock</h1>
      <p className="muted">Use this when the warehouse physically reaches zero, or when the shelf count does not match the system. Submitting this now <strong>corrects the stock number</strong> as well as logging the report — it used to only log a note, so the dashboard kept showing the part as fine and no reorder was ever triggered.</p>
      {params.error && <div className="card danger-soft"><strong>Zero report change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card">
        <h2>Report actual zero</h2>
        <form className="stack" action={reportZeroStock}>
          <label>Part<select name="part_id" required><option value="">Choose part</option>{(parts || []).map((p: any) => <option key={p.part_id} value={p.part_id}>{p.sku} · {p.name} · system: {num(p.on_hand)}</option>)}</select></label>
          <label>Actual quantity on the shelf<input name="actual_quantity" type="number" step="0.01" defaultValue="0" required /><span className="muted small">Leave at 0 for a true stockout. If you counted some, enter the real number and stock will be corrected to match.</span></label>
          <label>Order reference, optional<input name="order_reference" /></label>
          <label>What happened?<textarea name="notes" placeholder="Warehouse scanned card and says there are none left, order waiting, etc." /></label>
          <button type="submit">Report zero</button>
        </form>
      </div>

      <div className="card">
        <h2>Recent zero reports</h2>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>System said</th><th>Counted</th><th>Order</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>
            {(reports || []).map((r: any) => <tr key={r.id}><td>{date(r.created_at)}</td><td>{r.parts?.sku} · {r.parts?.name}</td><td>{num(r.system_quantity_at_report)}</td><td>{num(r.warehouse_quantity_reported)}</td><td>{r.order_reference}</td><td>{r.notes}</td><td><form action={deleteZeroStockReport}><input type="hidden" name="id" value={r.id}/><button className="small-btn danger" type="submit">Remove</button></form></td></tr>)}
            {(reports || []).length === 0 && <tr><td colSpan={7}>No zero reports yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
