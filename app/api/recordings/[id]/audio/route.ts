import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { id } = await params
  const rows = await query(
    'SELECT recording_data, mime_type FROM call_recordings WHERE id = $1',
    [id]
  )

  if (!rows[0] || !rows[0].recording_data) {
    return new NextResponse('Not found', { status: 404 })
  }

  const { recording_data, mime_type } = rows[0]
  const buffer = Buffer.isBuffer(recording_data) ? recording_data : Buffer.from(recording_data)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mime_type || 'audio/webm',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
    },
  })
}
