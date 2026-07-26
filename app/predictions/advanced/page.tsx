import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function AdvancedPredictionPage({ searchParams }: { searchParams?: Promise<{ part_id?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('*').order('name')
  const selectedPartId = params.part_id || parts?.[0]?.part_id
  const selected = (parts || []).find((p: any) => p.part_id === selectedPartId)

  // Windows are 7 / 30 / 90 days, as this page has always used.
  //
  // The only thing changed here is WHERE they are measured from. This page used
  // to filter on created_at -- which for back-filled history is the moment the
  // import ran and is identical for every row -- and then measure the windows
  // against the server clock. Because imported usage ends before today, every
  // window came back empty. They are now measured back from the newest real
  // usage date, so the numbers are non-zero and match the spreadsheet.
  const { data: windowRow } = selectedPartId
    ? await supabase.from('part_usage_windows').select('*').eq('part_id', selectedPartId).single()
    : { data: null as any }

  const { data: peakRow } = selectedPartId
    ? await supabase.from('part_usage_peaks').select('*').eq('part_id', selectedPartId).maybeSingle()
    : { data: null as any }

  const anchorDate = windowRow?.anchor_date || null
  const d7 = Number(windowRow?.usage_7 || 0)
  const d30 = Number(windowRow?.usage_30 || 0)
  const d90 = Number(windowRow?.usage_90 || 0)
  const lastYearComparable = Number(windowRow?.usage_same_period_last_year || 0)
  const largestAbsoluteWeek = Number(peakRow?.largest_week_qty || 0)
  const largestPercentJump = Number(peakRow?.largest_week_jump_pct || 0)

  const leadTime = Number(selected?.lead_time_days_max || 0)
  const bufferDays = Number(selected?.safety_stock_days || 0)
  const incoming = Number(selected?.incoming_qty || 0)
  const onHand = Number(selected?.on_hand || 0)

  const avg30 = d30 / 30, avg90 = d90 / 90, avg7 = d7 / 7
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
      <div className="page-head"><div><h1>Advanced Prediction</h1><p className="muted">Calculate multiple reorder levels from usage, lead time, buffer, spikes, and last-year comparison. Usage windows are measured back from {anchorDate ? date(anchorDate) : 'the latest imported usage'}.</p></div><Link className="button secondary" href="/predictions/basic">Basic sheet</Link></div>
      <div className="card"><form className="filter-bar"><label>Part<select name="part_id" defaultValue={selectedPartId || ''}>{(parts || []).map((p: any) => <option key={p.part_id} value={p.part_id}>{p.sku} · {p.name}</option>)}</select></label><button type="submit">Calculate</button>{selected && <Link className="button ghost" href={`/parts/${selected.part_id}`}>Open part</Link>}</form></div>
      {selected && <>
        <div className="grid">
          <div className="card kpi-card"><div className="muted">Current stock</div><div className="kpi">{num(onHand)}</div></div>
          <div className="card kpi-card"><div className="muted">Incoming</div><div className="kpi">{num(incoming)}</div></div>
          <div className="card kpi-card"><div className="muted">Lead time + buffer</div><div className="kpi">{num(coverageDays)} days</div></div>
          <div className="card kpi-card"><div className="muted">Highest daily estimate</div><div className="kpi">{num(Math.max(highDaily, seasonalDaily))}</div></div>
        </div>
        <div className="card table-card"><div className="table-head"><h2>Recommended order amounts</h2><span className="badge info">Code calculation</span></div><table><thead><tr><th>Level</th><th>Order amount</th><th>What it means</th></tr></thead><tbody><tr><td>Low</td><td>{num(low)}</td><td>Based mainly on normal recent usage. Higher risk.</td></tr><tr><td>Normal</td><td>{num(normal)}</td><td>Blends last month and last three months.</td></tr><tr><td>Safe</td><td>{num(safe)}</td><td>Uses the highest recent or seasonal estimate.</td></tr><tr><td>Very safe</td><td>{num(verySafe)}</td><td>Adds extra protection for spikes and supplier delays.</td></tr></tbody></table></div>
        <div className="card table-card"><div className="table-head"><h2>Why</h2></div><table><tbody>
          <tr><th>Last 7 days usage</th><td>{num(d7)}</td></tr>
          <tr><th>Last 30 days usage</th><td>{num(d30)}</td></tr>
          <tr><th>Last 90 days usage</th><td>{num(d90)}</td></tr>
          <tr><th>Same-ish period last year</th><td>{num(lastYearComparable)}</td></tr>
          <tr><th>Largest weekly usage seen</th><td>{num(largestAbsoluteWeek)}</td></tr>
          <tr><th>Largest percentage jump seen</th><td>{num(largestPercentJump * 100)}%</td></tr>
          <tr><th>Manual reorder point</th><td>{num(selected.reorder_point)}</td></tr>
          <tr><th>Target stock</th><td>{num(selected.target_stock)}</td></tr>
        </tbody></table></div>
      </>}
    </>
  )
}
