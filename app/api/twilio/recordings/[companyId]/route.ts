import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params
  

  const rows = await query(
    'SELECT id, call_sid, caller_name, recording_url, duration_seconds, called_at, called_by FROM call_recordings WHERE company_id = $1 AND (duration_seconds IS NULL OR duration_seconds >= 60) ORDER BY called_at DESC LIMIT 20',
    [companyId]
  )

  return NextResponse.json(rows)
}
