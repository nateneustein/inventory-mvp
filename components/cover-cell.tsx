import { num } from '@/lib/format'

/**
 * Replaces the old "Reorder point" column.
 *
 * A fixed reorder point told you nothing — every part sat at 0 and it never
 * triggered anything. What actually matters is: how long the stock lasts,
 * which of the three usage paces is sounding the alarm, and how deep in the
 * hole you end up if nothing is ordered.
 *
 * "Short by" uses the fastest pace on purpose. That is the lowest projection,
 * so it is the worst case you would be planning against.
 */
export function CoverCell({ row }: { row: any }) {
  const horizon = Number(row.reorder_horizon_days || 0)
  const cover = row.days_of_cover == null ? null : Number(row.days_of_cover)

  const paces = [
    { label: '1 week', days: row.days_of_cover_1wk_rate },
    { label: '4 week', days: row.days_of_cover_4wk_rate },
    { label: '3 month', days: row.days_of_cover_3mo_rate },
  ].filter((p) => p.days != null && Number(p.days) <= horizon)

  // Where the stock lands at the end of the window, at the fastest pace.
  const projected = Number(row.projected_qty || 0)
  const rate = Number(row.fastest_daily_rate || 0)
  const landing = projected - rate * horizon
  const short = landing < 0 ? Math.abs(landing) : 0

  if (cover == null || rate <= 0) {
    return (
      <td className="cover-cell">
        <span className="muted small">No usage recorded — never triggers</span>
      </td>
    )
  }

  return (
    <td className="cover-cell">
      <span className="cover-days">{num(cover)} days of cover</span>
      {paces.length > 0 ? (
        <span className="cover-why">
          {paces.map((p) => p.label).join(' + ')} pace says it runs out inside {num(horizon)} days
        </span>
      ) : (
        <span className="cover-why muted">Lasts past the {num(horizon)}-day window</span>
      )}
      {short > 0 && (
        <span className="cover-short">short by {num(short)} by day {num(horizon)}</span>
      )}
    </td>
  )
}
