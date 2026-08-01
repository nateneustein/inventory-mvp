import type { NextConfig } from 'next'

/**
 * Photos taken on a phone are routinely 3-5 MB, and a server action refuses
 * anything over 1 MB by default. That is why uploading a part photo died with
 * "This page couldn't load" instead of any useful message - the request never
 * reached our code.
 *
 * 4 MB is the number worth setting: Vercel's own request ceiling is 4.5 MB, so
 * anything larger here would only move the failure one layer down. The photo
 * box also shrinks big images in the browser before sending, so this is the
 * safety net rather than the thing doing the work.
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
}

export default nextConfig
