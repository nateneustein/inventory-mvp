import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'manager' | 'shipping_lead' | 'production_associate' | 'none'

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  shipping_lead: 'Shipping Lead',
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
  /* A shipping lead is a production associate in every respect but one: they
     are trusted with who we buy from. Nothing else changes, on purpose. */
  const canSeeSuppliers = isManagerUp || role === 'shipping_lead'

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

    // Shipments. The floor has to see what is on the water, book a new shipment,
    // put its parts on it, and log a tracking number or an update. Rewriting an
    // existing shipment - money, quantities, suppliers, status - is not floor work.
    canViewShipments: signedIn,
    canCreateShipments: signedIn,
    canLogShipmentProgress: signedIn,

    // Who we buy from - names, contacts, phone numbers, prices per supplier.
    // The database refuses this data outright to anyone without it, so this
    // flag only decides whether the page bothers to draw the column.
    canSeeSuppliers,

    // Screens the floor has no use for. Each of these pages also checks this
    // for itself on the server before it renders anything.
    canViewDashboard: isManagerUp,
    canViewReports: isManagerUp,
    canViewUsageHistory: isManagerUp,
    canViewPredictions: isManagerUp,

    // The planning half of a part page - reorder window, prediction, suppliers,
    // files, history. The floor sees stock and shipments and stops there.
    canViewPartPlanning: isManagerUp,

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

/**
 * Where to send someone whose change was refused.
 *
 * The database simply declines a forbidden write, which looks identical to a
 * successful one from the outside. Redirecting here instead means the screen can
 * say so. `what` finishes the sentence "your account is not allowed to ...".
 */
export function deniedUrl(path: string, what: string) {
  const [base, hash] = path.split('#')
  const joined = base + (base.includes('?') ? '&' : '?') + 'denied=' + encodeURIComponent(what)
  return hash ? joined + '#' + hash : joined
}

/** Throw a clear message rather than letting the database reject it cryptically. */
export function assertPermission(allowed: boolean, what: string) {
  if (!allowed) {
    throw new Error(`Your role does not allow you to ${what}. Ask a manager or admin to do this.`)
  }
}
