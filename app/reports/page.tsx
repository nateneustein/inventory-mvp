import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export default async function ReportsPage() {
  const { supabase } = await requireUser()
  const { data: zeroReports } = await supabase.from('v_zero_stock_reports').select('*').order('created_at', { ascending: false }).limit(100)
  const { data: deadStock } = await supabase.from('dead_stock_candidates').select('*').neq('dead_stock_status', 'active').order('dead_stock_status')
  const { data: overdue } = await supabase.from('overdue_open_po_items').select('*')
  const { data: switches } = await supabase.from('inventory_switches').select('*, to_part:parts!inventory_switches_to_part_id_fkey(name, sku), from_part:parts!inventory_switches_from_part_id_fkey(name, sku)').eq('change_type', 'forced_due_to_stockout').order('created_at', { ascending: false }).limit(100)

  return (
    <>
      <h1>Reports</h1>
      <p className="muted">Reports for actual zero events, dead stock, overdue shipments, and prediction/system failures.</p>

      <div className="grid">
        <div className="card"><div className="muted">Zero reports</div><div className="kpi">{zeroReports?.length || 0}</div></div>
        <div className="card"><div className="muted">Dead stock candidates</div><div className="kpi">{deadStock?.length || 0}</div></div>
        <div className="card"><div className="muted">Overdue shipment items</div><div className="kpi">{overdue?.length || 0}</div></div>
        <div className="card"><div className="muted">Forced switches</div><div className="kpi">{switches?.length || 0}</div></div>
      </div>

      <div className="card">
        <h2>Actual warehouse zero events</h2>
        <table>
          <thead><tr><th>Date</th><th>Part</th><th>Type</th><th>System qty then</th><th>Reported by</th><th>Notes</th></tr></thead>
          <tbody>{(zeroReports || []).map((r: any) => <tr key={r.id}><td>{date(r.created_at)}</td><td>{r.part_sku} · {r.part_name}</td><td>{r.report_type}</td><td>{num(r.system_quantity_at_report)}</td><td className="ap-reporter">{r.reporter_name}</td><td>{r.notes}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card">
        <h2>Dead stock / slow stock</h2>
        <p className="muted small">Parts sitting on more than <strong>365 days of cover</strong> (far more stock than they sell), or not used in a long time. These are candidates to stop reordering or run down.</p>
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Months of cover</th><th>Last used</th><th>Status</th></tr></thead>
          <tbody>{(deadStock || []).map((r: any) => <tr key={r.part_id}><td>{r.name}</td><td>{r.sku}</td><td>{num(r.on_hand)}</td><td>{r.months_of_cover != null ? r.months_of_cover + ' mo' : '—'}</td><td>{date(r.last_used_at)}</td><td>{r.dead_stock_status}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card">
        <h2>Forced switches because we ran out</h2>
        <table>
          <thead><tr><th>Date</th><th>Original demand</th><th>Actual used</th><th>Qty</th><th>Order</th><th>Notes</th></tr></thead>
          <tbody>{(switches || []).map((s: any) => <tr key={s.id}><td>{date(s.created_at)}</td><td>{s.from_part?.sku} · {s.from_part?.name}</td><td>{s.to_part?.sku} · {s.to_part?.name}</td><td>{num(s.quantity)}</td><td>{s.order_reference}</td><td>{s.notes}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  )
}
