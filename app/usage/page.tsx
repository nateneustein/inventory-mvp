import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { createManualUnitsSold } from '@/lib/actions'
import { ManualUsageRows } from '@/components/manual-usage-actions'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

const DAY = 86400000

function startOfSundayWeek(d: Date) {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  copy.setDate(copy.getDate() - copy.getDay())
  return copy
}

function iso(d: Date) { return d.toISOString().slice(0, 10) }
function addDays(d: Date, days: number) { const n = new Date(d); n.setDate(n.getDate() + days); return n }
function weekNumber(d: Date) {
  const start = new Date(d.getFullYear(), 0, 1)
  const firstSunday = startOfSundayWeek(start)
  return Math.floor((d.getTime() - firstSunday.getTime()) / (7 * DAY)) + 1
}
function monthName(d: Date) { return d.toLocaleString('en-US', { month: 'long' }) }
function variationLabel(v:any) { return `${v.internal_sku} · ${v.products?.name} · ${v.variation_name}` }

function zoomValue(raw?: string) {
  const allowed = ['50', '60', '70', '80', '90', '100', '110', '125', '150']
  return allowed.includes(raw || '') ? raw || '100' : '100'
}
function usageHref(params:any, zoom:string) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  query.set('zoom', zoom)
  return `/usage?${query.toString()}`
}

export default async function UsagePage({ searchParams }: { searchParams?: Promise<{ q?: string, zoom?: string, error?: string, notice?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const q = (params.q || '').toLowerCase()
  const zoom = zoomValue(params.zoom)
  const { supabase } = await requireUser()
  const { data: status } = await supabase.from('inventory_status').select('*').order('name')
  const { data: variations } = await supabase.from('product_variations').select('id, internal_sku, variation_name, products(name)').eq('active', true).order('internal_sku')
  const { data: movements } = await supabase
    .from('inventory_movements')
    .select('part_id, quantity, created_at, movement_date, movement_type')
    .lt('quantity', 0)
    .eq('movement_type', 'order_consumption')
    .is('archived_at', null)
    .order('movement_date', { ascending: true })
    .limit(50000)
  const { data: manualRows } = await supabase.from('manual_units_sold').select('*, product_variations(internal_sku, variation_name, products(name))').is('archived_at', null).order('sale_date', { ascending: false }).limit(100)

  const parts = (status || []).filter((p:any) => !q || `${p.name || ''} ${p.sku || ''} ${p.category || ''}`.toLowerCase().includes(q))

  const usageByWeek = new Map<string, Map<string, number>>()
  let firstWeek: Date | null = null
  let lastWeek: Date | null = null
  let latestDataDate: Date | null = null

  for (const m of movements || []) {
    const rawDate = m.movement_date || m.created_at
    const d = new Date(rawDate)
    if (Number.isNaN(d.getTime())) continue
    if (!latestDataDate || d > latestDataDate) latestDataDate = d
    const week = startOfSundayWeek(d)
    if (!firstWeek || week < firstWeek) firstWeek = week
    if (!lastWeek || week > lastWeek) lastWeek = week
    const weekKey = iso(week)
    const map = usageByWeek.get(weekKey) || new Map<string, number>()
    map.set(m.part_id, (map.get(m.part_id) || 0) + Math.abs(Number(m.quantity || 0)))
    usageByWeek.set(weekKey, map)
  }

  if (!lastWeek) lastWeek = startOfSundayWeek(new Date())
  if (!firstWeek) firstWeek = addDays(lastWeek, -7 * 12)

  const weeks: Date[] = []
  for (let d = new Date(firstWeek); d <= lastWeek; d = addDays(d, 7)) weeks.push(new Date(d))
  weeks.reverse()

  return (
    <>
      <div className="page-head"><div><h1>Inventory Usage</h1><p className="muted">Sunday-to-Saturday usage timeline. This is the replacement for the weekly usage section in the spreadsheet.</p></div></div>
      {params.error && <div className="card danger-soft"><strong>Manual usage was not saved:</strong> {params.error}</div>}
      {params.notice && <div className="card success-soft"><strong>{params.notice}</strong></div>}

      <div className="card">
        <h2>Add manual products produced / sold</h2>
        <p className="muted">Use this for bulk orders or any order line that actually represents multiple finished products. It will consume inventory using the BOM.</p>
        <form className="stack" action={createManualUnitsSold}>
          <div className="form-row"><label>Finished product / variation<select name="variation_id" required><option value="">Choose variation</option>{(variations || []).map((v:any)=><option key={v.id} value={v.id}>{variationLabel(v)}</option>)}</select></label><label>Quantity produced/sold<input name="quantity" type="number" step="0.01" required /></label><label>Date<input name="sale_date" type="date" defaultValue={iso(new Date())} required /></label></div>
          <div className="form-row"><label>Reason<select name="reason" defaultValue="bulk_order_manual_entry"><option value="bulk_order_manual_entry">Bulk order/manual split</option><option value="missing_from_platform_upload">Missing from platform upload</option><option value="correction">Correction</option><option value="other">Other</option></select></label><label>Order/reference<input name="order_reference" placeholder="Optional order number" /></label></div>
          <label>Notes<textarea name="notes" /></label>
          <button type="submit">Add manual sold units</button>
        </form>
      </div>

      <div className="card"><form className="filter-bar" action="/usage"><label>Filter parts<input name="q" defaultValue={params.q || ''} placeholder="Part name, SKU, category" /></label><button type="submit">Filter</button><Link className="button ghost" href="/usage">Clear</Link></form></div>

      <div className="card table-card">
        <div className="table-head"><div><h2>Weekly usage timeline</h2><p className="muted small">Each row is one Sunday-to-Saturday week. Columns are parts/components. Latest imported usage date: {latestDataDate ? date(iso(latestDataDate)) : 'none'}.</p></div><div className="table-tools"><div className="zoom-controls"><span>Zoom</span>{['50','60','70','80','90','100','110','125','150'].map(z => <Link key={z} className={`button small-btn ${zoom === z ? '' : 'secondary'}`} href={usageHref(params, z)}>{z}%</Link>)}</div><span className="badge info">{weeks.length} weeks</span></div></div>
        <div className={`wide-table sheet-scroll sheet-sticky-head sheet-zoom-${zoom} usage-grid`}><table>
          <thead><tr><th className="sticky-col date-col">Week range</th><th>Week #</th><th>Month</th><th>Year</th>{parts.map((p:any)=><th key={p.part_id}>{p.name}<br/><span className="muted small">{p.sku}</span></th>)}</tr></thead>
          <tbody>{weeks.map((w) => { const weekKey = iso(w); const weekMap = usageByWeek.get(weekKey) || new Map<string, number>(); return <tr key={weekKey}><td className="sticky-col date-col"><strong>{date(weekKey)}</strong><br/><span className="muted small">to {date(iso(addDays(w, 6)))}</span></td><td>{weekNumber(w)}</td><td>{monthName(w)}</td><td>{w.getFullYear()}</td>{parts.map((p:any)=><td key={p.part_id}>{num(weekMap.get(p.part_id) || 0)}</td>)}</tr> })}</tbody>
        </table></div>
      </div>

      <div className="card table-card"><div className="table-head"><h2>Current stock summary</h2></div><div className="wide-table"><table><thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Status</th></tr></thead><tbody>{parts.map((p: any) => <tr key={p.part_id}><td><Link className="link" href={`/parts/${p.part_id}`}>{p.name}</Link></td><td>{p.sku}</td><td>{num(p.on_hand)}</td><td>{num(p.incoming_qty)}</td><td>{num(p.projected_qty)}</td><td><span className={`badge ${p.stock_status}`}>{p.stock_status}</span></td></tr>)}</tbody></table></div></div>

      <div className="card table-card">
        <div className="table-head"><h2>Recent manual sold/produced entries</h2></div>
        <div className="wide-table"><table><thead><tr><th>Date</th><th>Week start</th><th>Variation</th><th>Qty</th><th>Reference</th><th>Reason</th><th>Notes</th><th>Actions</th></tr></thead><tbody><ManualUsageRows rows={manualRows || []} variations={variations || []} />{(manualRows || []).length === 0 && <tr><td colSpan={8}><div className="empty-state">No manual sold/produced entries yet.</div></td></tr>}</tbody></table></div>
      </div>
    </>
  )
}
