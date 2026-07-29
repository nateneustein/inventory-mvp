import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

/**
 * When the reorder window for this part was changed, and to what.
 *
 * Recorded by a database trigger rather than in the save action, so it catches
 * every change no matter which screen or script made it.
 */
export async function ReorderWindowHistory({ partId }: { partId: string }) {
  const { supabase } = await requireUser()
  const { data: rows } = await supabase
    .from('part_reorder_horizon_history')
    .select('id, old_days, new_days, changed_at')
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
      <table>
        <thead><tr><th>Date</th><th>Window</th><th>Changed from</th></tr></thead>
        <tbody>
          {history.map((h: any) => (
            <tr key={h.id}>
              <td>{date(h.changed_at)}</td>
              <td><strong>{num(h.new_days)} days</strong></td>
              <td className="muted">{h.old_days == null ? 'set when the window was introduced' : `${num(h.old_days)} days`}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr><td colSpan={3}><div className="empty-state">No changes recorded yet.</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
