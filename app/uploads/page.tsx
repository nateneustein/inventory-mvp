import { requireUser } from '@/lib/require-user'
import { importOrderCsv } from '@/lib/actions'
import { date } from '@/lib/format'

export default async function UploadsPage() {
  const { supabase } = await requireUser()
  const { data: batches } = await supabase
    .from('upload_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)
  const { data: summary } = await supabase.from('imported_order_summary').select('*').order('platform')

  return (
    <>
      <h1>Uploads / Connections</h1>
      <p className="muted">First version uses marketplace CSV uploads. Later the same page can add Etsy, Veeqo, Shopify, Amazon, and TikTok API connections.</p>

      <div className="card">
        <h2>Upload order spreadsheet</h2>
        <form className="stack" action={importOrderCsv} encType="multipart/form-data">
          <div className="form-row">
            <label>Source platform
              <select name="platform" required>
                <option value="etsy">Etsy</option>
                <option value="amazon">Amazon</option>
                <option value="tiktok">TikTok Shop</option>
                <option value="shopify">Shopify</option>
              </select>
            </label>
            <label>Shop/account name<input name="account_name" placeholder="Blueview Gifts, Etsy Shop 2, Amazon, etc." /></label>
            <label>CSV file<input name="file" type="file" accept=".csv,text/csv" required /></label>
          </div>
          <button type="submit">Import CSV</button>
        </form>
      </div>

      <div className="grid">
        {(summary || []).map((row: any) => (
          <div className="card" key={`${row.platform}-${row.account_name}`}>
            <h2>{row.platform} · {row.account_name}</h2>
            <p><b>{row.imported_rows}</b> imported rows</p>
            <p><b>{row.unmapped_rows}</b> unmapped rows</p>
            <p className="muted">Last import: {date(row.last_imported_at)}</p>
          </div>
        ))}
        {(summary || []).length === 0 && <div className="card"><p>No uploads yet.</p></div>}
      </div>

      <div className="card">
        <h2>Recent uploads</h2>
        <table>
          <thead><tr><th>Date</th><th>Platform</th><th>Account</th><th>File</th><th>Rows</th><th>Status</th></tr></thead>
          <tbody>
            {(batches || []).map((b: any) => (
              <tr key={b.id}>
                <td>{date(b.created_at)}</td><td>{b.platform}</td><td>{b.account_name}</td><td>{b.file_name}</td><td>{b.row_count}</td><td>{b.status}</td>
              </tr>
            ))}
            {(batches || []).length === 0 && <tr><td colSpan={6}>No uploaded files yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
