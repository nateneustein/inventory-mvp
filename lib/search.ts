/**
 * Shared row filter for the "search this list" boxes.
 *
 * Every word you type has to appear somewhere in the row, in any order, so
 * "black 2 slot" finds "Black 2-Slot Watch Case" and "damaged black" finds a
 * black part with a damage reason. Matching is case-insensitive and ignores
 * punctuation, because SKUs are full of dashes nobody wants to type.
 */
export function rowMatches(query: string | undefined, ...fields: any[]) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const soften = (s: string) => s.replace(/[^a-z0-9]+/g, ' ')
  const hay = soften(fields.filter(v => v !== null && v !== undefined).join(' ').toLowerCase())
  return soften(q).split(/\s+/).filter(Boolean).every(term => hay.includes(term))
}
