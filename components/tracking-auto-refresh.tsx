'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { refreshAllShipmentTracking } from '@/lib/shipment-actions'

/**
 * Checks the carriers when the dashboard is opened and the information has
 * gone stale.
 *
 * Deliberately not a scheduled job: a background cron would need its own
 * privileged database key, and this app has one user who looks at the page
 * when he wants to know where things are. Opening the page IS the trigger.
 * It runs after the page has painted, so a slow carrier never delays the view.
 */
export function TrackingAutoRefresh({ staleCount, enabled }: { staleCount: number, enabled: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!enabled || staleCount < 1 || started) return
    setStarted(true)
    startTransition(async () => {
      try {
        await refreshAllShipmentTracking()
      } catch {
        // A carrier being down is not worth breaking the page over. The
        // failure is written against each shipment and shown in its card.
      }
      router.refresh()
    })
  }, [enabled, staleCount, started, router, startTransition])

  if (!enabled || staleCount < 1) return null

  return (
    <p className="muted small">
      {pending
        ? 'Checking ' + staleCount + ' shipment(s) with the carriers…'
        : 'Carrier information refreshed.'}
    </p>
  )
}
