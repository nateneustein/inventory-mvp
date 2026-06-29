import { requireUser } from '@/lib/require-user'
import { num } from '@/lib/format'

function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

export default async function BasicPredictionPage() {
  const { supabase } = await requireUser()
  const { data: status } = await supabase.from('inventory_status').select('*').order('name')
  const { data: movements } = await supabase
    .from('inventory_movements')
    .select('part_id, quantity, created_at')
    .lt('quantity', 0)
    .gte('created_at', daysAgo(95))

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

  const rows = (status || []).map((p: any) => {
    const u = usage.get(p.part_id) || { d7: 0, d30: 0, d90: 0 }
    const avg7 = u.d7 / 7
    const avg30 = u.d30 / 30
    const avg90 = u.d90 / 90
    const blendedDaily = avg30 || avg90 || avg7 || 0
    const onHand = Number(p.on_hand || 0)
    return { p, u, avg7, avg30, avg90, blendedDaily, stock4w: onHand - blendedDaily * 28, stock5w: onHand - blendedDaily * 35, stock2m: onHand - blendedDaily * 60, stock25m: onHand - blendedDaily * 75, stock3m: onHand - blendedDaily * 90 }
  })

  return (
    <>
      <h1>Basic Prediction</h1>
      <p className="muted">This is the spreadsheet-style prediction view. It shows current stock and estimated remaining stock using recent usage.</p>

      <div className="card wide-table">
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>Current</th><th>Last 1 week</th><th>Last 30 days</th><th>Last 90 days</th><th>Avg/day</th><th>Stock in 4 weeks</th><th>5 weeks</th><th>2 months</th><th>2.5 months</th><th>3 months</th></tr></thead>
          <tbody>
            {rows.map(({ p, u, blendedDaily, stock4w, stock5w, stock2m, stock25m, stock3m }: any) => (
              <tr key={p.part_id}>
                <td>{p.name}</td><td>{p.sku}</td><td>{num(p.on_hand)}</td><td>{num(u.d7)}</td><td>{num(u.d30)}</td><td>{num(u.d90)}</td><td>{num(blendedDaily)}</td><td>{num(stock4w)}</td><td>{num(stock5w)}</td><td>{num(stock2m)}</td><td>{num(stock25m)}</td><td>{num(stock3m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
