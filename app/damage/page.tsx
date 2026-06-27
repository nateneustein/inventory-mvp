import { requireUser } from '@/lib/require-user'
import { reportDamage } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function DamagePage() {
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('parts').select('id, name, sku').order('name')
  const { data: reports } = await supabase
    .from('damage_reports')
    .select('*, parts(name, sku)')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <>
      <h1>Damage / Scrap</h1>
      <p className="muted">Fast form for supplier damage, production damage, wrong cuts, missing pieces, samples, and unknown shrinkage.</p>

      <div className="card">
        <h2>Report damaged inventory</h2>
        <form className="stack" action={reportDamage}>
          <div className="form-row">
            <label>Part
              <select name="part_id" required>
                <option value="">Choose part</option>
                {(parts || []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
              </select>
            </label>
            <label>Qty damaged / removed<input name="quantity" type="number" step="0.01" required /></label>
            <label>Reason
              <select name="reason" required>
                <option value="supplier_damaged">Supplier damaged</option>
                <option value="production_damaged">Production damaged</option>
                <option value="wrong_cut">Wrong cut</option>
                <option value="broken_in_shipping">Broken in shipping</option>
                <option value="testing_sample">Testing / sample</option>
                <option value="missing">Missing</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
          </div>
          <label>Order reference, optional<input name="order_reference" placeholder="Etsy #12345, Amazon order, etc." /></label>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Remove from inventory</button>
        </form>
      </div>

      <div className="card">
        <h2>Recent damage</h2>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>Qty</th><th>Reason</th><th>Order ref</th><th>Notes</th></tr></thead>
          <tbody>
            {(reports || []).map((r: any) => (
              <tr key={r.id}>
                <td>{date(r.created_at)}</td><td>{r.parts?.sku} - {r.parts?.name}</td><td>{num(r.quantity)}</td><td>{r.reason}</td><td>{r.order_reference}</td><td>{r.notes}</td>
              </tr>
            ))}
            {(reports || []).length === 0 && <tr><td colSpan={6}>No damage reports yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
