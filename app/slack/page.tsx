import { requireUser } from '@/lib/require-user'
import { saveSlackSettings, sendTestSlackNotification } from '@/lib/actions'
import { date } from '@/lib/format'

export default async function SlackPage() {
  const { supabase } = await requireUser()
  const { data: settings } = await supabase.from('slack_notification_settings').select('*').order('created_at', { ascending: false }).limit(20)
  const { data: notifications } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)

  return (
    <>
      <h1>Slack Notifications</h1>
      <p className="muted">For MVP, add a Slack Incoming Webhook URL to Vercel as SLACK_WEBHOOK_URL. This page controls what types of alerts we want to send.</p>

      <div className="grid">
        <div className="card">
          <h2>Add notification rule</h2>
          <form className="stack" action={saveSlackSettings}>
            <label>Slack channel name<input name="channel_name" placeholder="inventory-alerts" required /></label>
            <label className="small"><input name="notify_low_stock" type="checkbox" defaultChecked style={{ width: 'auto' }} /> Low stock alerts</label>
            <label className="small"><input name="notify_overdue_shipments" type="checkbox" defaultChecked style={{ width: 'auto' }} /> Overdue shipment alerts</label>
            <label className="small"><input name="notify_zero_stock" type="checkbox" defaultChecked style={{ width: 'auto' }} /> Zero stock alerts</label>
            <label>Notes<textarea name="notes" /></label>
            <button type="submit">Save Slack rule</button>
          </form>
        </div>
        <div className="card">
          <h2>Test Slack</h2>
          <p className="muted">This will only work after SLACK_WEBHOOK_URL is added in Vercel environment variables.</p>
          <form action={sendTestSlackNotification}><button type="submit">Send test message</button></form>
        </div>
      </div>

      <div className="card">
        <h2>Saved settings</h2>
        <table><thead><tr><th>Channel</th><th>Low stock</th><th>Overdue shipments</th><th>Zero stock</th><th>Notes</th></tr></thead><tbody>{(settings || []).map((s: any) => <tr key={s.id}><td>{s.channel_name}</td><td>{String(s.notify_low_stock)}</td><td>{String(s.notify_overdue_shipments)}</td><td>{String(s.notify_zero_stock)}</td><td>{s.notes}</td></tr>)}</tbody></table>
      </div>

      <div className="card">
        <h2>Notification log</h2>
        <table><thead><tr><th>Date</th><th>Level</th><th>Title</th><th>Message</th></tr></thead><tbody>{(notifications || []).map((n: any) => <tr key={n.id}><td>{date(n.created_at)}</td><td>{n.level}</td><td>{n.title}</td><td>{n.message}</td></tr>)}</tbody></table>
      </div>
    </>
  )
}
