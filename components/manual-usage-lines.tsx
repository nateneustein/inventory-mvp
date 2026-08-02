'use client'

import { useState } from 'react'
import { SearchSelect } from '@/components/search-select'

type Option = { value: string, label: string }

/**
 * The product lines inside one manual produced/sold entry.
 *
 * A bulk order is often more than one finished product - half Navy Holder,
 * half Tan Holder - and typing that as two separate entries loses the fact
 * that it was a single order, with one date, one reference and one note.
 *
 * The plus button adds another line. Every line repeats the same two field
 * names, so the server reads them back as two parallel lists and books each
 * product against its own BOM.
 */
export function ManualUsageLines({ options }: { options: Option[] }) {
  const [lines, setLines] = useState([0])
  const [nextKey, setNextKey] = useState(1)

  return (
    <div className="usage-lines">
      {lines.map((key, index) => (
        <div className="form-row usage-line" key={key}>
          <label>
            {index === 0 ? 'Finished product / variation' : 'Also on this entry'}
            <SearchSelect
              name="variation_id"
              placeholder="Type a product or variation"
              options={options}
              required={index === 0}
            />
          </label>
          <label>
            Quantity produced/sold
            <input name="quantity" type="number" step="0.01" required={index === 0} />
          </label>
          <div className="usage-line-actions">
            {lines.length > 1 && (
              <button
                type="button"
                className="button small-btn secondary"
                onClick={() => setLines(lines.filter((k) => k !== key))}
              >
                Remove line
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="action-row">
        <button
          type="button"
          className="button small-btn secondary"
          onClick={() => { setLines([...lines, nextKey]); setNextKey(nextKey + 1) }}
        >
          + Add another product to this entry
        </button>
      </div>
    </div>
  )
}
