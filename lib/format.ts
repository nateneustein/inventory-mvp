/**
 * The business runs on New York time.
 *
 * Vercel's servers run on UTC, so anything built from toISOString() was a day
 * ahead every evening after 8pm local - date fields pre-filled tomorrow, and
 * a report filed at 9pm displayed as the next day. Everything below pins the
 * zone explicitly rather than trusting the server, so it is right whether it
 * runs on Vercel, in a browser, or on a laptop in another country. Daylight
 * saving is handled by the zone database, so there is no hardcoded offset.
 */
export const ZONE = 'America/New_York'

/** Today in New York, as YYYY-MM-DD. Use instead of new Date().toISOString().slice(0, 10). */
export function today() {
  return isoDate(new Date())
}

/** Any date as YYYY-MM-DD in New York. en-CA is the locale that formats that way. */
export function isoDate(d: Date) {
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: ZONE })
}

/** A timestamp as a short New York date and time - "4 Aug, 8:59 PM". */
export function stamp(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-US', {
    timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function num(value: number | string | null | undefined, digits = 2) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(digits)
}

export function date(value: string | null | undefined) {
  if (!value) return ''
  const text = String(value)
  // A plain date column carries no zone, so it is already the day someone meant.
  // Shifting it would be wrong - only timestamps need converting.
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[2]}/${m[3]}/${m[1]}`
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return text
  return d.toLocaleDateString('en-US', { timeZone: ZONE })
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
