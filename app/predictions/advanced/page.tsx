import { requireUser } from '@/lib/require-user'
import { num } from '@/lib/format'

function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

export default async function AdvancedPredictionPage({ searchParams }: { searchParams?: Promise<{ part_id?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('*').order('name')
  const selectedPartId = params.part_id || parts?.[0]?.part_id
  const selected = (parts || []).find((p: any) => p.part_id === selectedPartId)

  const { data: movements } = selectedPartId
    ? await supabase.from('inventory_movements').select('*').eq('part_id', selectedPartId).lt('quantity', 0).gte('created_at', daysAgo(380)).order('created_at', { ascending: false })
    : { data: [] as any[] }

  let d7 = 0, d30 = 0, d90 = 0, lastYearComparable = 0, largestAbsoluteWeek = 0, largestPercentJump = 0
  const now = Date.now()
  const weekly = new Map<string, number>()

  for (const m of movements || []) {
    const dt = new Date(m.created_at)
    const age = (now - dt.getTime()) / 86400000
    const qty = Math.abs(Number(m.quantity || 0))
    if (age <= 7) d7 += qty
    if (age <= 30) d30 += qty
    if (age <= 90) d90 += qty
    if (age >= 335 && age <= 380) lastYearComparable += qty
    const week = `${dt.getFullYear()}-${Math.ceil((((dt.getTime() - new Date(dt.getFullYear(),0,1).getTime()) / 86400000) + new Date(dt.getFullYear(),0,1).getDay() + 1) / 7)}`
    weekly.set(week, (weekly.get(week) || 0) + qty)
  }

  const weekValues = Array.from(weekly.values()).filter((v) => v > 0)
  for (let i = 0; i < weekValues.length; i++) {
    largestAbsoluteWeek = Math.max(largestAbsoluteWeek, weekValues[i])
    if (i > 0 && weekValues[i] > 0) {
      const prev = weekValues[i - 1]
      if (prev > 0) largestPercentJump = Math.max(largestPercentJump, (weekValues[i] - prev) / prev)
    }
  }

  const leadTime = Number(selected?.lead_time_days_max || 0)
  const bufferDays = Number(selected?.safety_stock_days || 0)
  const incoming = Number(selected?.incoming_qty || 0)
  const onHand = Number(selected?.on_hand || 0)
  const avg30 = d30 / 30
  const avg90 = d90 / 90
  const avg7 = d7 / 7
  const normalDaily = avg30 || avg90 || avg7 || 0
  const highDaily = Math.max(avg7, avg30, avg90)
  const spikeDaily = Math.max(highDaily, largestAbsoluteWeek / 7)
  const seasonalDaily = Math.max(normalDaily, lastYearComparable / 45)
  const coverageDays = leadTime + bufferDays
  const low = Math.max(0, normalDaily * coverageDays - onHand - incoming)
  const normal = Math.max(0, Math.max(normalDaily, (avg30 + avg90) / 2) * coverageDays - onHand - incoming)
  const safe = Math.max(0, Math.max(highDaily, seasonalDaily) * coverageDays - onHand - incoming)
  const verySafe = Math.max(0, Math.max(spikeDaily, seasonalDaily) * (coverageDays + 30) - onHand - incoming)

  return (
    <>
      <h1>Advanced Prediction</h1>
      <p className="muted">Choose a part to calculate safe reorder levels. Code does the math first; later we can add an AI button to analyze these numbers.</p>

      <div className="card">
        <form>
          <label>Part
            <select name="part_id" defaultValue={selectedPartId || ''}>
              {(parts || []).map((p: any) => <option key={p.part_id} value={p.part_id}>{p.sku} · {p.name}</option>)}
            </select>
          </label>
          <button type="submit">Calculate</button>
        </form>
      </div>

      {selected && (
        <>
          <div className="grid">
            <div className="card"><div className="muted">Current stock</div><div className="kpi">{num(onHand)}</div></div>
            <div className="card"><div className="muted">Incoming</div><div className="kpi">{num(incoming)}</div></div>
            <div className="card"><div className="muted">Lead time + buffer</div><div className="kpi">{num(coverageDays)} days</div></div>
            <div className="card"><div className="muted">Highest daily estimate</div><div className="kpi">{num(Math.max(highDaily, seasonalDaily))}</div></div>
          </div>

          <div className="card">
            <h2>Recommended order amounts</h2>
            <table>
              <thead><tr><th>Level</th><th>Order amount</th><th>What it means</th></tr></thead>
              <tbody>
                <tr><td>Low</td><td>{num(low)}</td><td>Based mainly on normal recent usage. Higher risk.</td></tr>
                <tr><td>Normal</td><td>{num(normal)}</td><td>Blends last month and last three months.</td></tr>
                <tr><td>Safe</td><td>{num(safe)}</td><td>Uses the highest recent/seasonal estimate.</td></tr>
                <tr><td>Very safe</td><td>{num(verySafe)}</td><td>Adds extra protection for spikes and supplier delays.</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Why</h2>
            <table>
              <tbody>
                <tr><th>Last 7 days usage</th><td>{num(d7)}</td></tr>
                <tr><th>Last 30 days usage</th><td>{num(d30)}</td></tr>
                <tr><th>Last 90 days usage</th><td>{num(d90)}</td></tr>
                <tr><th>Same-ish period last year</th><td>{num(lastYearComparable)}</td></tr>
                <tr><th>Largest weekly usage seen</th><td>{num(largestAbsoluteWeek)}</td></tr>
                <tr><th>Largest percentage jump seen</th><td>{num(largestPercentJump * 100)}%</td></tr>
                <tr><th>Manual reorder point</th><td>{num(selected.reorder_point)}</td></tr>
                <tr><th>Target stock</th><td>{num(selected.target_stock)}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
