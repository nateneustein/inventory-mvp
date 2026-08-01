'use client'

import { useState } from 'react'

/**
 * A file box that shrinks a photo before it is sent.
 *
 * Phone photos are 3-5 MB and a server action will not accept them, which is
 * how "This page couldn't load" happened: the request died before any of our
 * code ran. Telling someone their photo is too big is useless when it is the
 * only photo they have, so the picture is redrawn at a sensible size in the
 * browser instead. A 4000px camera shot becomes a ~1600px JPEG of a few
 * hundred KB - still far more detail than is needed to check a colour or read
 * a spec sheet.
 *
 * Anything that is not an image, a PDF spec sheet for instance, is passed
 * through untouched.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82

function kb(bytes: number) {
  return Math.round(bytes / 1024) + ' KB'
}

async function shrink(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close(); return null }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) return null

  const base = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], base + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified })
}

export function PhotoInput({ name = 'file', required = false }: { name?: string, required?: boolean }) {
  const [note, setNote] = useState('')

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files && input.files[0]
    if (!file) { setNote(''); return }

    // GIFs would lose their animation, and non-images have nothing to redraw.
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      setNote(kb(file.size))
      return
    }

    setNote('Preparing the photo...')
    try {
      const smaller = await shrink(file)
      if (smaller && smaller.size < file.size) {
        const transfer = new DataTransfer()
        transfer.items.add(smaller)
        input.files = transfer.files
        setNote(kb(file.size) + ' shrunk to ' + kb(smaller.size))
      } else {
        setNote(kb(file.size))
      }
    } catch {
      // Never block the upload over this - the size limit is the backstop.
      setNote(kb(file.size))
    }
  }

  return (
    <>
      <input name={name} type="file" required={required} onChange={onChange} />
      {note && <span className="muted small">{note}</span>}
    </>
  )
}
