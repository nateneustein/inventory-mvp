import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

function isoDate(d: Date) { return d.toISOString().slice(0, 10) }
function shiftDays(isoStr: string, days: number) {
  const d = new Date(`${isoStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function match(row: any, q: string) { return `${row.name || ''} ${row.sku || ''} ${row.category || ''}`.toLowerCase().includes(q.toLowerCase()) }

const usagePeriods = [
  { label: 'Last 1 Week Usage', days: 7, column: 'usage_7' },
  { label: 'Last 4 Week Usage', days: 28, column: 'usage_28' },
  { label: 'Last 3 Month Usage', days: 91, column: 'usage_91' },
]

const projectionPeriods = [
  { label: 'Stock 4 Month', days: 120 },
  { label: 'Stock 3 Month', days: 91 },
  { label: 'Stock 2.5 Month', days: 76 },
  { label: 'Stock 2 Month', days: 60 },
  { label: 'Stock 5 Weeks', days: 35 },
]

function zoomValue(raw?: string) {
  const allowed = ['50', '60', '70', '80', '90', '100', '110', '125', '150']
  return allowed.includes(raw || '') ? raw || '100' : '100'
}
function predictionHref(params: any, zoom: string) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.status) query.set('status', params.status)
  query.set('zoom', zoom)
  return `/predictions/basic?${query.toString()}`
}

export default async function BasicPredictionPage({ searchParams }: { searchParams?: Promise<{ q?: string, status?: string, zoom?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = params.q || ''
  const statusFilter = params.status || ''
  const zoom = zoomValue(params.zoom)
  const { supabase } = await requireUser()

  const { data: status } = await supabase.from('inventory_status').select('*').order('name')

  // Usage windows are computed in Postgres against usage_anchor.anchor_date.
  // Previously this page downloaded every movement row and aggregated in JS,
  // which hit the Supabase max-rows cap and produced a stale anchor date and
  // zero recent usage for most parts.
  const { data: windowRows, error: windowError } = await supabase
    .from('part_usage_windows')
    .select('part_id, anchor_date, usage_7, usage_28, usage_91')

  const usage = new Map<string, any>()
  for (const row of windowRows || []) usage.set(row.part_id, row)

  const anchorIso: string | null = windowRows?.[0]?.anchor_date || null
  const anchorLabel = anchorIso || isoDate(new Date())

  const parts = (status || []).filter((p: any) => (!q || match(p, q)) && (!statusFilter || p.stock_status === statusFilter))

  function usageFor(partId: string, column: string) {
    return Number(usage.get(partId)?.[column] || 0)
  }

  return (
    <>
      <div className="page-head"><div><h1>Basic Prediction</h1><p className="muted">Spreadsheet-style prediction. Each block uses a different recent usage period, then projects what stock will be left after 5 weeks, 2 months, 2.5 months, 3 months, and 4 months. Usage imported through: {date(anchorLabel)}.</p></div><Link className="button" href="/predictions/advanced">Advanced calculator</Link></div>
      {windowError && <div className="card danger-soft"><strong>Usage windows could not be loaded:</strong> {windowError.message}</div>}
      {!anchorIso && <div className="card danger-soft"><strong>No usage history found.</strong> Predictions need imported usage before they can project anything.</div>}
      <div className="card"><form className="filter-bar" action="/predictions/basic"><label>Search parts<input name="q" defaultValue={q} placeholder="SKU, part, category" /></label><label className="compact">Status<select name="status" defaultValue={statusFilter}><option value="">All</option><option value="out">Out</option><option value="reorder_now">Reorder now</option><option value="getting_low">Getting low</option><option value="ok">OK</option></select></label><button type="submit">Filter</button><Link className="button ghost" href="/predictions/basic">Clear</Link></form></div>

      <div className="card table-card">
        <div className="table-head"><div><h2>Prediction sheet</h2><p className="muted small">Anchor date: {date(anchorLabel)} — the newest week of imported usage. Negative numbers mean projected stockout.</p></div><div className="table-tools"><div className="zoom-controls"><span>Zoom</span>{['50', '60', '70', '80', '90', '100', '110', '125', '150'].map(z => <Link key={z} className={`button small-btn ${zoom === z ? '' : 'secondary'}`} href={predictionHref(params, z)}>{z}%</Link>)}</div><span className="badge info">{parts.length} parts</span></div></div>
        <div className={`wide-table sheet-scroll sheet-sticky-head sheet-zoom-${zoom} prediction-grid`}><table>
          <thead><tr><th className="sticky-col prediction-label-col">Period / prediction</th><th>From</th><th>To</th><th>Days</th>{parts.map((p: any) => <th key={p.part_id}>{p.name}<br /><span className="muted small">{p.sku}</span></th>)}</tr></thead>
          <tbody>
            {usagePeriods.map((period) => {
              const from = shiftDays(anchorLabel, -(period.days - 1))
              return [
                <tr key={`${period.days}-usage`} className="section-row"><td className="sticky-col prediction-label-col"><strong>{period.label}</strong></td><td>{date(from)}</td><td>{date(anchorLabel)}</td><td>{period.days}</td>{parts.map((p: any) => <td key={p.part_id}>{num(usageFor(p.part_id, period.column))}</td>)}</tr>,
                <tr key={`${period.days}-current`}><td className="sticky-col prediction-label-col">Current Stock</td><td>{date(anchorLabel)}</td><td>{date(anchorLabel)}</td><td></td>{parts.map((p: any) => <td key={p.part_id} className={Number(p.on_hand) < 0 ? 'cell-danger' : ''}>{num(p.on_hand)}</td>)}</tr>,
                ...projectionPeriods.map((projection) => <tr key={`${period.days}-${projection.days}`}><td className="sticky-col prediction-label-col">{projection.label}</td><td></td><td></td><td>{projection.days}</td>{parts.map((p: any) => { const used = usageFor(p.part_id, period.column); const daily = used / period.days; const projected = Number(p.on_hand || 0) - daily * projection.days; return <td key={p.part_id} className={projected < 0 ? 'cell-danger' : projected <= Number(p.reorder_point || 0) ? 'cell-warning' : ''}>{num(projected)}</td> })}</tr>),
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
