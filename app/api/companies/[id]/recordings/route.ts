import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const rows = await query(
    `SELECT id, caller_name, duration_seconds, mime_type, called_at
     FROM call_recordings
     WHERE company_id = $1 AND recording_data IS NOT NULL
     ORDER BY called_at DESC`,
    [id]
  )

  return NextResponse.json(rows)
}
