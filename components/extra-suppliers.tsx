'use client'

import { useEffect, useRef, useState } from 'react'
import { SearchSelect, type PickerOption } from '@/components/search-select'

/**
 * Extra suppliers on a shipment being created.
 *
 * A container packed at several factories is still one shipment, so the main
 * supplier sits on the order and the others are added here. Each line is its
 * own picker rather than a multi-select, because the list is usually two or
 * three and a plain row is easier to read back than a bag of chips.
 *
 * Lines are added on purpose and can be left blank without breaking anything -
 * the server drops empties, duplicates, and anything matching the main supplier.
 */
export function ExtraSuppliers({ options }: { options: PickerOption[] }) {
  const [lines, setLines] = useState<number[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  /* After the shipment saves the form resets, so the extra rows have to go too,
     otherwise the next shipment starts with someone else's suppliers on it. */
  useEffect(() => {
    const form = rootRef.current?.closest('form')
    if (!form) return
    const onReset = () => setLines([])
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [])

  return (
    <div className="stack" ref={rootRef}>
      {lines.map((key) => (
        <div key={key} className="supplier-line">
          <label>
            Also shipping from
            <SearchSelect
              name="extra_supplier_id"
              placeholder="Type a supplier or contact name"
              options={options}
            />
          </label>
          <button
            type="button"
            className="button secondary small-btn"
            onClick={() => setLines((current) => current.filter((entry) => entry !== key))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="action-row">
        <button
          type="button"
          className="button secondary small-btn"
          onClick={() => setLines((current) => current.concat(current.length > 0 ? Math.max.apply(null, current) + 1 : 0))}
        >
          + Add another supplier
        </button>
      </div>
    </div>
  )
}
