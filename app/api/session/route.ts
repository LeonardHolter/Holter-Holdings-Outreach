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

/**
 * PUT — atomically claim a company for this caller.
 *
 * Succeeds (claimed:true) unless another *active* caller already holds the
 * same company_id. The whole check-and-set is a single SQL statement so two
 * callers racing for the same company can never both win.
 *
 * Passing a null company_id just registers presence (e.g. caller selected but
 * queue empty) and always succeeds.
 */
export async function PUT(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const { caller_name, company_id, company_name } = await req.json()
  if (!caller_name) return NextResponse.json({ error: 'caller_name required' }, { status: 400 })

  if (!company_id) {
    await query(
      `INSERT INTO caller_sessions (caller_name, company_id, company_name, updated_at)
       VALUES ($1, NULL, NULL, NOW())
       ON CONFLICT (caller_name) DO UPDATE
         SET company_id = NULL, company_name = NULL, updated_at = NOW()`,
      [caller_name]
    )
    return NextResponse.json({ claimed: true })
  }

  const rows = await query(
    `WITH conflict AS (
       SELECT 1 FROM caller_sessions
       WHERE company_id = $2
         AND caller_name <> $1
         AND updated_at > NOW() - INTERVAL '5 minutes'
     )
     INSERT INTO caller_sessions (caller_name, company_id, company_name, updated_at)
     SELECT $1, $2, $3, NOW()
     WHERE NOT EXISTS (SELECT 1 FROM conflict)
     ON CONFLICT (caller_name) DO UPDATE
       SET company_id = EXCLUDED.company_id,
           company_name = EXCLUDED.company_name,
           updated_at = NOW()
     RETURNING caller_name`,
    [caller_name, company_id, company_name ?? null]
  )

  return NextResponse.json({ claimed: rows.length > 0 })
}

// DELETE — caller is leaving
export async function DELETE(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const { caller_name } = await req.json()
  if (!caller_name) return NextResponse.json({ error: 'caller_name required' }, { status: 400 })
  await query('DELETE FROM caller_sessions WHERE caller_name = $1', [caller_name])
  return NextResponse.json({ ok: true })
}
