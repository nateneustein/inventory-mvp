import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { date, num, today } from '@/lib/format'
import { SearchSelect } from '@/components/search-select'

export const dynamic = 'force-dynamic'

function isValidIso(s?: string) { return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) }

export default async function AdvancedPredictionPage({ searchParams }: { searchParams?: Promise<{ part_id?: string, as_of?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const asOf = isValidIso(params.as_of) ? params.as_of! : today()
  const { supabase } = await requireUser()

  // Same as-of rule as the basic sheet: any day inside a week shows the
  // position at the end of the previous week, with stock as it stood then.
  const { data: rows, error } = await supabase.rpc('part_prediction_as_of', { p_as_of: asOf })
  const parts = ((rows || []) as any[]).sort(
    (a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name).localeCompare(String(b.name))
  )

  const selectedPartId = params.part_id || parts[0]?.part_id
  const selected = parts.find((p: any) => p.part_id === selectedPartId)

  const { data: peakRow } = selectedPartId
    ? await supabase.from('part_usage_peaks').select('*').eq('part_id', selectedPartId).maybeSingle()
    : { data: null as any }

  const anchorDate = selected?.anchor_date || null
  const cutoff = selected?.cutoff_date || null

  // Windows stay 7 / 30 / 90 days, as this page has always used. The fix was
  // WHERE they are measured from: this page used to filter on created_at (the
  // import timestamp, identical for every back-filled row) and measure against
  // the server clock, so every window came back empty.
  const d7 = Number(selected?.usage_7 || 0)
  const d30 = Number(selected?.usage_30 || 0)
  const d90 = Number(selected?.usage_90 || 0)
  const lastYearComparable = Number(selected?.usage_same_period_last_year || 0)
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
      <div className="page-head">
        <div>
          <h1>Advanced Prediction</h1>
          <p className="muted">Calculate multiple reorder levels from usage, lead time, buffer, spikes and last-year comparison.</p>
        </div>
        <Link className="button secondary" href={`/predictions/basic?as_of=${asOf}`}>Basic sheet</Link>
      </div>

      {error && <div className="card danger-soft"><strong>Could not load predictions:</strong> {error.message}</div>}

      <div className="card">
        <form className="filter-bar">
          <label>Show as of<input name="as_of" type="date" defaultValue={asOf} max={today()} /></label>
          <label>Part
            <SearchSelect
              name="part_id"
              defaultValue={selectedPartId || ''}
              placeholder="Type a part name or SKU"
              options={parts.map((p: any) => ({ value: p.part_id, label: p.name, hint: p.sku }))}
            />
          </label>
          <button type="submit">Calculate</button>
          {selected && <Link className="button ghost" href={`/parts/${selected.part_id}`}>Open part</Link>}
        </form>
        <p className="muted small">
          Usage windows are measured back from {anchorDate ? date(anchorDate) : 'the latest imported usage'},
          the newest completed week on or before {cutoff ? date(cutoff) : 'today'}. Stock shown is what it was on that date.
        </p>
      </div>

      {selected && <>
        <div className="grid">
          <div className="card kpi-card"><div className="muted">Current stock</div><div className="kpi">{num(onHand)}</div></div>
          <div className="card kpi-card"><div className="muted">Incoming</div><div className="kpi">{num(incoming)}</div></div>
          <div className="card kpi-card"><div className="muted">Lead time + buffer</div><div className="kpi">{num(coverageDays)} days</div></div>
          <div className="card kpi-card"><div className="muted">Highest daily estimate</div><div className="kpi">{num(Math.max(highDaily, seasonalDaily))}</div></div>
        </div>
        <div className="card table-card"><div className="table-head"><h2>Recommended order amounts</h2><span className="badge info">Code calculation</span></div><table><thead><tr><th>Level</th><th>Order amount</th><th>What it means</th></tr></thead><tbody><tr><td>Low</td><td>{num(low)}</td><td>Based mainly on normal recent usage. Higher risk.</td></tr><tr><td>Normal</td><td>{num(normal)}</td><td>Blends last month and last three months.</td></tr><tr><td>Safe</td><td>{num(safe)}</td><td>Uses the highest recent or seasonal estimate.</td></tr><tr><td>Very safe</td><td>{num(verySafe)}</td><td>Adds extra protection for spikes and supplier delays.</td></tr></tbody></table></div>
        <div className="card table-card"><div className="table-head"><h2>Why</h2></div><table><tbody>
          <tr><th>Usage measured through</th><td>{anchorDate ? date(anchorDate) : '—'}</td></tr>
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
