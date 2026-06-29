import { requireUser } from '@/lib/require-user'
import { date, num } from '@/lib/format'

export default async function ImportedOrdersPage({ searchParams }: { searchParams?: Promise<{ platform?: string, status?: string }> }) {
  const params = searchParams ? await searchParams : {}
  const { supabase } = await requireUser()

  let query = supabase.from('imported_order_rows').select('*').order('created_at', { ascending: false }).limit(300)
  if (params.platform) query = query.eq('platform', params.platform)
  if (params.status) query = query.eq('mapping_status', params.status)
  const { data: rows } = await query

  return (
    <>
      <h1>Imported Orders</h1>
      <p className="muted">Raw imported order rows from Etsy, Amazon, TikTok, and Shopify. This is the audit table before orders are mapped to finished products.</p>

      <div className="card">
        <div className="toolbar">
          <a className="button secondary" href="/imported-orders">All</a>
          <a className="button secondary" href="/imported-orders?status=unmapped">Unmapped</a>
          <a className="button secondary" href="/imported-orders?platform=etsy">Etsy</a>
          <a className="button secondary" href="/imported-orders?platform=amazon">Amazon</a>
          <a className="button secondary" href="/imported-orders?platform=tiktok">TikTok</a>
          <a className="button secondary" href="/imported-orders?platform=shopify">Shopify</a>
        </div>
      </div>

      <div className="card wide-table">
        <table>
          <thead>
            <tr>
              <th>Source</th><th>Account</th><th>Order ID</th><th>Date</th><th>SKU</th><th>Qty</th><th>Item</th><th>Variation</th><th>Customization</th><th>Status</th><th>Mapping</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.platform}</td><td>{r.account_name}</td><td>{r.platform_order_id}</td><td>{date(r.order_date)}</td><td>{r.platform_sku}</td><td>{num(r.quantity)}</td><td>{r.item_name}</td><td>{r.variation_text}</td><td>{r.customization_text}</td><td>{r.order_status}</td><td><span className={`badge ${r.mapping_status === 'mapped' ? 'ok' : 'warning'}`}>{r.mapping_status}</span></td>
              </tr>
            ))}
            {(rows || []).length === 0 && <tr><td colSpan={11}>No imported order rows yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
