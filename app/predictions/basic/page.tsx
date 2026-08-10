import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { date, num, today } from '@/lib/format'

export const dynamic = 'force-dynamic'

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
  { label: 'Stock 6 Month', weeks: 26.0714 },
  { label: 'Stock 5 Month', weeks: 21.7262 },
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
  const asOf = isValidIso(params.as_of) ? params.as_of! : today()
  const { supabase } = await requireUser()

  // One call returns stock as it stood on that date plus the usage windows
  // measured back from the matching week. Picking any day inside a week shows
  // the picture as of the END of the previous week, so the sheet only moves
  // once a week, after Saturday closes.
  const { data: rows, error } = await supabase.rpc('part_prediction_as_of', { p_as_of: asOf })
  // Which products need reordering right now - the SAME trigger the dashboard and
  // Slack use (cover has dropped below the warn window, which follows the advanced
  // prediction). Highlighted on the sheet so it is obvious at a glance.
  const { data: statusRows } = await supabase.from('inventory_status').select('part_id, days_of_cover, reorder_horizon_days, ignore_alerts')
  const reorderNow = new Set((statusRows || []).filter((r: any) => !r.ignore_alerts && r.days_of_cover != null && r.reorder_horizon_days != null && Number(r.days_of_cover) < Number(r.reorder_horizon_days)).map((r: any) => r.part_id))

  const all = (rows || []) as any[]
  all.sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name).localeCompare(String(b.name)))

  const cutoff: string | null = all[0]?.cutoff_date || null
  const anchorIso: string | null = all[0]?.anchor_date || null
  const earliestIso: string | null = all[0]?.earliest_date || null
  const anchorLabel = anchorIso || asOf

  const parts = all.filter((p: any) => (!q || match(p, q)) && (!statusFilter || p.stock_status === statusFilter))

  /* The sheet above counts a container the day it is ordered, which is right for
     the ordering decision but hides a real problem: the weeks BEFORE it lands.
     This pulls the first outstanding arrival per part so the gap can be worked
     out - enough to say "you are short 120 pieces for the five weeks until the
     container gets here", which is a small top-up order, not another container. */
  const { data: openLines } = await supabase
    .from('open_po_items')
    .select('part_id, po_number, expected_date, remaining_qty')
    .gt('remaining_qty', 0)

  const firstArrival = new Map<string, any>()
  for (const line of (openLines || []) as any[]) {
    if (!line.expected_date) continue
    const held = firstArrival.get(line.part_id)
    if (!held || line.expected_date < held.expected_date) firstArrival.set(line.part_id, line)
  }

  /* The fastest of the three paces, same rule the rest of the app uses: if any
     window says it is moving quickly, believe that one. */
  const gaps = parts.map((p: any) => {
    const arrival = firstArrival.get(p.part_id)
    if (!arrival) return null
    const paces = [
      { label: '1 week', perWeek: Number(p.usage_7 || 0) / 1 },
      { label: '4 week', perWeek: Number(p.usage_28 || 0) / 4 },
      { label: '3 month', perWeek: Number(p.usage_91 || 0) / 13.0357 },
    ]
    const driving = paces.reduce((fastest, pace) => (pace.perWeek > fastest.perWeek ? pace : fastest), paces[0])
    const perWeek = driving.perWeek
    if (perWeek <= 0) return null
    const daysAway = Math.max(0, Math.round(
      (Date.parse(`${arrival.expected_date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86400000,
    ))
    const onHand = Number(p.on_hand || 0)
    const needed = perWeek * (daysAway / 7)
    const shortBy = needed - onHand
    if (shortBy <= 0) return null
    const daysOfCover = onHand > 0 ? (onHand / perWeek) * 7 : 0
    return {
      part: p,
      arrival,
      perWeek,
      paces,
      driving,
      needed,
      daysOfCover,
      daysAway,
      onHand,
      shortBy,
      runsOut: shiftDays(asOf, Math.floor(daysOfCover)),
    }
  }).filter(Boolean) as any[]
  gaps.sort((a, b) => b.shortBy - a.shortBy)

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
            3, 4, 5 and 6 months.
          </p>
        </div>
        <Link className="button" href={`/predictions/advanced?as_of=${asOf}`}>Advanced calculator</Link>
      </div>

      {error && <div className="card danger-soft"><strong>Could not load predictions:</strong> {error.message}</div>}

      <div className="card">
        <form className="filter-bar" action="/predictions/basic">
          <label>Show the sheet as of
            <input name="as_of" type="date" defaultValue={asOf} max={today()} />
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
              Stock shown is what it was on that date, plus anything already on the way. Negative numbers mean projected stockout.
            </p>
          </div>
          <div className="table-tools">
            <div className="zoom-controls"><span>Zoom</span>{['50', '60', '70', '80', '90', '100', '110', '125', '150'].map(z => <Link key={z} className={`button small-btn ${zoom === z ? '' : 'secondary'}`} href={predictionHref(params, z)}>{z}%</Link>)}</div>
            <span className="badge info">{parts.length} parts</span>
          </div>
        </div>
        <div className={`wide-table sheet-scroll sheet-sticky-head sheet-zoom-${zoom} prediction-grid`}><table>
          <thead><tr><th className="sticky-col prediction-label-col">Period / prediction</th><th>From</th><th>To</th><th>Weeks</th>{parts.map((p: any) => <th key={p.part_id} className={p.ignore_alerts ? 'ignored-col' : (reorderNow.has(p.part_id) ? 'ap-reorder-col' : undefined)}>{p.name}<br /><span className="muted small">{p.sku}</span>{p.ignore_alerts ? <><br /><span className="badge ignored-alerts">alerts off</span></> : (reorderNow.has(p.part_id) ? <><br /><span className="badge ap-reorder-badge">Reorder now</span></> : null)}</th>)}</tr></thead>
          <tbody>
            {usagePeriods.map((period) => {
              const from = shiftDays(anchorLabel, -(period.days - 1))
              const complete = windowHasFullData(period.days)
              return [
                <tr key={`${period.days}-usage`} className="section-row"><td className="sticky-col prediction-label-col"><strong>{period.label}</strong></td><td>{date(from)}</td><td>{date(anchorLabel)}</td><td>{period.weeks}</td>{parts.map((p: any) => <td key={p.part_id}>{complete ? num(usageFor(p, period.column)) : 'NA'}</td>)}</tr>,
                <tr key={`${period.days}-current`}><td className="sticky-col prediction-label-col">Current Stock</td><td>{date(anchorLabel)}</td><td>{date(anchorLabel)}</td><td></td>{parts.map((p: any) => <td key={p.part_id}>{num(p.on_hand)}</td>)}</tr>,
                <tr key={`${period.days}-incoming`}><td className="sticky-col prediction-label-col">On the way</td><td></td><td></td><td></td>{parts.map((p: any) => <td key={p.part_id} className={Number(p.incoming_qty || 0) > 0 ? 'cell-incoming' : undefined}>{num(p.incoming_qty)}</td>)}</tr>,
                ...projectionPeriods.map((projection) => <tr key={`${period.days}-${projection.label}`}><td className="sticky-col prediction-label-col">{projection.label}</td><td></td><td></td><td>{projection.weeks}</td>{parts.map((p: any) => {
                  if (!complete) return <td key={p.part_id}>-</td>
                  const perWeek = usageFor(p, period.column) / period.weeks
                  // Counts what is already on the way as well as what is on the shelf.
                  // Somebody reading this column is deciding whether to order, and the
                  // worst outcome is ordering a second container because the first one
                  // was invisible here. The gap report underneath is what catches the
                  // other risk - running dry in the weeks before that container lands.
                  const projected = Number(p.on_hand || 0) + Number(p.incoming_qty || 0) - perWeek * projection.weeks
                  // Red means "go and order this". A part with alerts turned off
                  // still shows its shortfall, in orange, so it reads as known
                  // rather than urgent.
                  const tone = p.ignore_alerts
                    ? (projected < 0 || projected <= Number(p.reorder_point || 0) ? 'cell-ignored' : '')
                    : (projected < 0 ? 'cell-danger' : projected <= Number(p.reorder_point || 0) ? 'cell-warning' : '')
                  return <td key={p.part_id} className={tone}>{num(projected)}</td>
                })}</tr>),
                <tr key={`${period.days}-blank`} className="spacer-row"><td colSpan={parts.length + 4}></td></tr>
              ]
            })}
            {parts.length === 0 && <tr><td colSpan={5}><div className="empty-state">No prediction rows match this filter.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>Short before the shipment lands</h2>
            <p className="muted small">
              The sheet above already counts what is on the way, so nobody orders a second container by mistake.
              These are the parts that still run out in the meantime - they need a small top-up to bridge the gap,
              not another full order. Measured at whichever of the three paces is running fastest.
            </p>
          </div>
          <span className={'badge ' + (gaps.length > 0 ? 'out' : 'ok')}>{gaps.length}</span>
        </div>
        <div className="wide-table"><table>
          <thead><tr><th>Part</th><th>On hand</th><th>Using per week</th><th>Runs out about</th><th>Next shipment</th><th>Expected by</th><th>Days away</th><th>Short by</th><th>Why it says that</th></tr></thead>
          <tbody>
            {gaps.map((g: any) => (
              <tr key={g.part.part_id} className="alarm-row">
                <td className="name-cell">
                  <Link className="link" href={'/parts/' + g.part.part_id}>{g.part.name}</Link>
                  <span className="sku-under">{g.part.sku}</span>
                </td>
                <td>{num(g.onHand)}</td>
                <td>{num(g.perWeek)}</td>
                <td>{date(g.runsOut)}</td>
                <td>{g.arrival.po_number}</td>
                <td>{date(g.arrival.expected_date)}</td>
                <td>{g.daysAway}</td>
                <td><strong>{num(Math.ceil(g.shortBy))}</strong></td>
                <td style={{ whiteSpace: 'normal' }}>
                  <span className="why-list">
                    <span className="why-line">
                      <strong>{num(g.daysOfCover)} days of cover</strong> from the {num(g.onHand)} on the shelf
                    </span>
                    <span className="why-line muted">
                      {g.paces.map((pace: any) => pace.label + ' ' + num(pace.perWeek)).join(' · ')} per week
                      {' — going with the '}{g.driving.label} pace, the fastest
                    </span>
                    <span className="why-line">
                      Needs {num(Math.ceil(g.needed))} to reach {date(g.arrival.expected_date)}, has {num(g.onHand)}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
            {gaps.length === 0 && (
              <tr><td colSpan={9}><div className="empty-state">Nothing runs out before its shipment arrives.</div></td></tr>
            )}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
