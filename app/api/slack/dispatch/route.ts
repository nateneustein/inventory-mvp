import { NextResponse, type NextRequest } from 'next/server'
import { renderSlack } from '@/lib/slack-messages'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Sends whatever is due in the Slack queue.
 *
 * Called once a minute by a scheduler inside Supabase, which passes a shared
 * secret in a header. This route never checks that secret itself - it hands it
 * straight to the database, and the database functions refuse to return
 * anything without it. That means the secret only ever exists in one place
 * (the settings table), so there is nothing extra to configure here and
 * nothing to leak if this URL is ever guessed.
 *
 * The Slack token is the one exception: it lives in Vercel's environment and
 * never touches the database.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function rpc(name: string, body: Record<string, unknown>) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(name + ' failed: ' + res.status + ' ' + raw.slice(0, 300))
  // A function returning void answers with a completely empty body, which is
  // not valid JSON. Parsing it blindly used to throw straight after a message
  // had already gone out - the send was fine, the bookkeeping call was what
  // blew up, and the whole request came back a 500 for no real reason.
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function handle(request: NextRequest) {
  const secret =
    request.headers.get('x-slack-cron-secret') ||
    new URL(request.url).searchParams.get('secret') ||
    ''
  const token = process.env.SLACK_BOT_TOKEN

  if (!secret) return NextResponse.json({ ok: false, error: 'no secret' }, { status: 401 })
  if (!token) return NextResponse.json({ ok: false, error: 'SLACK_BOT_TOKEN is not set' }, { status: 500 })

  // A wrong secret comes back as an empty list rather than an error, so a
  // probe of this URL looks exactly like a quiet minute with nothing to send.
  const due = (await rpc('slack_claim_due', { p_secret: secret })) as any[]
  if (!Array.isArray(due) || due.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://' + (request.headers.get('host') || 'inventory-mvp-six.vercel.app')

  let sent = 0
  const failures: string[] = []

  for (const row of due) {
    try {
      const message = renderSlack(row.kind, row.payload, row.mention_user_id, appUrl)
      if (!message) {
        await rpc('slack_mark_sent', { p_secret: secret, p_id: row.id, p_ok: false, p_error: 'no renderer for kind ' + row.kind })
        failures.push(row.kind)
        continue
      }

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          channel: row.channel_id,
          text: message.text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      })
      const body = await res.json()

      if (body.ok) {
        await rpc('slack_mark_sent', { p_secret: secret, p_id: row.id, p_ok: true, p_ts: body.ts || null })
        sent += 1
      } else {
        // Slack's own words are far more useful than anything we could invent -
        // "not_in_channel" and "channel_not_found" are the two that actually
        // happen, and both are fixed by inviting the app to the channel.
        await rpc('slack_mark_sent', { p_secret: secret, p_id: row.id, p_ok: false, p_error: String(body.error || 'unknown') })
        failures.push(row.kind + ': ' + body.error)
      }
    } catch (err: any) {
      await rpc('slack_mark_sent', { p_secret: secret, p_id: row.id, p_ok: false, p_error: String(err?.message || err).slice(0, 400) })
      failures.push(row.kind + ': ' + String(err?.message || err))
    }
  }

  return NextResponse.json({ ok: true, claimed: due.length, sent, failures })
}

export async function POST(request: NextRequest) { return handle(request) }
export async function GET(request: NextRequest) { return handle(request) }
