import Link from 'next/link'
import { requireUser } from '@/lib/require-user'

export default async function ScannerPage() {
  const { supabase } = await requireUser()
  const { data: parts } = await supabase.from('inventory_status').select('*').order('name')

  return (
    <>
      <h1>Scanner / QR Part Cards</h1>
      <p className="muted">Each part has its own URL. Print QR codes pointing to those URLs so warehouse employees can scan a bin/card and report zero, damage, low stock, or open supplier info.</p>

      <div className="card wide-table">
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>Part page URL</th><th>Actions</th></tr></thead>
          <tbody>
            {(parts || []).map((p: any) => (
              <tr key={p.part_id}>
                <td>{p.name}</td><td>{p.sku}</td><td><code>/parts/{p.part_id}</code></td><td><Link className="button secondary" href={`/parts/${p.part_id}`}>Open card page</Link></td>
              </tr>
            ))}
            {(parts || []).length === 0 && <tr><td colSpan={4}>Add parts first.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
