import { redirect } from 'next/navigation'
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
    /* Marking a tracked alarm as reviewed is a judgement call about whether the
       forecast really failed, so it belongs to whoever plans the ordering. The
       floor files reports; it does not close them. The database enforces the
       same rule independently, so hiding the button is only honesty. */
    canReviewStockReports: isManagerUp,

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

    // A shipping lead runs the logistics of a shipment already booked: where it
    // is, when it is due, who is carrying it, its tracking number and notes.
    // What was bought, from whom and for how much stays with purchasing, and
    // the database pins those columns for anyone under manager.
    canEditShipmentLogistics: isManagerUp || role === 'shipping_lead',

    /* Putting a free-typed name on a shipment - something being sent that is
       not in the parts list at all. A typed name is a small piece of master
       data: it shows up on the shipment forever and nobody can count it, so it
       belongs to the people who own shipments rather than to everyone who can
       add a normal line. The database enforces the same three roles. */
    canAddUnlistedShipmentItem: isManagerUp || role === 'shipping_lead',

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

/**
 * Where a person lands when they open the app.
 *
 * The dashboard is a manager's screen now, so sending everyone there would drop
 * half the team on a locked door. One place decides this, so sign-in, the logo
 * in the corner and the front door all agree.
 */
export function homePathFor(role: Role) {
  return role === 'admin' || role === 'manager' ? '/dashboard' : '/parts'
}

export async function getPermissions(): Promise<Permissions> {
  return permissionsFor(await getCurrentRole())
}

/**
 * A page a role may not open at all.
 *
 * The middleware already turns these requests away at the door, but it is
 * written to fail open on purpose, so that a database hiccup cannot lock the
 * whole team out of the app. This runs inside the page itself, on the server,
 * every single time it renders. So the page is genuinely closed - not hidden.
 */
export async function requirePageAccess(flag: keyof Permissions, path: string) {
  const perms = await getPermissions()
  if (!perms[flag]) {
    redirect('/no-access?from=' + encodeURIComponent(path) + '&role=' + encodeURIComponent(perms.role))
  }
  return perms
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
