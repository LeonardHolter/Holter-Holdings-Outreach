import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import twilio from 'twilio'
import { query } from '@/lib/db'

// Safety net for Twilio dial recordings: pulls recordings straight from the
// Twilio REST API and backfills any that are missing from call_recordings.
// The audio itself is downloaded and stored in recording_data so backfilled
// recordings show up and play on /recordings exactly like browser recordings.
// Recordings live in Twilio's cloud, so even if every webhook fails (bad
// deploy, DB outage) a sync fully recovers the day's records.
//
// POST /api/twilio/recordings/sync          → syncs the last 7 days
// POST /api/twilio/recordings/sync?days=30  → syncs the last 30 days (max 90)

const MS_PER_DAY = 24 * 60 * 60 * 1000
// Stay well under Neon/serverless body limits — Twilio mp3s are ~0.25 MB/min
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

function normalizePhone(p: string | null | undefined): string {
  const digits = (p ?? '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 })
  }

  const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') ?? '7', 10) || 7, 1), 90)
  const since = new Date(Date.now() - days * MS_PER_DAY)

  const client = twilio(accountSid, authToken)
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const recordings = await client.recordings.list({ dateCreatedAfter: since, limit: 1000 })
  if (recordings.length === 0) {
    return NextResponse.json({ checked: 0, imported: 0, audioFilled: 0, alreadySaved: 0, unmatched: 0, failed: 0 })
  }

  // recording_url is the stable identity shared with the webhook path
  const urlFor = (uri: string) => `https://api.twilio.com${uri.replace(/\.json$/, '')}.mp3`

  let imported = 0
  let audioFilled = 0
  let alreadySaved = 0
  let unmatched = 0
  const failures: string[] = []

  for (const rec of recordings) {
    const mp3Url = urlFor(rec.uri)
    try {
      const existing = await query(
        'SELECT id, recording_data IS NOT NULL AS has_audio FROM call_recordings WHERE recording_url = $1 LIMIT 1',
        [mp3Url]
      ) as { id: string; has_audio: boolean }[]

      if (existing[0]?.has_audio) { alreadySaved++; continue }

      // Match a company: first by last_call_sid, then by the dialed number on
      // the <Dial> child leg (the recording hangs off the parent browser call).
      const bySid = await query(
        'SELECT id, who_called, company_name FROM companies WHERE last_call_sid = $1 LIMIT 1',
        [rec.callSid]
      ) as { id: string; who_called: string | null; company_name: string | null }[]
      let company = bySid[0] ?? null
      let callerNumber: string | null = null

      try {
        const children = await client.calls.list({ parentCallSid: rec.callSid, limit: 1 })
        const child = children[0]
        if (child) {
          callerNumber = child.from ?? null
          if (!company) {
            const dialed = normalizePhone(child.to)
            if (dialed.length >= 10) {
              const byPhone = await query(
                `SELECT id, who_called, company_name FROM companies
                 WHERE regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') LIKE '%' || $1
                 LIMIT 1`,
                [dialed]
              ) as typeof bySid
              company = byPhone[0] ?? null
            }
          }
        }
      } catch {
        // Child-leg lookup is best-effort — save the recording regardless
      }

      // Download the audio so the recording plays on /recordings
      let audio: Buffer | null = null
      const audioRes = await fetch(mp3Url, { headers: { Authorization: `Basic ${basicAuth}` } })
      if (audioRes.ok) {
        const buf = Buffer.from(await audioRes.arrayBuffer())
        if (buf.length > 0 && buf.length <= MAX_AUDIO_BYTES) audio = buf
      }

      if (!company) unmatched++

      if (existing[0]) {
        // Webhook already wrote the metadata row — just fill in the audio
        if (audio) {
          await query(
            `UPDATE call_recordings SET recording_data = $1, mime_type = 'audio/mpeg' WHERE id = $2`,
            [audio, existing[0].id]
          )
          audioFilled++
        } else {
          alreadySaved++
        }
        continue
      }

      await query(
        `INSERT INTO call_recordings
           (company_id, call_sid, recording_url, duration_seconds, called_by, caller_name, caller_number,
            company_name_snapshot, recording_data, mime_type, called_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          company?.id ?? null,
          rec.callSid,
          mp3Url,
          rec.duration ? parseInt(rec.duration, 10) : null,
          company?.who_called ?? null,
          company?.who_called ?? null,
          callerNumber,
          company?.company_name ?? null,
          audio,
          audio ? 'audio/mpeg' : null,
          rec.dateCreated?.toISOString?.() ?? new Date().toISOString(),
        ]
      )
      imported++
    } catch (err) {
      failures.push(`${rec.sid}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures.length > 0) {
    console.error('[recordings/sync] failures:', failures)
  }

  return NextResponse.json({
    checked: recordings.length,
    imported,
    audioFilled,
    alreadySaved,
    unmatched,
    failed: failures.length,
    ...(failures.length > 0 ? { failures: failures.slice(0, 10) } : {}),
  })
}
