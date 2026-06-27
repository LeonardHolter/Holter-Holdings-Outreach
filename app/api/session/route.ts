import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

async function checkAuth() {
  const cookieStore = await cookies()
  return cookieStore.get('session')?.value === 'authenticated'
}

// GET — return all active sessions (updated within last 5 minutes)
export async function GET() {
  if (!await checkAuth()) return NextResponse.json([], { status: 401 })
  const rows = await query(
    `SELECT caller_name, company_id, company_name, updated_at
     FROM caller_sessions
     WHERE updated_at > NOW() - INTERVAL '5 minutes'`
  )
  return NextResponse.json(rows)
}

// PUT — upsert caller's current company
export async function PUT(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const { caller_name, company_id, company_name } = await req.json()
  if (!caller_name) return NextResponse.json({ error: 'caller_name required' }, { status: 400 })
  await query(
    `INSERT INTO caller_sessions (caller_name, company_id, company_name, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (caller_name) DO UPDATE
       SET company_id = $2, company_name = $3, updated_at = NOW()`,
    [caller_name, company_id ?? null, company_name ?? null]
  )
  return NextResponse.json({ ok: true })
}

// DELETE — caller is leaving
export async function DELETE(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const { caller_name } = await req.json()
  if (!caller_name) return NextResponse.json({ error: 'caller_name required' }, { status: 400 })
  await query('DELETE FROM caller_sessions WHERE caller_name = $1', [caller_name])
  return NextResponse.json({ ok: true })
}
