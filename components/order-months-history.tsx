import { requireUser } from '@/lib/require-user'
import { date } from '@/lib/format'

/**
 * When the order amount for this part was changed, to what, and why.
 *
 * Deliberately the same shape as the reorder window history above it. These are
 * the two levers anyone actually pulls when stock goes wrong - how long a part
 * may run down before it shouts, and how much to buy when it does - so they
 * should read the same way and keep the same kind of record.
 */
export async function OrderMonthsHistory({ partId }: { partId: string }) {
  const { supabase } = await requireUser()
  const { data: rows } = await supabase
    .from('part_order_months_history')
    .select('id, old_months, new_months, note, changed_at')
    .eq('part_id', partId)
    .order('changed_at', { ascending: false })
    .limit(50)

  const history = rows || []

  return (
    <div className="card table-card">
      <div className="table-head">
        <h2>Order amount history</h2>
        <span className="badge info">{history.length} change(s)</span>
      </div>
      <div className="wide-table"><table>
        <thead><tr><th>Date</th><th>How much to order</th><th>Changed from</th><th>Reason</th></tr></thead>
        <tbody>
          {history.map((h: any) => (
            <tr key={h.id}>
              <td>{date(h.changed_at)}</td>
              <td style={{ whiteSpace: 'normal' }}><strong>{h.new_months || 'nothing set'}</strong></td>
              <td className="muted" style={{ whiteSpace: 'normal' }}>{h.old_months || 'set when the amount was introduced'}</td>
              <td style={{ whiteSpace: 'normal' }}>{h.note || <span className="muted">-</span>}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr><td colSpan={4}><div className="empty-state">No changes recorded yet.</div></td></tr>
          )}
        </tbody>
      </table></div>
    </div>
  )
}
