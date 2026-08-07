// @ts-nocheck
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/require-user'

async function loadSettings(supabase, category) {
  const { data } = await supabase.from('advanced_prediction_settings')
    .select('settings').eq('category', category).maybeSingle()
  return data && data.settings && typeof data.settings === 'object' ? { ...data.settings } : {}
}

async function storeSettings(supabase, category, settings, userId) {
  await supabase.from('advanced_prediction_settings').upsert({
    category,
    settings,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  })
}

/**
 * Saves the Advanced Prediction dials for one group (category). The page
 * resolves every dial as: built-in default < the group's saved settings <
 * whatever was typed into the dial form for this run - so saving makes the
 * currently applied dials the group's new baseline for everyone. Existing
 * keys not in this form (e.g. season decisions) are preserved.
 */
export async function saveAdvancedPredictionSettings(formData) {
  const { supabase, user } = await requireUser()

  const category = String(formData.get('category') || '')
  const partId = String(formData.get('part') || '')
  if (!category) redirect('/predictions/advanced')

  const settings = await loadSettings(supabase, category)
  const keys = ['base', 'pool', 'tmin', 'tth', 'tlook', 'thoriz', 'tclip', 'sth', 'npmin', 'npbump', 'flagx', 'mfloor']
  for (const k of keys) {
    const n = Number(formData.get(k))
    if (Number.isFinite(n) && n > 0) settings[k] = n
  }
  settings.wait = formData.get('wait') === '1' ? 1 : 0
  for (const mk of ['sx', 'tx', 'rx']) {
    const raw = formData.get(mk)
    if (raw !== null) {
      settings[mk] = String(raw).split(',').map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12)
    }
  }

  await storeSettings(supabase, category, settings, user.id)
  revalidatePath('/predictions/advanced')
  redirect('/predictions/advanced?part=' + encodeURIComponent(partId))
}

/**
 * Approve or dismiss one seasonal-month suggestion for a group. Approved
 * months get their measured factor applied; dismissed ones stop suggesting.
 * 'clear' removes the decision so the month suggests again.
 */
export async function saveSeasonDecision(formData) {
  const { supabase, user } = await requireUser()

  const category = String(formData.get('category') || '')
  const partId = String(formData.get('part') || '')
  const month = Number(formData.get('month'))
  const decision = String(formData.get('decision') || '')
  if (!category || !Number.isFinite(month) || month < 1 || month > 12) redirect('/predictions/advanced')

  const settings = await loadSettings(supabase, category)
  const seasons = settings.seasons && typeof settings.seasons === 'object' ? { ...settings.seasons } : {}
  if (decision === 'approved' || decision === 'dismissed') seasons[String(month)] = decision
  else delete seasons[String(month)]
  settings.seasons = seasons

  await storeSettings(supabase, category, settings, user.id)
  revalidatePath('/predictions/advanced')
  redirect('/predictions/advanced?part=' + encodeURIComponent(partId))
}
