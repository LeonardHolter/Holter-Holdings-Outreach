import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

// One-time (and repeatable) cleanup: permanently delete call recordings that
// are shorter than a minute — quick hangups and voicemails that aren't worth
// keeping. Recordings with an unknown (NULL) duration are left untouched.
// Trigger with an authenticated POST, e.g. from the browser console on the
// deployed app:  fetch('/api/recordings/cleanup-short', { method: 'POST' })
export async function POST(_request: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await query(
    `DELETE FROM call_recordings
     WHERE duration_seconds IS NOT NULL AND duration_seconds < 60
     RETURNING id`
  )

  return NextResponse.json({ deleted: rows.length })
}
