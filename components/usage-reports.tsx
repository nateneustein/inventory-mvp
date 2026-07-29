import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

/**
 * The spreadsheet's reports, in the same shape as the weekly usage timeline:
 * one row per week, one column per part, newest week first. Read straight
 * across and the reports line up with each other and with the timeline.
 *
 * Everything is derived from the movement ledger, so these can never drift
 * away from the stock figures on the rest of the app.
 */

const WEEKS_SHOWN = 26

type Col = { id: string, name: string, sku?: string }
type Row = { week_start: string, week_end?: string, month_name?: string, year?: number, values: any, total?: number }

function SheetGrid({
  title, note, badge, rows, cols, periodLabel = 'Week range', danger = false,
}: {
  title: string
  note: string
  badge?: string
  rows: Row[]
  cols: Col[]
  periodLabel?: string
  /** Colour negatives red — right for a stock balance, wrong for usage. */
  danger?: boolean
}) {
  // Only show columns that actually have a number somewhere in this window,
  // otherwise every report is 90 columns of blank.
  const used = cols.filter((c) => rows.some((r) => r.values && r.values[c.id] != null && Number(r.values[c.id]) !== 0))

  return (
    <div className="card table-card">
      <div className="table-head">
        <h2>{title}</h2>
        <span className="badge info">{badge || `${rows.length} weeks · ${used.length} columns`}</span>
      </div>
      <p className="muted small">{note}</p>
      {rows.length === 0 || used.length === 0 ? (
        <div className="empty-state">Nothing recorded in this window.</div>
      ) : (
        <div className="wide-table sheet-scroll sheet-sticky-head sheet-zoom-100 usage-grid"><table>
          <thead><tr>
            <th className="sticky-col date-col">{periodLabel}</th>
            <th>Month</th>
            <th>Year</th>
            {used.map((c) => (
              <th key={c.id} title={`${c.name}${c.sku ? ` · ${c.sku}` : ''}`}>
                {c.name}{c.sku && <span className="sku-under">{c.sku}</span>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.week_start}>
                <td className="sticky-col date-col">
                  {date(r.week_start)}{r.week_end && <><br />to {date(r.week_end)}</>}
                </td>
                <td>{r.month_name}</td>
                <td>{r.year}</td>
                {used.map((c) => {
                  const raw = r.values ? r.values[c.id] : null
                  const v = raw == null ? null : Number(raw)
                  return (
                    <td key={c.id} className={danger && v != null && v < 0 ? 'cell-danger' : undefined}>
                      {v == null ? '' : num(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

/** Turn a long table of {key, period_start, value} into the grid shape above. */
function toGrid(rows: any[], keyField: string, valueField: string) {
  const byPeriod = new Map<string, any>()
  for (const r of rows) {
    const p = r.period_start
    if (!byPeriod.has(p)) {
      const d = new Date(`${p}T00:00:00Z`)
      byPeriod.set(p, {
        week_start: p,
        month_name: d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }),
        year: d.getUTCFullYear(),
        values: {},
      })
    }
    byPeriod.get(p).values[r[keyField]] = Number(r[valueField] || 0)
  }
  return Array.from(byPeriod.values()).sort((a, b) => b.week_start.localeCompare(a.week_start))
}

export async function UsageReports() {
  const { supabase } = await requireUser()

  const [parts, variations, purchases, produced, stock, monthly, quarterly] = await Promise.all([
    supabase.from('parts').select('id, name, sku, sort_order').order('sort_order', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('product_variations').select('id, variation_name, internal_sku').order('variation_name'),
    supabase.from('weekly_purchases_grid').select('*').order('week_start', { ascending: false }).limit(WEEKS_SHOWN),
    supabase.from('weekly_produced_grid').select('*').order('week_start', { ascending: false }).limit(WEEKS_SHOWN),
    supabase.from('weekly_stock_grid').select('*').order('week_start', { ascending: false }).limit(WEEKS_SHOWN),
    supabase.from('part_usage_monthly').select('part_id, period_start, used_qty').not('used_qty', 'is', null).order('period_start', { ascending: false }).limit(3000),
    supabase.from('part_usage_quarterly').select('part_id, period_start, used_qty').order('period_start', { ascending: false }).limit(3000),
  ])

  const partCols: Col[] = (parts.data || []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku }))
  const varCols: Col[] = (variations.data || []).map((v: any) => ({ id: v.id, name: v.variation_name, sku: v.internal_sku }))

  const stockRows = stock.data || []
  const monthlyRows = toGrid(monthly.data || [], 'part_id', 'used_qty').slice(0, 18)
  const quarterRows = toGrid(quarterly.data || [], 'part_id', 'used_qty').slice(0, 10)

  return (
    <>
      <div className="card">
        <h2>Reports</h2>
        <p className="muted">
          Each report below reads the same way as the weekly usage timeline above: newest week at
          the top, one column per part. Showing the last {WEEKS_SHOWN} weeks. Columns with nothing
          in them are hidden so the sheets stay readable.
        </p>
      </div>

      <SheetGrid
        title="Purchases received — by week"
        note="Stock booked in from suppliers. A negative figure is a correction that was imported as a purchase."
        rows={purchases.data || []}
        cols={partCols}
      />

      <SheetGrid
        title="Units produced / sold — by week"
        note="Finished products made and sold, per week, from the production history."
        rows={produced.data || []}
        cols={varCols}
      />

      <SheetGrid
        title="Remaining stock — end of each week"
        note="What was actually left on the shelf when the week closed. This is the accurate figure for the week."
        rows={stockRows.map((r: any) => ({ ...r, values: r.closing_values }))}
        cols={partCols}
        danger
      />

      <SheetGrid
        title="Opening stock — start of each week"
        note="What each part started the week with. Kept as its own report because the opening figure belongs to the week before it closed — it is effectively the previous week's closing balance carried in, so it reads a week behind the remaining-stock sheet."
        rows={stockRows.map((r: any) => ({ ...r, values: r.opening_values }))}
        cols={partCols}
        danger
      />

      <SheetGrid
        title="Parts used — by month"
        note="The same consumption as the weekly timeline, rolled up into calendar months."
        rows={monthlyRows}
        cols={partCols}
        periodLabel="Month"
        badge={`${monthlyRows.length} months`}
      />

      <SheetGrid
        title="Parts used — by quarter"
        note="Consumption rolled up into quarters."
        rows={quarterRows}
        cols={partCols}
        periodLabel="Quarter"
        badge={`${quarterRows.length} quarters`}
      />
    </>
  )
}
