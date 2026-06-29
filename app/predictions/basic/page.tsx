import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { num } from '@/lib/format'

function daysAgo(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString() }
function match(row:any, q:string) { return `${row.name||''} ${row.sku||''} ${row.category||''}`.toLowerCase().includes(q.toLowerCase()) }

export default async function BasicPredictionPage({ searchParams }: { searchParams?: Promise<{ q?: string, status?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const statusFilter = params.status || ''
  const { supabase } = await requireUser()
  const { data: status } = await supabase.from('inventory_status').select('*').order('name')
  const { data: movements } = await supabase.from('inventory_movements').select('part_id, quantity, created_at').lt('quantity', 0).gte('created_at', daysAgo(95))

  const usage = new Map<string, { d7: number, d30: number, d90: number }>()
  const now = Date.now()
  for (const m of movements || []) {
    const ageDays = (now - new Date(m.created_at).getTime()) / 86400000
    const row = usage.get(m.part_id) || { d7: 0, d30: 0, d90: 0 }
    const qty = Math.abs(Number(m.quantity || 0))
    if (ageDays <= 7) row.d7 += qty
    if (ageDays <= 30) row.d30 += qty
    if (ageDays <= 90) row.d90 += qty
    usage.set(m.part_id, row)
  }

  const rows = (status || []).filter((p:any) => (!q || match(p, q)) && (!statusFilter || p.stock_status === statusFilter)).map((p: any) => {
    const u = usage.get(p.part_id) || { d7: 0, d30: 0, d90: 0 }
    const avg7 = u.d7 / 7, avg30 = u.d30 / 30, avg90 = u.d90 / 90
    const blendedDaily = avg30 || avg90 || avg7 || 0
    const onHand = Number(p.on_hand || 0)
    return { p, u, blendedDaily, stock4w: onHand - blendedDaily * 28, stock5w: onHand - blendedDaily * 35, stock2m: onHand - blendedDaily * 60, stock25m: onHand - blendedDaily * 75, stock3m: onHand - blendedDaily * 90 }
  })

  return (
    <>
      <div className="page-head"><div><h1>Basic Prediction</h1><p className="muted">Spreadsheet-style prediction view based on recent actual inventory usage.</p></div><Link className="button" href="/predictions/advanced">Advanced calculator</Link></div>
      <div className="card"><form className="filter-bar" action="/predictions/basic"><label>Search parts<input name="q" defaultValue={q} placeholder="SKU, part, category" /></label><label className="compact">Status<select name="status" defaultValue={statusFilter}><option value="">All</option><option value="out">Out</option><option value="reorder_now">Reorder now</option><option value="getting_low">Getting low</option><option value="ok">OK</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/predictions/basic">Clear</Link></form></div>
      <div className="card table-card"><div className="table-head"><h2>Prediction sheet</h2><span className="badge info">{rows.length} rows</span></div><div className="wide-table"><table><thead><tr><th>Part</th><th>SKU</th><th>Current</th><th>Last 1 week</th><th>Last 30 days</th><th>Last 90 days</th><th>Avg/day</th><th>Stock in 4 weeks</th><th>5 weeks</th><th>2 months</th><th>2.5 months</th><th>3 months</th><th></th></tr></thead><tbody>{rows.map(({ p, u, blendedDaily, stock4w, stock5w, stock2m, stock25m, stock3m }: any) => <tr key={p.part_id}><td><Link className="link" href={`/parts/${p.part_id}`}>{p.name}</Link></td><td>{p.sku}</td><td>{num(p.on_hand)}</td><td>{num(u.d7)}</td><td>{num(u.d30)}</td><td>{num(u.d90)}</td><td>{num(blendedDaily)}</td><td>{num(stock4w)}</td><td>{num(stock5w)}</td><td>{num(stock2m)}</td><td>{num(stock25m)}</td><td>{num(stock3m)}</td><td><Link className="button small-btn secondary" href={`/predictions/advanced?part_id=${p.part_id}`}>Advanced</Link></td></tr>)}{rows.length === 0 && <tr><td colSpan={13}><div className="empty-state">No prediction rows match this filter.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
