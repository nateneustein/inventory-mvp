import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

/**
 * The reports that only existed in the spreadsheet until now: what was bought,
 * what the stock opened and closed at, what was produced, and usage rolled up
 * by month and quarter.
 *
 * All of it is derived from the same movement ledger the rest of the app uses,
 * so these numbers cannot drift away from the stock figures on other pages.
 */

function monthLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/** Pivot [{key, period_start, value}] into rows keyed by name with a column per period. */
function pivot(rows: any[], keyOf: (r: any) => string, valueOf: (r: any) => number) {
  const periods = Array.from(new Set(rows.map((r) => r.period_start as string))).sort()
  const byKey = new Map<string, { label: string, cells: Map<string, number>, total: number }>()
  for (const r of rows) {
    const label = keyOf(r)
    if (!byKey.has(label)) byKey.set(label, { label, cells: new Map(), total: 0 })
    const entry = byKey.get(label)!
    const v = Number(valueOf(r) || 0)
    entry.cells.set(r.period_start, (entry.cells.get(r.period_start) || 0) + v)
    entry.total += v
  }
  return {
    periods,
    rows: Array.from(byKey.values()).sort((a, b) => b.total - a.total),
  }
}

function PivotTable({ title, note, data, unit = '' }: { title: string, note: string, data: ReturnType<typeof pivot>, unit?: string }) {
  return (
    <div className="card table-card">
      <div className="table-head">
        <h2>{title}</h2>
        <span className="badge info">{data.rows.length} rows</span>
      </div>
      <p className="muted small">{note}</p>
      <div className="wide-table"><table>
        <thead><tr>
          <th className="sticky-col">Name</th>
          {data.periods.map((p) => <th key={p} style={{ textAlign: 'right' }}>{monthLabel(p)}</th>)}
          <th style={{ textAlign: 'right' }}>Total</th>
        </tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.label}>
              <td className="sticky-col name-cell">{r.label}</td>
              {data.periods.map((p) => (
                <td key={p} style={{ textAlign: 'right' }}>{r.cells.has(p) ? num(r.cells.get(p)) : ''}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.total)}{unit}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={data.periods.length + 2}><div className="empty-state">Nothing recorded in this window.</div></td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}

export async function UsageReports({ months = 6 }: { months?: number }) {
  const { supabase } = await requireUser()

  // Window: the last N months that actually contain data, not calendar months
  // from today — the ledger ends when the last upload ended.
  const { data: allPeriods } = await supabase
    .from('stock_ledger_monthly')
    .select('period_start')
    .order('period_start', { ascending: false })
    .limit(400)
  const periods = Array.from(new Set((allPeriods || []).map((r: any) => r.period_start))).sort().reverse()
  const window = periods.slice(0, months).sort()
  const from = window[0] || '1900-01-01'
  const latest = periods[0] || null

  const [{ data: ledger }, { data: purchases }, { data: produced }, { data: usage }, { data: quarterly }] = await Promise.all([
    supabase.from('stock_ledger_monthly').select('*').eq('period_start', latest).order('name'),
    supabase.from('purchases_received').select('*').gte('period_start', from).order('movement_date', { ascending: false }).limit(500),
    supabase.from('units_produced_monthly').select('*').gte('period_start', from).limit(2000),
    supabase.from('part_usage_monthly').select('*').gte('period_start', from).not('used_qty', 'is', null).limit(2000),
    supabase.from('part_usage_quarterly').select('*').order('period_start', { ascending: false }).limit(1000),
  ])

  const purchaseRows = purchases || []
  const purchasePivot = pivot(purchaseRows, (r) => r.name, (r) => r.quantity)

  const quarterAll = quarterly || []
  const quarterPeriods = Array.from(new Set(quarterAll.map((r: any) => r.period_start))).sort().reverse().slice(0, 6)
  const quarterPivot = pivot(quarterAll.filter((r: any) => quarterPeriods.includes(r.period_start)), (r) => r.name, (r) => r.used_qty)

  return (
    <>
      <div className="card">
        <h2>Reports</h2>
        <p className="muted">
          Everything below comes from the same movement history as the stock figures on the
          rest of the app, so the two can never disagree. Showing the last {window.length} month(s)
          of recorded activity{latest ? `, ending ${monthLabel(latest)}` : ''}.
        </p>
      </div>

      {/* ------------------------------------------- opening / remaining -- */}
      <div className="card table-card">
        <div className="table-head">
          <h2>Opening and remaining stock{latest ? ` — ${monthLabel(latest)}` : ''}</h2>
          <span className="badge info">{(ledger || []).length} parts</span>
        </div>
        <p className="muted small">
          What each part started the month with, what came in, what was used, and what was left.
          &ldquo;Other&rdquo; covers counts, damage, switches and manual adjustments.
        </p>
        <div className="wide-table compact-rows"><table>
          <thead><tr>
            <th>Part</th><th>Category</th>
            <th style={{ textAlign: 'right' }}>Opening</th>
            <th style={{ textAlign: 'right' }}>Received</th>
            <th style={{ textAlign: 'right' }}>Used</th>
            <th style={{ textAlign: 'right' }}>Other</th>
            <th style={{ textAlign: 'right' }}>Remaining</th>
          </tr></thead>
          <tbody>
            {(ledger || []).map((r: any) => (
              <tr key={r.part_id}>
                <td className="name-cell">{r.name}<span className="sku-under">{r.sku}</span></td>
                <td>{r.category}</td>
                <td style={{ textAlign: 'right' }}>{num(r.opening_stock)}</td>
                <td style={{ textAlign: 'right' }}>{Number(r.received) ? num(r.received) : ''}</td>
                <td style={{ textAlign: 'right' }}>{Number(r.used) ? num(r.used) : ''}</td>
                <td style={{ textAlign: 'right' }}>{Number(r.other_change) ? num(r.other_change) : ''}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }} className={Number(r.remaining_stock) < 0 ? 'cell-danger' : undefined}>{num(r.remaining_stock)}</td>
              </tr>
            ))}
            {(ledger || []).length === 0 && <tr><td colSpan={7}><div className="empty-state">No ledger data yet.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* ------------------------------------------------------ purchases -- */}
      <PivotTable
        title="Purchases received"
        note="Stock booked in from suppliers, by part and month."
        data={purchasePivot}
      />

      <div className="card table-card">
        <div className="table-head"><h2>Recent purchases</h2><span className="badge info">{purchaseRows.length} lines</span></div>
        <div className="wide-table compact-rows"><table>
          <thead><tr><th>Date</th><th>Part</th><th style={{ textAlign: 'right' }}>Qty</th><th>Reason</th><th>Notes</th></tr></thead>
          <tbody>
            {purchaseRows.slice(0, 100).map((r: any) => (
              <tr key={r.id}>
                <td>{date(r.movement_date)}</td>
                <td className="name-cell">{r.name}<span className="sku-under">{r.sku}</span></td>
                <td style={{ textAlign: 'right' }}>{num(r.quantity)}</td>
                <td>{r.reason}</td><td>{r.notes}</td>
              </tr>
            ))}
            {purchaseRows.length === 0 && <tr><td colSpan={5}><div className="empty-state">No purchases recorded in this window.</div></td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* ----------------------------------------------- units produced -- */}
      <PivotTable
        title="Units produced / sold"
        note="Finished products made and sold, per month, from the production history."
        data={pivot(produced || [], (r) => r.variation_name || r.product_name, (r) => r.units)}
      />

      {/* ------------------------------------------------ usage rollups -- */}
      <PivotTable
        title="Parts used — monthly"
        note="How much of each part was consumed by orders, month by month."
        data={pivot(usage || [], (r) => r.name, (r) => r.used_qty)}
      />

      <div className="card table-card">
        <div className="table-head">
          <h2>Parts used — quarterly</h2>
          <span className="badge info">{quarterPivot.rows.length} parts</span>
        </div>
        <p className="muted small">The same consumption rolled up into quarters, newest six.</p>
        <div className="wide-table"><table>
          <thead><tr>
            <th className="sticky-col">Part</th>
            {quarterPivot.periods.map((p) => {
              const d = new Date(`${p}T00:00:00Z`)
              return <th key={p} style={{ textAlign: 'right' }}>{`Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(2)}`}</th>
            })}
            <th style={{ textAlign: 'right' }}>Total</th>
          </tr></thead>
          <tbody>
            {quarterPivot.rows.map((r) => (
              <tr key={r.label}>
                <td className="sticky-col name-cell">{r.label}</td>
                {quarterPivot.periods.map((p) => <td key={p} style={{ textAlign: 'right' }}>{r.cells.has(p) ? num(r.cells.get(p)) : ''}</td>)}
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.total)}</td>
              </tr>
            ))}
            {quarterPivot.rows.length === 0 && <tr><td colSpan={quarterPivot.periods.length + 2}><div className="empty-state">No quarterly usage yet.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
