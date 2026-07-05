import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'
import { DEMO_TOUCHPOINTS } from '@/types'

// The table is created on demand so no manual Neon migration is needed
// (mirrors schema.sql). Ensured once per serverless instance.
let ensured = false
async function ensureTable() {
  if (ensured) return
  await query(`
    CREATE TABLE IF NOT EXISTS demo_touchpoints (
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      touchpoint TEXT NOT NULL,
      caller_name TEXT,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, touchpoint)
    )
  `)
  ensured = true
}

async function authed(): Promise<boolean> {
  const cookieStore = await cookies()
  return cookieStore.get('session')?.value === 'authenticated'
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  await ensureTable()
  const rows = await query(
    `SELECT touchpoint, caller_name, completed_at
     FROM demo_touchpoints WHERE company_id = $1`,
    [id]
  )
  return NextResponse.json(rows)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const { touchpoint, done, caller_name } = await request.json()

  if (!DEMO_TOUCHPOINTS.some(tp => tp.key === touchpoint)) {
    return NextResponse.json({ error: 'Unknown touchpoint' }, { status: 400 })
  }

  await ensureTable()

  if (done) {
    await query(
      `INSERT INTO demo_touchpoints (company_id, touchpoint, caller_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, touchpoint) DO NOTHING`,
      [id, touchpoint, caller_name || null]
    )
  } else {
    await query(
      `DELETE FROM demo_touchpoints WHERE company_id = $1 AND touchpoint = $2`,
      [id, touchpoint]
    )
  }

  return NextResponse.json({ ok: true })
}
