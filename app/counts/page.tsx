import { requireUser } from '@/lib/require-user'
import { createCycleCount } from '@/lib/actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { rowMatches } from '@/lib/search'

export default async function CountsPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('part_id, name, sku, on_hand').order('sort_order', { ascending: true, nullsFirst: false }).order('name')
  const { data: counts } = await supabase
    .from('cycle_counts')
    .select('*, parts(name, sku)')
    .order('created_at', { ascending: false })
    .limit(100)

  const shown = (counts || []).filter((c: any) => rowMatches(q, c.parts?.sku, c.parts?.name, c.notes))

  return (
    <>
      <h1>Inventory Counts</h1>
      <p className="muted">Use this for quarterly counts or spot checks. The system logs the adjustment instead of silently changing stock.</p>

      <div className="card">
        <h2>Enter count</h2>
        <form className="stack" action={createCycleCount}>
          <div className="form-row">
            <label>Part
              <SearchSelect
                name="part_id"
                required
                placeholder="Type a part name or SKU"
                options={(parts || []).map((p: any) => ({
                  value: p.part_id,
                  label: `${p.sku} - ${p.name}`,
                  hint: `system says ${num(p.on_hand)}`,
                }))}
              />
            </label>
            <label>Actual counted quantity<input name="counted_quantity" type="number" step="0.01" required /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Quarterly count, box count, spot check, etc." /></label>
          <button type="submit">Save count adjustment</button>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h2>Recent counts</h2>
          <div className="table-tools">
            <form className="filter-bar" action="/counts">
              <input name="q" defaultValue={q} placeholder="Search part, SKU or notes" aria-label="Search counts" />
              <button className="small-btn" type="submit">Search</button>
            </form>
            <span className="badge info">{shown.length} shown</span>
          </div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>System qty</th><th>Counted qty</th><th>Difference</th><th>Notes</th></tr></thead>
          <tbody>
            {shown.map((c: any) => (
              <tr key={c.id}>
                <td>{date(c.created_at)}</td><td>{c.parts?.sku} - {c.parts?.name}</td><td>{num(c.system_quantity_at_count)}</td><td>{num(c.counted_quantity)}</td><td>{num(c.difference)}</td><td>{c.notes}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}><div className="empty-state">{q ? 'No counts match that search.' : 'No counts yet.'}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
