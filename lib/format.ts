export function num(value: number | string | null | undefined, digits = 2) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(digits)
}

export function date(value: string | null | undefined) {
  if (!value) return ''
  const text = String(value)
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[2]}/${m[3]}/${m[1]}`
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return text
  return d.toLocaleDateString()
}

/**
 * The second line shown under a supplier in a picker.
 *
 * People remember the person, not the company - "Trevor" rather than
 * "E&T Plastics" - so the contact details travel with the option and the
 * picker searches them alongside the supplier name.
 */
export function supplierHint(s: any) {
  return [s?.contact_name, s?.email, s?.phone].filter(Boolean).join(' · ')
}
