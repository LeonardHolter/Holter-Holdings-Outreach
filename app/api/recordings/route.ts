import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData()
  const audio = form.get('audio') as Blob | null
  const companyId = form.get('company_id') as string | null
  const callerName = form.get('caller_name') as string | null
  const companyNameSnapshot = form.get('company_name') as string | null
  const durationSeconds = form.get('duration_seconds') ? Number(form.get('duration_seconds')) : null
  const mimeType = form.get('mime_type') as string | null

  if (!audio) return NextResponse.json({ error: 'No audio' }, { status: 400 })

  const buffer = Buffer.from(await audio.arrayBuffer())

  const rows = await query(
    `INSERT INTO call_recordings
       (company_id, caller_name, company_name_snapshot, duration_seconds, recording_data, mime_type, called_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, called_at`,
    [companyId || null, callerName || null, companyNameSnapshot || null, durationSeconds, buffer, mimeType || 'audio/webm']
  )

  return NextResponse.json(rows[0])
}

export async function GET() {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await query(`
    SELECT
      r.id,
      r.caller_name,
      r.duration_seconds,
      r.mime_type,
      r.called_at,
      COALESCE(r.company_name_snapshot, c.company_name) AS company_name,
      c.id AS company_id
    FROM call_recordings r
    LEFT JOIN companies c ON c.id = r.company_id
    WHERE r.recording_data IS NOT NULL
    ORDER BY r.called_at DESC
    LIMIT 200
  `)

  return NextResponse.json(rows)
}
