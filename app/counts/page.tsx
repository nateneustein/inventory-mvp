import { requireUser } from '@/lib/require-user'
import { createCycleCount } from '@/lib/actions'
import { date, num } from '@/lib/format'

export default async function CountsPage() {
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('part_id, name, sku, on_hand').order('name')
  const { data: counts } = await supabase
    .from('cycle_counts')
    .select('*, parts(name, sku)')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <>
      <h1>Inventory Counts</h1>
      <p className="muted">Use this for quarterly counts or spot checks. The system logs the adjustment instead of silently changing stock.</p>

      <div className="card">
        <h2>Enter count</h2>
        <form className="stack" action={createCycleCount}>
          <div className="form-row">
            <label>Part
              <select name="part_id" required>
                <option value="">Choose part</option>
                {(parts || []).map((p: any) => <option key={p.part_id} value={p.part_id}>{p.name} - {p.sku} - system says {num(p.on_hand)}</option>)}
              </select>
            </label>
            <label>Actual counted quantity<input name="counted_quantity" type="number" step="0.01" required /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Quarterly count, box count, spot check, etc." /></label>
          <button type="submit">Save count adjustment</button>
        </form>
      </div>

      <div className="card">
        <h2>Recent counts</h2>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>System qty</th><th>Counted qty</th><th>Difference</th><th>Notes</th></tr></thead>
          <tbody>
            {(counts || []).map((c: any) => (
              <tr key={c.id}>
                <td>{date(c.created_at)}</td><td><span className="entity-name">{c.parts?.name}</span><br/><span className="sku-small">{c.parts?.sku}</span></td><td>{num(c.system_quantity_at_count)}</td><td>{num(c.counted_quantity)}</td><td>{num(c.difference)}</td><td>{c.notes}</td>
              </tr>
            ))}
            {(counts || []).length === 0 && <tr><td colSpan={6}>No counts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
