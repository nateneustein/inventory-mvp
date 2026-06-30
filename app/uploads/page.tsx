import Link from 'next/link'
import { requireUser } from '@/lib/require-user'
import { importOrderCsv, deleteUploadBatch } from '@/lib/actions'
import { date } from '@/lib/format'

export default async function UploadsPage() {
  const { supabase } = await requireUser()
  const { data: batches } = await supabase.from('upload_batches').select('*').order('created_at', { ascending: false }).limit(50)
  const { data: summary } = await supabase.from('imported_order_summary').select('*').order('platform')

  return (
    <>
      <div className="page-head"><div><h1>Uploads / Connections</h1><p className="muted">CSV uploads now. Direct platform connections can be added later without changing the rest of the system.</p></div><Link className="button secondary" href="/imported-orders">Imported rows</Link></div>

      <div className="card highlight">
        <h2>Upload order spreadsheet</h2>
        <form className="stack" action={importOrderCsv} encType="multipart/form-data">
          <div className="form-row"><label>Source platform<select name="platform" required><option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok Shop</option><option value="shopify">Shopify</option></select></label><label>Shop/account name<input name="account_name" placeholder="Blueview Gifts, Etsy Shop 2, Amazon, etc." /></label><label>CSV file<input name="file" type="file" accept=".csv,text/csv" required /></label></div>
          <button type="submit">Import CSV</button>
        </form>
      </div>

      <div className="grid">
        {(summary || []).map((row: any) => <Link className="card kpi-card" href={`/imported-orders?platform=${row.platform}`} key={`${row.platform}-${row.account_name}`}><div className="muted">{row.platform} · {row.account_name}</div><div className="kpi">{row.imported_rows}</div><p><span className={`badge ${row.unmapped_rows > 0 ? 'warning' : 'ok'}`}>{row.unmapped_rows} unmapped</span> <span className="badge ignored">{row.duplicate_rows || 0} duplicates</span></p><p className="muted small">Last import: {date(row.last_imported_at)}</p></Link>)}
        {(summary || []).length === 0 && <div className="card"><div className="empty-state">No uploads yet.</div></div>}
      </div>

      <div className="card table-card"><div className="table-head"><h2>Recent uploads</h2></div><div className="wide-table"><table><thead><tr><th>Date</th><th>Platform</th><th>Account</th><th>File</th><th>Rows</th><th>Status</th><th>Actions</th></tr></thead><tbody>{(batches || []).map((b:any)=><tr key={b.id}><td>{date(b.created_at)}</td><td>{b.platform}</td><td>{b.account_name}</td><td><Link className="link" href={`/uploads/${b.id}`}>{b.file_name}</Link></td><td>{b.row_count}</td><td><span className="badge info">{b.status}</span></td><td><div className="action-row"><Link className="button small-btn secondary" href={`/uploads/${b.id}`}>Open</Link><form action={deleteUploadBatch}><input type="hidden" name="id" value={b.id}/><button className="small-btn danger" type="submit">Delete upload</button></form></div></td></tr>)}{(batches || []).length === 0 && <tr><td colSpan={7}><div className="empty-state">No uploaded files yet.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}
