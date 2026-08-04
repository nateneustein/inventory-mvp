import type { ReactNode } from 'react'
import { date } from '@/lib/format'

/**
 * The four things a report can be, each with its own colour and its own icon.
 *
 * The colour carries the meaning before anyone reads a word, so each one is used
 * for exactly one thing and never for decoration:
 *
 *   red    - an alarm. A tracked part got low or hit zero, which means the
 *            forecast should have ordered it already and did not. Fix it now.
 *   blue   - a shipment is already on its way. Hands off, do not order again.
 *   amber  - a normal job. An untracked part that nobody counts needs ordering;
 *            nothing has gone wrong, it just has to be bought.
 *   green  - done. Somebody has placed the order.
 *
 * All four are the same shape - solid badge carrying the instruction, quiet
 * second line saying which shipment or when - so they read as one system.
 */

type FlagProps = { label: string, detail?: string }

function Truck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3h13v13H1z" />
      <path d="M14 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="18.5" r="2" />
    </svg>
  )
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function Warning() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function Cart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="19" cy="20" r="1.5" />
      <path d="M1 2h3.4l2.3 11.4a2 2 0 0 0 2 1.6h9.2a2 2 0 0 0 2-1.6L22 6H5.6" />
    </svg>
  )
}

function Flag({ tone, icon, label, detail }: { tone: string, icon: ReactNode } & FlagProps) {
  return (
    <span className="ship-flag">
      <span className={'ship-pill ' + tone}>
        {icon}
        {label}
      </span>
      {detail ? <span className={'ship-when ' + tone}>{detail}</span> : null}
    </span>
  )
}

/** Blue. Already on the water - ordering it again would double the stock. */
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
    expectedDate ? 'expected by ' + date(expectedDate) : '',
  ].filter(Boolean).join(' · ')

  return <Flag tone="coming" icon={<Truck />} label={"SHIPMENT ON THE WAY ---- DON'T NEED TO ORDER"} detail={detail} />
}

function Box() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z" />
      <path d="M3 8.5 12 13l9-4.5" />
      <path d="M12 13v7" />
    </svg>
  )
}

/**
 * Blue as well, because it means the same thing to the person deciding: the
 * stock exists, do not buy it twice. What differs is where it is - this one has
 * landed, or should have, and is sitting somewhere nobody has counted it in.
 * The job is to go and find it, not to order.
 */
export function ShipmentWaiting({
  poNumber,
  expectedDate,
  quantity,
  daysLate,
  carrierDelivered,
}: {
  poNumber?: string | null
  expectedDate?: string | null
  quantity?: number | string | null
  daysLate?: number | null
  carrierDelivered?: boolean | null
}) {
  const late = Number(daysLate || 0)
  const detail = [
    poNumber || 'A shipment',
    quantity ? quantity + ' still to be booked in' : '',
    expectedDate ? 'expected by ' + date(expectedDate) : '',
    late > 0 ? late + (late === 1 ? ' day late' : ' days late') : '',
  ].filter(Boolean).join(' · ')

  const label = carrierDelivered
    ? 'SHIPMENT DELIVERED BUT NOT RECEIVED ---- DONT NEED TO REORDER'
    : 'SHIPMENT PAST ITS DATE, NOT RECEIVED ---- DONT NEED TO REORDER'

  return <Flag tone="coming" icon={<Box />} label={label} detail={detail} />
}

/** Green. Somebody has placed the order, so the job is finished. */
export function AlreadyOrdered({ when, note }: { when?: string | null, note?: string | null }) {
  const detail = [when ? 'Marked as ordered on ' + date(when) : '', note || ''].filter(Boolean).join(' · ')
  return <Flag tone="ordered" icon={<Tick />} label="ORDERED" detail={detail} />
}

/** Amber. A normal buying job on a part nobody counts - not a failure. */
export function NeedsOrdering() {
  return <Flag tone="todo" icon={<Cart />} label="NEEDS ORDERING" detail="Nothing on the way for this one yet." />
}

/** Red. A tracked part should never get here - the forecast missed it. */
export function Alarm({ atZero, poNumber, expectedDate }: {
  atZero?: boolean
  poNumber?: string | null
  expectedDate?: string | null
}) {
  const detail = poNumber
    ? poNumber + (expectedDate ? ' · expected by ' + date(expectedDate) : '') + ' - ordered too late'
    : atZero
      ? 'Nothing on the way. This should have been ordered before it ran out.'
      : 'Nothing on the way. The forecast should have caught this.'

  return <Flag tone="alarm" icon={<Warning />} label={atZero ? 'ALARM ---- OUT OF STOCK' : 'ALARM ---- ORDER NOW'} detail={detail} />
}
