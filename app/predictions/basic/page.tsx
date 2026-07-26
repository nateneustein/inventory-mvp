import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

function isoToday() { return new Date().toISOString().slice(0, 10) }
function shiftDays(isoStr: string, days: number) {
  const d = new Date(`${isoStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function isValidIso(s?: string) { return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) }
function match(row: any, q: string) { return `${row.name || ''} ${row.sku || ''} ${row.category || ''}`.toLowerCase().includes(q.toLowerCase()) }

// Mirrors the PREDICTION tab exactly. The sheet works in WEEKS: each block
// divides its usage by its own week count (column A) and multiplies by the
// projection's week count. The day counts only build the date window.
const usagePeriods = [
  { label: 'Last 1 Week Usage', days: 7, weeks: 1, column: 'usage_7' },
  { label: 'Last 4 Week Usage', days: 28, weeks: 4, column: 'usage_28' },
  { label: 'Last 3 Month Usage', days: 91, weeks: 13.0357, column: 'usage_91' },
]

const projectionPeriods = [
  { label: 'Stock 4 Month', weeks: 17.381 },
  { label: 'Stock 3 Month', weeks: 13.0357 },
  { label: 'Stock 2.5 Month', weeks: 10.8631 },
  { label: 'Stock 2 Month', weeks: 8.69049 },
  { label: 'Stock 5 Weeks', weeks: 5 },
]

function zoomValue(raw?: string) {
  const allowed = ['50', '60', '70', '80', '90', '100', '110', '125', '150']
  return allowed.includes(raw || '') ? raw || '100' : '100'
}
function predictionHref(params: any, zoom: string) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.status) query.set('status', params.status)
  if (params.as_of) query.set('as_of', params.as_of)
  query.set('zoom', zoom)
  return `/predictions/basic?${query.toString()}`
}

export default async function BasicPredictionPage({ searchParams }: { searchParams?: Promise<{ q?: string, status?: string, zoom?: string, as_of?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const statusFilter = params.status || ''
  const zoom = zoomValue(params.zoom)
  const asOf = isValidIso(params.as_of) ? params.as_of! : isoToday()
  const { supabase } = await requireUser()

  // One call returns stock as it stood on that date plus the usage windows
  // measured back from the matching week. Picking any day inside a week shows
  // the picture as of the END of the previous week, so the sheet only moves
  // once a week, after Saturday closes.
  const { data: rows, error } = await supabase.rpc('part_prediction_as_of', { p_as_of: asOf })

  const all = (rows || []) as any[]
  all.sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name).localeCompare(String(b.name)))

  const cutoff: string | null = all[0]?.cutoff_date || null
  const anchorIso: string | null = all[0]?.anchor_date || null
  const earliestIso: string | null = all[0]?.earliest_date || null
  const anchorLabel = anchorIso || asOf

  const parts = all.filter((p: any) => (!q || match(p, q)) && (!statusFilter || p.stock_status === statusFilter))

  function windowHasFullData(days: number) {
    if (!earliestIso || !anchorIso) return false
    return shiftDays(anchorLabel, -(days - 1)) >= earliestIso
  }
  const usageFor = (p: any, column: string) => Number(p?.[column] || 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Basic Prediction</h1>
          <p className="muted">
            Spreadsheet-style prediction, matching the PREDICTION tab. Each block uses a different recent
            usage period, then projects what stock will be left after 5 weeks, 2 months, 2.5 months,
            3 months and 4 months.
          </p>
        </div>
        <Link className="button" href={`/predictions/advanced?as_of=${asOf}`}>Advanced calculator</Link>
      </div>

      {error && <div className="card danger-soft"><strong>Could not load predictions:</strong> {error.message}</div>}

      <div className="card">
        <form className="filter-bar" action="/predictions/basic">
          <label>Show the sheet as of
            <input name="as_of" type="date" defaultValue={asOf} max={isoToday()} />
          </label>
          <label>Search parts<input name="q" defaultValue={q} placeholder="SKU, part, category" /></label>
          <label className="compact">Status
            <select name="status" defaultValue={statusFilter}>
              <option value="">All</option><option value="out">Out</option>
              <option value="reorder_now">Reorder now</option>
              <option value="getting_low">Getting low</option><option value="ok">OK</option>
            </select>
          </label>
          <input type="hidden" name="zoom" value={zoom} />
          <button type="submit">Show</button>
          <Link className="button ghost" href="/predictions/basic">Today</Link>
        </form>
        <p className="muted small">
          The sheet only moves once a week, when Saturday closes. Pick any day inside a week and you see
          the position at the <strong>end of the week before it</strong> — never a half-finished week.
          {cutoff && <> Week ending <strong>{date(cutoff)}</strong>.</>}
        </p>
      </div>

      {!anchorIso && (
        <div className="card danger-soft">
          <strong>No usage recorded on or before {date(cutoff || asOf)}.</strong> Pick a later date.
        </div>
      )}

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>Prediction sheet</h2>
            <p className="muted small">
              Anchor date: {date(anchorLabel)} — the newest completed week of usage on or before {date(cutoff || asOf)}.
              Stock shown is what it was on that date. Negative numbers mean projected stockout.
            </p>
          </div>
          <div className="table-tools">
            <div className="zoom-controls"><span>Zoom</span>{['50', '60', '70', '80', '90', '100', '110', '125', '150'].map(z => <Link key={z} className={`button small-btn ${zoom === z ? '' : 'secondary'}`} href={predictionHref(params, z)}>{z}%</Link>)}</div>
            <span className="badge info">{parts.length} parts</span>
          </div>
        </div>
        <div className={`wide-table sheet-scroll sheet-sticky-head sheet-zoom-${zoom} prediction-grid`}><table>
          <thead><tr><th className="sticky-col prediction-label-col">Period / prediction</th><th>From</th><th>To</th><th>Weeks</th>{parts.map((p: any) => <th key={p.part_id}>{p.name}<br /><span className="muted small">{p.sku}</span></th>)}</tr></thead>
          <tbody>
            {usagePeriods.map((period) => {
              const from = shiftDays(anchorLabel, -(period.days - 1))
              const complete = windowHasFullData(period.days)
              return [
                <tr key={`${period.days}-usage`} className="section-row"><td className="sticky-col prediction-label-col"><strong>{period.label}</strong></td><td>{date(from)}</td><td>{date(anchorLabel)}</td><td>{period.weeks}</td>{parts.map((p: any) => <td key={p.part_id}>{complete ? num(usageFor(p, period.column)) : 'NA'}</td>)}</tr>,
                <tr key={`${period.days}-current`}><td className="sticky-col prediction-label-col">Current Stock</td><td>{date(anchorLabel)}</td><td>{date(anchorLabel)}</td><td></td>{parts.map((p: any) => <td key={p.part_id}>{num(p.on_hand)}</td>)}</tr>,
                ...projectionPeriods.map((projection) => <tr key={`${period.days}-${projection.label}`}><td className="sticky-col prediction-label-col">{projection.label}</td><td></td><td></td><td>{projection.weeks}</td>{parts.map((p: any) => {
                  if (!complete) return <td key={p.part_id}>-</td>
                  const perWeek = usageFor(p, period.column) / period.weeks
                  const projected = Number(p.on_hand || 0) - perWeek * projection.weeks
                  return <td key={p.part_id} className={projected < 0 ? 'cell-danger' : projected <= Number(p.reorder_point || 0) ? 'cell-warning' : ''}>{num(projected)}</td>
                })}</tr>),
                <tr key={`${period.days}-blank`} className="spacer-row"><td colSpan={parts.length + 4}></td></tr>
              ]
            })}
            {parts.length === 0 && <tr><td colSpan={5}><div className="empty-state">No prediction rows match this filter.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
