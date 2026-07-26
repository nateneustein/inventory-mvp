import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'manager' | 'production_associate' | 'none'

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  production_associate: 'Production Associate',
  none: 'No access',
}

/**
 * Who is signed in and what may they do.
 *
 * These flags decide what the screen shows. They are NOT the security boundary
 * -- the database enforces the same rules with row-level security, so hiding a
 * button is only there to keep the interface honest, not to keep anyone out.
 */
export async function getCurrentRole(): Promise<Role> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'none'
  const { data } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .maybeSingle()
  if (!data || !data.active) return 'none'
  return (data.role as Role) || 'none'
}

export function permissionsFor(role: Role) {
  const isAdmin = role === 'admin'
  const isManagerUp = role === 'admin' || role === 'manager'
  const signedIn = role !== 'none'

  return {
    role,
    label: ROLE_LABELS[role] || role,
    isAdmin,
    isManagerUp,

    // Floor work — anyone signed in.
    canReceiveShipments: signedIn,
    canReportDamage: signedIn,
    canReportZero: signedIn,

    // Stock-moving work that is not floor work.
    canRecordCycleCount: isManagerUp,
    canRecordManualUsage: isManagerUp,
    canRecordSwitch: isManagerUp,
    canAdjustStock: isManagerUp,

    // Master data and purchasing.
    canManageMasterData: isManagerUp,
    canManagePurchasing: isManagerUp,
    canUploadOrders: isManagerUp,

    // Removing things that already moved stock.
    canDeleteRecords: isManagerUp,

    // Admin only.
    canManageUsers: isAdmin,
    canManageIntegrations: isAdmin,
  }
}

export type Permissions = ReturnType<typeof permissionsFor>

export async function getPermissions(): Promise<Permissions> {
  return permissionsFor(await getCurrentRole())
}

/** Throw a clear message rather than letting the database reject it cryptically. */
export function assertPermission(allowed: boolean, what: string) {
  if (!allowed) {
    throw new Error(`Your role does not allow you to ${what}. Ask a manager or admin to do this.`)
  }
}
