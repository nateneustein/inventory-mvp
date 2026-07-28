import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Download a part file.
 *
 * The bucket is private, so this hands back a short-lived signed link rather
 * than a permanent public URL — an image of a supplier spec should not be
 * guessable from the open internet. The link lives for one minute, which is
 * plenty for the browser to follow the redirect.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const { data: file } = await supabase
    .from('part_files')
    .select('storage_path, file_name')
    .eq('id', id)
    .single()

  if (!file) return new NextResponse('File not found', { status: 404 })

  const { data, error } = await supabase.storage
    .from('part-files')
    .createSignedUrl(file.storage_path, 60, { download: file.file_name })

  if (error || !data) return new NextResponse('Could not create a download link', { status: 500 })

  return NextResponse.redirect(data.signedUrl)
}
