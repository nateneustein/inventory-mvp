import { date } from '@/lib/format'

/**
 * The one thing on a report nobody is allowed to miss: something is already on
 * its way, so it must not be ordered again.
 *
 * Loud on purpose. Blue is not used for any other status in this app - red and
 * amber mean go and do something - so a blue line can only mean this, and it
 * reads before anyone gets as far as the words.
 */
export function ShipmentComing({
  poNumber,
  orderDate,
  expectedDate,
}: {
  poNumber?: string | null
  orderDate?: string | null
  expectedDate?: string | null
}) {
  const detail = [
    poNumber || 'A shipment',
    orderDate ? 'placed ' + date(orderDate) : '',
    expectedDate ? 'due ' + date(expectedDate) : '',
  ].filter(Boolean).join(' · ')

  return (
    <span className="ship-flag">
      <span className="ship-pill">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 3h13v13H1z" />
          <path d="M14 8h4l3 3v5h-7z" />
          <circle cx="5.5" cy="18.5" r="2" />
          <circle cx="17.5" cy="18.5" r="2" />
        </svg>
        SHIPMENT ON THE WAY ---- DONT NEED TO ORDER
      </span>
      <span className="ship-when">{detail}</span>
    </span>
  )
}
