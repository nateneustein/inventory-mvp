/**
 * Carrier tracking, through 17TRACK.
 *
 * Chosen because the hard case here is Chinese couriers - Yanwen, YunExpress,
 * 4PX, China Post and the long tail of forwarders - which most Western
 * tracking services either miss entirely or resolve to the wrong carrier.
 * 17TRACK covers 3,400+ carriers including all of those plus the usual
 * UPS / FedEx / DHL / USPS, from one account.
 *
 * Everything here degrades quietly when TRACK17_API_KEY is not set: the app
 * still records updates typed in by hand and still shows the timeline, it just
 * never calls out. That matters because the manual updates are the ONLY
 * information available while a container is at sea.
 */

const BASE = 'https://api.17track.net/track/v2.2'

/** 17TRACK's code for "this number is already registered", which is a success. */
const ALREADY_REGISTERED = -18019901

export type ShipmentEvent = {
  key: string
  at: string | null
  status: string | null
  location: string | null
  description: string | null
}

export function trackingEnabled() {
  return Boolean(process.env.TRACK17_API_KEY)
}

async function call(path: string, body: any) {
  const key = process.env.TRACK17_API_KEY
  if (!key) throw new Error('Carrier tracking is not switched on yet. Add TRACK17_API_KEY in the Vercel project settings.')

  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { '17token': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }

  if (!res.ok) {
    throw new Error('The tracking service replied ' + res.status + (json?.data?.errors?.[0]?.message ? ' - ' + json.data.errors[0].message : ''))
  }
  if (!json) throw new Error('The tracking service sent back something unreadable.')
  return json
}

export async function registerNumbers(numbers: string[]) {
  if (!numbers.length) return { accepted: [], rejected: [] }
  const json = await call('/register', numbers.map((number) => ({ number })))
  return json?.data || { accepted: [], rejected: [] }
}

export async function getTrackInfo(numbers: string[]) {
  if (!numbers.length) return { accepted: [], rejected: [] }
  const json = await call('/gettrackinfo', numbers.map((number) => ({ number })))
  return json?.data || { accepted: [], rejected: [] }
}

export function isAlreadyRegistered(rejected: any) {
  return rejected?.error?.code === ALREADY_REGISTERED
}

function textOf(v: any) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed || null
}

function locationOf(event: any) {
  if (!event) return null
  const direct = textOf(event.location)
  if (direct) return direct
  const address = event.address || {}
  const joined = [address.city, address.state, address.country, address.postal_code].filter(Boolean).join(', ')
  return joined || null
}

/**
 * Flatten 17TRACK's per-provider event lists into one timeline.
 *
 * A forwarded parcel is reported by two or three carriers at once - the
 * Chinese first mile, then the local courier - and each keeps its own list.
 * Reading them as one stream is what makes the page tell a single story.
 */
export function readEvents(trackInfo: any): ShipmentEvent[] {
  const providers = trackInfo?.tracking?.providers || []
  const out: ShipmentEvent[] = []

  for (const provider of providers) {
    const name = provider?.provider?.name || provider?.provider?.key || ''
    for (const event of provider?.events || []) {
      const at = textOf(event.time_iso) || textOf(event.time_utc)
      const description = textOf(event.description) || textOf(event.stage)
      if (!at && !description) continue
      out.push({
        // Carriers do not hand out event ids, so this is what makes checking
        // the same number twice idempotent rather than duplicating history.
        key: [name, at || '', description || ''].join('|').slice(0, 300),
        at,
        status: textOf(event.stage),
        location: locationOf(event),
        description,
      })
    }
  }

  return out
}

export function readSummary(trackInfo: any) {
  const latest = trackInfo?.latest_event || null
  const provider = trackInfo?.tracking?.providers?.[0]?.provider || null
  const window = trackInfo?.time_metrics?.estimated_delivery_date || null
  // The service gives a range. The far end is the one worth planning against.
  const eta = textOf(window?.to) || textOf(window?.from)

  return {
    status: textOf(trackInfo?.latest_status?.status),
    subStatus: textOf(trackInfo?.latest_status?.sub_status),
    lastEvent: textOf(latest?.description),
    lastEventAt: textOf(latest?.time_iso) || textOf(latest?.time_utc),
    lastLocation: locationOf(latest),
    carrierName: textOf(provider?.name),
    carrierCode: provider?.key == null ? null : String(provider.key),
    eta: eta ? eta.slice(0, 10) : null,
  }
}
