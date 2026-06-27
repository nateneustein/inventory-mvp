export function num(value: number | string | null | undefined, digits = 2) {
  const n = Number(value ?? 0)
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(digits)
}

export function date(value: string | null | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleDateString()
}
