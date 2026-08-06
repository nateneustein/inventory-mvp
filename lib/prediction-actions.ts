// @ts-nocheck
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/require-user'

/**
 * Saves the Advanced Prediction dials for one group (category). The page
 * resolves every dial as: built-in default < the group's saved settings <
 * whatever was typed into the dial form for this run - so saving makes the
 * currently applied dials the group's new baseline for everyone.
 */
export async function saveAdvancedPredictionSettings(formData) {
  const { supabase, user } = await requireUser()

  const category = String(formData.get('category') || '')
  const partId = String(formData.get('part') || '')
  if (!category) redirect('/predictions/advanced')

  const keys = ['base', 'pool', 'tmin', 'tth', 'tlook', 'thoriz', 'tclip', 'sth', 'npmin', 'npbump', 'flagx']
  const settings = {}
  for (const k of keys) {
    const n = Number(formData.get(k))
    if (Number.isFinite(n) && n > 0) settings[k] = n
  }
  settings.wait = formData.get('wait') === '1' ? 1 : 0

  await supabase.from('advanced_prediction_settings').upsert({
    category,
    settings,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  })

  revalidatePath('/predictions/advanced')
  redirect('/predictions/advanced?part=' + encodeURIComponent(partId))
}
