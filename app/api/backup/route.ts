import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The weekly off-site backup: a read-only door.
 *
 * This route holds no power of its own. It takes the token out of the request
 * header, hands it straight to the database, and returns whatever the database
 * decides to give back. The token itself lives in one place only - a table with
 * row-level security and no policies, which nothing reached through the API can
 * read - so there is nothing here to steal and nothing extra to configure in
 * Vercel. Same arrangement the Slack dispatcher already uses.
 *
 * Every database function behind this can only SELECT. There is no path from
 * here to a write or a delete, which is the whole point: the worst a stolen
 * token can do is let somebody read data, never change or destroy it.
 *
 * The token travels in a header rather than the address, so it never lands in
 * Vercel's request logs, a browser history, or a referrer.
 *
 * Photos and documents are not served from here at all. Those live in file
 * storage rather than in the database, so this only hands over the list of what
 * exists - names, sizes and dates - and the weekly job uses that to work out
 * which ones are new.
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
  if (!res.ok) throw new Error(name + ' failed: ' + res.status + ' ' + raw.slice(0, 200))
  return raw ? JSON.parse(raw) : null
}

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-backup-token') || ''
  const what = request.nextUrl.searchParams.get('what') || 'manifest'

  try {
    let result: any

    if (what === 'manifest') {
      result = await rpc('backup_manifest', { p_secret: token })
    } else if (what === 'files') {
      result = await rpc('backup_file_manifest', { p_secret: token })
    } else if (what === 'rows') {
      const name = request.nextUrl.searchParams.get('table') || ''
      const offset = Number(request.nextUrl.searchParams.get('offset') || 0)
      const limit = Number(request.nextUrl.searchParams.get('limit') || 5000)
      result = await rpc('backup_rows', {
        p_secret: token,
        p_table: name,
        p_offset: Number.isFinite(offset) ? offset : 0,
        p_limit: Number.isFinite(limit) ? limit : 5000,
      })
    } else {
      return NextResponse.json({ error: 'unknown request' }, { status: 400 })
    }

    /* A refusal answers 403 rather than 200-with-an-error, so a misconfigured
       backup fails loudly in the script instead of quietly writing a file that
       says "not allowed" and looking like it worked. */
    if (result && result.error) {
      return NextResponse.json(result, { status: 403 })
    }

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}
