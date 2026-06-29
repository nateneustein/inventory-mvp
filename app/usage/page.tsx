import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export default async function UsagePage() {
  const { supabase } = await requireUser()
  const { data: weekly } = await supabase.from('part_usage_weekly').select('*').order('period_start', { ascending: false }).limit(250)
  const { data: monthly } = await supabase.from('part_usage_monthly').select('*').order('period_start', { ascending: false }).limit(250)
  const { data: status } = await supabase.from('inventory_status').select('*').order('name')

  return (
    <>
      <h1>Inventory Usage</h1>
      <p className="muted">Spreadsheet-style view of what was used and what is left. This comes from inventory movements, order consumption, replacements, damages, and switches.</p>

      <div className="card wide-table">
        <h2>Current stock</h2>
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Incoming</th><th>Projected</th><th>Status</th></tr></thead>
          <tbody>{(status || []).map((p: any) => <tr key={p.part_id}><td>{p.name}</td><td>{p.sku}</td><td>{num(p.on_hand)}</td><td>{num(p.incoming_qty)}</td><td>{num(p.projected_qty)}</td><td>{p.stock_status}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="grid two">
        <div className="card wide-table">
          <h2>Weekly usage</h2>
          <table>
            <thead><tr><th>Week</th><th>Part</th><th>SKU</th><th>Used</th></tr></thead>
            <tbody>{(weekly || []).map((r: any, i: number) => <tr key={`${r.part_id}-${r.period_start}-${i}`}><td>{date(r.period_start)}</td><td>{r.name}</td><td>{r.sku}</td><td>{num(r.used_qty)}</td></tr>)}</tbody>
          </table>
        </div>

        <div className="card wide-table">
          <h2>Monthly usage</h2>
          <table>
            <thead><tr><th>Month</th><th>Part</th><th>SKU</th><th>Used</th></tr></thead>
            <tbody>{(monthly || []).map((r: any, i: number) => <tr key={`${r.part_id}-${r.period_start}-${i}`}><td>{date(r.period_start)}</td><td>{r.name}</td><td>{r.sku}</td><td>{num(r.used_qty)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  )
}
