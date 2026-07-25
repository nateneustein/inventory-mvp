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

  // Usage windows and weekly peaks come from Postgres, measured back from the
  // newest imported usage date. The old version measured from the server clock
  // and filtered on created_at (the import timestamp, identical for every
  // back-filled row), so every recent-usage window came back empty.
  const { data: windowRow } = selectedPartId
    ? await supabase.from('part_usage_windows').select('*').eq('part_id', selectedPartId).single()
    : { data: null as any }

  const { data: peakRow } = selectedPartId
    ? await supabase.from('part_usage_peaks').select('*').eq('part_id', selectedPartId).maybeSingle()
    : { data: null as any }

  const anchorDate = windowRow?.anchor_date || null
  const d7 = Number(windowRow?.usage_7 || 0)
  const d28 = Number(windowRow?.usage_28 || 0)
  const d91 = Number(windowRow?.usage_91 || 0)
  const lastYearComparable = Number(windowRow?.usage_same_period_last_year || 0)
  const largestAbsoluteWeek = Number(peakRow?.largest_week_qty || 0)
  const averageWeek = Number(peakRow?.average_week_qty || 0)
  const spikeRatio = averageWeek > 0 ? (largestAbsoluteWeek - averageWeek) / averageWeek : 0

  const leadTime = Number(selected?.lead_time_days_max || 0)
  const bufferDays = Number(selected?.safety_stock_days || 0)
  const incoming = Number(selected?.incoming_qty || 0)
  const onHand = Number(selected?.on_hand || 0)

  const avg7 = d7 / 7, avg28 = d28 / 28, avg91 = d91 / 91
  const normalDaily = avg28 || avg91 || avg7 || 0
  const highDaily = Math.max(avg7, avg28, avg91)
  const spikeDaily = Math.max(highDaily, largestAbsoluteWeek / 7)
  const seasonalDaily = Math.max(normalDaily, lastYearComparable / 45)
  const coverageDays = leadTime + bufferDays

  const low = Math.max(0, normalDaily * coverageDays - onHand - incoming)
  const normal = Math.max(0, Math.max(normalDaily, (avg28 + avg91) / 2) * coverageDays - onHand - incoming)
  const safe = Math.max(0, Math.max(highDaily, seasonalDaily) * coverageDays - onHand - incoming)
  const verySafe = Math.max(0, Math.max(spikeDaily, seasonalDaily) * (coverageDays + 30) - onHand - incoming)

  const daysOfCover = highDaily > 0 ? (onHand + incoming) / highDaily : null

  return (
    <>
      <div className="page-head"><div><h1>Advanced Prediction</h1><p className="muted">Calculate multiple reorder levels from usage, lead time, buffer, spikes, and last-year comparison. All windows are measured back from {anchorDate ? date(anchorDate) : 'the latest imported usage'}.</p></div><Link className="button secondary" href="/predictions/basic">Basic sheet</Link></div>
      <div className="card"><form className="filter-bar"><label>Part<select name="part_id" defaultValue={selectedPartId || ''}>{(parts || []).map((p: any) => <option key={p.part_id} value={p.part_id}>{p.sku} · {p.name}</option>)}</select></label><button type="submit">Calculate</button>{selected && <Link className="button ghost" href={`/parts/${selected.part_id}`}>Open part</Link>}</form></div>
      {selected && onHand < 0 && <div className="card danger-soft"><strong>This part shows negative stock ({num(onHand)}).</strong> More usage was imported than stock ever received, so these recommendations are not trustworthy until a physical count is entered.</div>}
      {selected && coverageDays === 0 && <div className="card danger-soft"><strong>No lead time or safety buffer set for this part.</strong> Every recommendation below will come out as 0 until you set them on the part record.</div>}
      {selected && <>
        <div className="grid">
          <div className="card kpi-card"><div className="muted">Current stock</div><div className="kpi">{num(onHand)}</div></div>
          <div className="card kpi-card"><div className="muted">Incoming</div><div className="kpi">{num(incoming)}</div></div>
          <div className="card kpi-card"><div className="muted">Lead time + buffer</div><div className="kpi">{num(coverageDays)} days</div></div>
          <div className="card kpi-card"><div className="muted">Days of cover left</div><div className="kpi">{daysOfCover === null ? '—' : num(daysOfCover, 0)}</div></div>
        </div>
        <div className="card table-card"><div className="table-head"><h2>Recommended order amounts</h2><span className="badge info">Code calculation</span></div><table><thead><tr><th>Level</th><th>Order amount</th><th>What it means</th></tr></thead><tbody><tr><td>Low</td><td>{num(low)}</td><td>Based mainly on normal recent usage. Higher risk.</td></tr><tr><td>Normal</td><td>{num(normal)}</td><td>Blends last month and last three months.</td></tr><tr><td>Safe</td><td>{num(safe)}</td><td>Uses the highest recent or seasonal estimate.</td></tr><tr><td>Very safe</td><td>{num(verySafe)}</td><td>Adds extra protection for spikes and supplier delays.</td></tr></tbody></table></div>
        <div className="card table-card"><div className="table-head"><h2>Why</h2></div><table><tbody>
          <tr><th>Usage measured through</th><td>{anchorDate ? date(anchorDate) : '—'}</td></tr>
          <tr><th>Last 7 days usage</th><td>{num(d7)}</td></tr>
          <tr><th>Last 28 days usage</th><td>{num(d28)}</td></tr>
          <tr><th>Last 91 days usage</th><td>{num(d91)}</td></tr>
          <tr><th>Same period last year</th><td>{num(lastYearComparable)}</td></tr>
          <tr><th>Largest weekly usage seen</th><td>{num(largestAbsoluteWeek)}</td></tr>
          <tr><th>Average weekly usage</th><td>{num(averageWeek)}</td></tr>
          <tr><th>Peak vs average</th><td>{num(spikeRatio * 100, 0)}%</td></tr>
          <tr><th>Weeks with any usage</th><td>{num(peakRow?.weeks_with_usage, 0)}</td></tr>
          <tr><th>Manual reorder point</th><td>{num(selected.reorder_point)}</td></tr>
          <tr><th>Target stock</th><td>{num(selected.target_stock)}</td></tr>
        </tbody></table></div>
      </>}
    </>
  )
}
