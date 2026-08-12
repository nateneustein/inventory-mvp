import { redirect } from 'next/navigation'
import { getCurrentRole, homePathFor } from '@/lib/permissions'

/**
 * The front door. The dashboard is a manager's screen now, so where this leads
 * depends on who opened it - otherwise half the team would land on a page they
 * are not allowed to see.
 */
export default async function Home() {
  redirect(homePathFor(await getCurrentRole()))
}
