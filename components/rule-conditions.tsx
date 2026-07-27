'use client'

import { useState } from 'react'

export type RuleCondition = { field: string, type: string, value: string }

const FIELDS: Array<[string, string]> = [
  ['sku', 'SKU'],
  ['item_name', 'Item name'],
  ['variation', 'Variation'],
  ['customization', 'Customization'],
]

const TYPES: Array<[string, string]> = [
  ['contains', 'contains'],
  ['equals', 'equals'],
  ['starts_with', 'starts with'],
]

const BLANK: RuleCondition = { field: 'sku', type: 'contains', value: '' }

/**
 * The condition list on a mapping rule.
 *
 * A rule used to be a single field/type/value triple. It can now hold several,
 * combined one way or the other — ALL of them must match, or ANY one is enough.
 * The two are never mixed inside one rule: if you need "(a and b) or (c and d)"
 * that is two rules, which is what the priority order is for.
 *
 * The whole list is submitted as one JSON hidden input so the server action
 * does not have to reconstruct an array out of indexed form field names.
 */
export function RuleConditions({
  defaultConditions,
  defaultLogic = 'all',
  idPrefix,
}: {
  defaultConditions?: RuleCondition[] | null
  defaultLogic?: string
  idPrefix: string
}) {
  const initial = (defaultConditions || []).filter(c => c && c.field)
  const [rows, setRows] = useState<RuleCondition[]>(initial.length ? initial : [{ ...BLANK }])
  const [logic, setLogic] = useState(defaultLogic === 'any' ? 'any' : 'all')

  function update(i: number, patch: Partial<RuleCondition>) {
    setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }
  function add() {
    setRows([...rows, { ...BLANK }])
  }
  function remove(i: number) {
    setRows(rows.length === 1 ? [{ ...BLANK }] : rows.filter((_, n) => n !== i))
  }

  const joiner = logic === 'any' ? 'OR' : 'AND'

  return (
    <div className="rule-conditions">
      <input type="hidden" name="conditions_json" value={JSON.stringify(rows)} />
      <input type="hidden" name="condition_logic" value={logic} />

      <div className="rule-conditions-head">
        <span className="rule-conditions-title">When the order line matches</span>
        <div className="logic-toggle" role="radiogroup" aria-label="How the conditions combine">
          <label className={logic === 'all' ? 'is-on' : undefined}>
            <input
              type="radio"
              name={`${idPrefix}-logic`}
              checked={logic === 'all'}
              onChange={() => setLogic('all')}
            />
            ALL of these
          </label>
          <label className={logic === 'any' ? 'is-on' : undefined}>
            <input
              type="radio"
              name={`${idPrefix}-logic`}
              checked={logic === 'any'}
              onChange={() => setLogic('any')}
            />
            ANY of these
          </label>
        </div>
      </div>

      {rows.map((row, i) => (
        <div key={i}>
          {i > 0 && <div className="rule-joiner"><span>{joiner}</span></div>}
          <div className="rule-condition-row">
            <select
              aria-label="Field"
              value={row.field}
              onChange={e => update(i, { field: e.target.value })}
            >
              {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select
              aria-label="Match type"
              value={row.type}
              onChange={e => update(i, { type: e.target.value })}
            >
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input
              aria-label="Match value"
              value={row.value}
              placeholder="BB FBA, Pink Holder + Tag, etc."
              onChange={e => update(i, { value: e.target.value })}
            />
            <button
              type="button"
              className="small-btn ghost"
              onClick={() => remove(i)}
              aria-label="Remove this condition"
              title="Remove this condition"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="rule-conditions-foot">
        <button type="button" className="small-btn secondary" onClick={add}>+ Add condition</button>
        <span className="muted small">
          {rows.length === 1
            ? 'One condition. Add another to require a second thing.'
            : logic === 'all'
              ? `All ${rows.length} conditions must match.`
              : `Any one of the ${rows.length} conditions is enough.`}
        </span>
      </div>
    </div>
  )
}

/** Plain-English summary of a rule's conditions, for the rules table. */
export function conditionSummary(conditions: any, logic: string | null | undefined,
  legacy?: { field?: string, type?: string, value?: string }) {
  const list: RuleCondition[] = Array.isArray(conditions) && conditions.length
    ? conditions
    : legacy && legacy.value
      ? [{ field: legacy.field || 'sku', type: legacy.type || 'contains', value: legacy.value }]
      : []
  if (!list.length) return '—'
  const label = (v: string, table: Array<[string, string]>) =>
    (table.find(t => t[0] === v) || [v, v])[1]
  return list
    .map(c => `${label(c.field, FIELDS)} ${label(c.type, TYPES)} “${c.value}”`)
    .join(logic === 'any' ? '  OR  ' : '  AND  ')
}
