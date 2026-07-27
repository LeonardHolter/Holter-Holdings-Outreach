import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { normalizeDigits, verifyLeadSignature } from '@/lib/telnyxDial'

// Telnyx posts here when a click-to-call recording is ready. Two hard
// lessons inherited from the sibling systems are baked in:
//
// 1. Telnyx recording links are PRE-SIGNED S3 URLs valid ~10 minutes
//    (bucket telephony-recorder-*, signature in the query string) — so we
//    download the audio NOW and store the bytes in OUR OWN Neon database
//    (call_recordings.recording_data, same column the console REC uses).
//    Nothing touches KI Consult's database or storage. Storing only the
//    URL, like the Twilio flow does, would leave a dead link.
// 2. Only Telnyx-shaped hosts are fetched (their API hosts, or their S3
//    bucket in path/vhost form) — the URL arrives in a request body, and
//    without the check this route is an SSRF hole.
//
// PUBLIC path (Telnyx has no session); authenticated by the same HMAC the
// TwiML carries, threaded through recordingStatusCallback. Idempotent on
// RecordingSid — Telnyx retries callbacks.

export const dynamic = 'force-dynamic'

const TELNYX_BUCKET = /^telephony-recorder(-[a-z0-9]+)*$/
const S3_PATH_STYLE = /^s3([.-][a-z0-9-]+)*\.amazonaws\.com$/
const S3_VHOST_STYLE = /^([a-z0-9.-]+)\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$/

function isTelnyxRecordingUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname
  if (host === 'telnyx.com' || host.endsWith('.telnyx.com')) return true
  if (S3_PATH_STYLE.test(host)) return TELNYX_BUCKET.test(url.pathname.split('/')[1] ?? '')
  const vhost = S3_VHOST_STYLE.exec(host)
  return vhost ? TELNYX_BUCKET.test(vhost[1]) : false
}

export async function POST(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const lead = normalizeDigits(q.get('lead') ?? '')
  const sig = q.get('sig') ?? ''
  if (!process.env.APP_PASSWORD || lead.length < 8 || !verifyLeadSignature(lead, sig)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'bad_body' }, { status: 400 })

  const status = String(form.get('RecordingStatus') ?? 'completed')
  const recordingUrl = String(form.get('RecordingUrl') ?? '')
  const recordingSid = String(form.get('RecordingSid') ?? '')
  const callSid = String(form.get('CallSid') ?? '')
  const duration = Number(form.get('RecordingDuration') ?? 0) || 0
  // Ack non-final events so Telnyx stops retrying them.
  if (status !== 'completed' || !recordingUrl || !recordingSid) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  if (!isTelnyxRecordingUrl(recordingUrl)) {
    console.warn('[telnyx-recording] rejected URL host', recordingUrl.slice(0, 60))
    return NextResponse.json({ error: 'bad_recording_url' }, { status: 400 })
  }

  const idempotencyKey = `telnyx:${recordingSid}`
  const existing = await query('SELECT id FROM call_recordings WHERE recording_url = $1 LIMIT 1', [
    idempotencyKey,
  ])
  if (existing.length > 0) return NextResponse.json({ ok: true, duplicate: true })

  // Pre-signed link: credentials live in the query string, no headers —
  // and it expires in ~10 minutes, hence download-before-insert.
  const audio = await fetch(recordingUrl, { signal: AbortSignal.timeout(30_000) })
  if (!audio.ok) {
    console.error('[telnyx-recording] download failed', audio.status)
    return NextResponse.json({ error: 'download_failed' }, { status: 502 })
  }
  const bytes = Buffer.from(await audio.arrayBuffer())
  const mime = audio.headers.get('content-type')?.split(';')[0] || 'audio/mpeg'

  // Best-effort company match on the lead's number, same variants the call
  // page searches with.
  const variants = [lead, `+${lead}`, lead.startsWith('47') ? lead.slice(2) : null].filter(
    Boolean,
  ) as string[]
  let company: { id: string; company_name: string | null } | undefined
  for (const v of variants) {
    const rows = await query(
      'SELECT id, company_name FROM companies WHERE phone_number = $1 LIMIT 1',
      [v],
    )
    if (rows[0]) {
      company = rows[0]
      break
    }
  }

  await query(
    `INSERT INTO call_recordings
       (company_id, call_sid, recording_url, recording_data, mime_type,
        company_name_snapshot, duration_seconds, called_by, caller_name, caller_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      company?.id ?? null,
      callSid || null,
      idempotencyKey,
      bytes,
      mime,
      company?.company_name ?? null,
      duration,
      q.get('caller') || null,
      q.get('caller') || null,
      q.get('from') || null,
    ],
  )
  console.log('[telnyx-recording] stored', { recordingSid, seconds: duration, bytes: bytes.length })
  return NextResponse.json({ ok: true })
}
