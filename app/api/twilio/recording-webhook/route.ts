import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

// Twilio posts here when a dial recording is ready (async, 30-60s after the
// call ends). We save the recording metadata to call_recordings.
//
// Reliability rules (a full day of records was once lost to silent failures):
// 1. The row is ALWAYS inserted, even when no company matches the call SID.
// 2. Failures return a 500 with a log line so they are visible in the Twilio
//    debugger and Vercel logs instead of vanishing.
// 3. Duplicate callbacks for the same recording are ignored (idempotent).
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

  const mp3Url = `${recordingUrl}.mp3`

  try {
    const existing = await query(
      'SELECT id FROM call_recordings WHERE recording_url = $1 LIMIT 1',
      [mp3Url]
    )
    if (existing.length > 0) {
      console.log(`[recording-webhook] Recording ${recordingSid} already saved — skipping`)
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const companies = await query(
      'SELECT id, who_called, company_name FROM companies WHERE last_call_sid = $1 LIMIT 1',
      [callSid]
    )
    let company = companies[0] as { id: string; who_called: string | null; company_name: string | null } | undefined

    // Fallback: match by the dialed number (passed by the voice webhook)
    if (!company) {
      const dialedDigits = (request.nextUrl.searchParams.get('to') ?? '').replace(/\D/g, '')
      const normalized = dialedDigits.length === 11 && dialedDigits.startsWith('1')
        ? dialedDigits.slice(1)
        : dialedDigits
      if (normalized.length >= 10) {
        const byPhone = await query(
          `SELECT id, who_called, company_name FROM companies
           WHERE regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') LIKE '%' || $1
           LIMIT 1`,
          [normalized]
        )
        company = byPhone[0]
      }
    }

    await query(
      `INSERT INTO call_recordings
         (company_id, call_sid, recording_url, duration_seconds, called_by, caller_name, caller_number, company_name_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        company?.id ?? null,
        callSid,
        mp3Url,
        duration ? parseInt(duration, 10) : null,
        callerName ?? company?.who_called ?? null,
        callerName,
        callerNumber,
        company?.company_name ?? null,
      ]
    )

    if (!company) {
      console.warn(`[recording-webhook] Recording ${recordingSid} saved without a company match (call ${callSid})`)
    }
    console.log(`Recording saved: ${recordingSid} for call ${callSid} by ${callerName ?? 'unknown'}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[recording-webhook] FAILED to save recording ${recordingSid} (call ${callSid}): ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
