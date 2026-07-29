import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

/**
 * When the reorder window for this part was changed, to what, and why.
 *
 * The reason matters more than the number: "had an issue with report zeros so
 * making cover time longer" is the thing someone needs six months from now.
 */
export async function ReorderWindowHistory({ partId }: { partId: string }) {
  const { supabase } = await requireUser()
  const { data: rows } = await supabase
    .from('part_reorder_horizon_history')
    .select('id, old_days, new_days, note, changed_at')
    .eq('part_id', partId)
    .order('changed_at', { ascending: false })
    .limit(50)

  const history = rows || []

  return (
    <div className="card table-card">
      <div className="table-head">
        <h2>Reorder window history</h2>
        <span className="badge info">{history.length} change(s)</span>
      </div>
      <div className="wide-table"><table>
        <thead><tr><th>Date</th><th>Window</th><th>Changed from</th><th>Reason</th></tr></thead>
        <tbody>
          {history.map((h: any) => (
            <tr key={h.id}>
              <td>{date(h.changed_at)}</td>
              <td><strong>{num(h.new_days)} days</strong></td>
              <td className="muted">{h.old_days == null ? 'set when the window was introduced' : `${num(h.old_days)} days`}</td>
              <td style={{ whiteSpace: 'normal' }}>{h.note || <span className="muted">—</span>}</td>
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
