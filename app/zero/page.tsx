import { requireUser } from '@/lib/require-user'
import { reportZeroStock } from '@/lib/actions'
import { deleteZeroStockReport } from '@/lib/record-actions'
import { date, num } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'
import { rowMatches } from '@/lib/search'

export default async function ZeroPage({ searchParams }: { searchParams?: Promise<{ error?: string, notice?: string, q?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('*').order('sort_order', { ascending: true, nullsFirst: false }).order('name')
  const { data: reports } = await supabase.from('zero_stock_reports').select('*, parts(name, sku)').order('created_at', { ascending: false }).limit(50)
  const shown = (reports || []).filter((r: any) => rowMatches(q, r.parts?.sku, r.parts?.name, r.order_reference, r.notes))

  return (
    <>
      <h1>Report Zero / Out of Stock</h1>
      <p className="muted">Use this when warehouse physically reaches zero. This creates a failure report even if the system inventory thought we still had stock.</p>
      {params.error && <div className="card danger-soft"><strong>Zero report change failed:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card">
        <h2>Report actual zero</h2>
        <form className="stack" action={reportZeroStock}>
          <label>Part<SearchSelect name="part_id" required placeholder="Type a part name or SKU" options={(parts || []).map((p: any) => ({ value: p.part_id, label: `${p.sku} · ${p.name}`, hint: `system: ${num(p.on_hand)}` }))} /></label>
          <label>Order reference, optional<input name="order_reference" /></label>
          <label>What happened?<textarea name="notes" placeholder="Warehouse scanned card and says there are none left, order waiting, etc." /></label>
          <button type="submit">Report zero</button>
        </form>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h2>Recent zero reports</h2>
          <div className="table-tools">
            <form className="filter-bar" action="/zero">
              <input name="q" defaultValue={q} placeholder="Search part, order or notes" aria-label="Search zero reports" />
              <button className="small-btn" type="submit">Search</button>
            </form>
            <span className="badge info">{shown.length} shown</span>
          </div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>System qty at report</th><th>Order</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>
            {shown.map((r: any) => <tr key={r.id}><td>{date(r.created_at)}</td><td>{r.parts?.sku} · {r.parts?.name}</td><td>{num(r.system_quantity_at_report)}</td><td>{r.order_reference}</td><td>{r.notes}</td><td><form action={deleteZeroStockReport}><input type="hidden" name="id" value={r.id}/><button className="small-btn danger" type="submit">Remove</button></form></td></tr>)}
            {shown.length === 0 && <tr><td colSpan={6}><div className="empty-state">{q ? 'No zero reports match that search.' : 'No zero reports yet.'}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
