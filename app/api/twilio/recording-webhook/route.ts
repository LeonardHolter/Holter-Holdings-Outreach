import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  const formData = await request.formData()

  const callSid = formData.get('CallSid') as string
  const recordingSid = formData.get('RecordingSid') as string
  const recordingUrl = formData.get('RecordingUrl') as string
  const duration = formData.get('RecordingDuration') as string

  const callerName = request.nextUrl.searchParams.get('callerName') ?? null
  const callerNumber = request.nextUrl.searchParams.get('callerNumber') ?? null

  if (!callSid || !recordingUrl) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  

  const companies = await query(
    'SELECT id, who_called FROM companies WHERE last_call_sid = $1 LIMIT 1',
    [callSid]
  )
  const company = companies[0] as { id: string; who_called: string | null } | undefined

  const companyId = company?.id ?? null
  const calledBy = callerName ?? company?.who_called ?? null

  await query(
    `INSERT INTO call_recordings (company_id, call_sid, recording_url, duration_seconds, called_by, caller_name, caller_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [companyId, callSid, `${recordingUrl}.mp3`, duration ? parseInt(duration, 10) : null, calledBy, callerName, callerNumber]
  )

  console.log(`Recording saved: ${recordingSid} for call ${callSid} by ${callerName ?? 'unknown'}`)
  return NextResponse.json({ ok: true })
}
