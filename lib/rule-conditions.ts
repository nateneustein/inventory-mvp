/**
 * Shared vocabulary for mapping rule conditions.
 *
 * This is a plain module on purpose. The editor is a client component, but the
 * rules table is rendered on the server, and a function exported from a
 * 'use client' file cannot be called during a server render — it arrives as a
 * client reference, not the real function. Anything both sides need lives here.
 */

export type RuleCondition = { field: string, type: string, value: string }

export const CONDITION_FIELDS: Array<[string, string]> = [
  ['sku', 'SKU'],
  ['item_name', 'Item name'],
  ['variation', 'Variation'],
  ['customization', 'Customization'],
  /* Amazon custom listings only: everything the buyer picked from a dropdown,
     read off the order's own customization file, as "Label: choice". Works for
     any custom listing - a new one is matchable the day it goes live. */
  ['custom_options', 'Custom options (Amazon)'],
]

export const CONDITION_TYPES: Array<[string, string]> = [
  ['contains', 'contains'],
  ['equals', 'equals'],
  ['starts_with', 'starts with'],
]

function labelFor(value: string, table: Array<[string, string]>) {
  const hit = table.find(t => t[0] === value)
  return hit ? hit[1] : value
}

/**
 * The conditions a saved rule is made of.
 *
 * Rules written before multi-condition support have an empty `conditions`
 * array, so fall back to the original single match_* columns instead of
 * showing the rule as empty.
 */
export function conditionsOf(rule: any): RuleCondition[] {
  const list = Array.isArray(rule?.conditions) ? rule.conditions : []
  const usable = list.filter((c: any) => c && c.field && String(c.value || '').trim())
  if (usable.length) return usable
  if (String(rule?.match_value || '').trim()) {
    return [{
      field: rule.match_field || 'sku',
      type: rule.match_type || 'contains',
      value: rule.match_value,
    }]
  }
  return []
}

/** Plain-English summary of a rule's conditions, for the rules table. */
export function conditionSummary(rule: any) {
  const list = conditionsOf(rule)
  if (!list.length) return '—'
  return list
    .map(c => `${labelFor(c.field, CONDITION_FIELDS)} ${labelFor(c.type, CONDITION_TYPES)} “${c.value}”`)
    .join(rule?.condition_logic === 'any' ? '  OR  ' : '  AND  ')
}
