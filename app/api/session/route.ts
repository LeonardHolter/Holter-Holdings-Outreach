import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

// A claim is considered active for this long after its last heartbeat.
// The client heartbeats every 12s, so 90s tolerates several missed beats
// before another caller can take over a dropped claim.
const STALE = "90 seconds"

async function checkAuth() {
  const cookieStore = await cookies()
  return cookieStore.get('session')?.value === 'authenticated'
}

// GET — active claims, for the presence badge + skip list
export async function GET() {
  if (!await checkAuth()) return NextResponse.json([], { status: 401 })
  const rows = await query(
    `SELECT caller_name, company_id, company_name
     FROM company_claims
     WHERE claimed_at > NOW() - INTERVAL '${STALE}'`
  )
  return NextResponse.json(rows)
}

/**
 * PUT — atomically claim a company.
 *
 * The lock table is keyed by company_id (PRIMARY KEY), so two callers racing
 * for the SAME company are physically serialized by Postgres: the second
 * INSERT waits for the first to commit, then hits the ON CONFLICT path and is
 * rejected by the WHERE unless the existing claim is its own or has gone stale.
 *
 * Returns { claimed: boolean }.
 */
export async function PUT(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({ claimed: false }, { status: 401 })
  const { caller_name, company_id, company_name } = await req.json()
  if (!caller_name) return NextResponse.json({ error: 'caller_name required' }, { status: 400 })

  // No company to claim (empty queue / between leads) — nothing to lock.
  if (!company_id) return NextResponse.json({ claimed: true })

  const rows = await query(
    `INSERT INTO company_claims (company_id, caller_name, company_name, claimed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (company_id) DO UPDATE
       SET caller_name = EXCLUDED.caller_name,
           company_name = EXCLUDED.company_name,
           claimed_at = NOW()
       WHERE company_claims.caller_name = EXCLUDED.caller_name
          OR company_claims.claimed_at < NOW() - INTERVAL '${STALE}'
     RETURNING caller_name`,
    [company_id, caller_name, company_name ?? null]
  )

  const claimed = rows.length > 0

  // If we got it, release any OTHER company we were previously holding so we
  // never occupy two slots at once.
  if (claimed) {
    await query(
      `DELETE FROM company_claims WHERE caller_name = $1 AND company_id <> $2`,
      [caller_name, company_id]
    )
  }

  return NextResponse.json({ claimed })
}

// DELETE — release everything this caller holds (on tab close / sign out)
export async function DELETE(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const { caller_name } = await req.json()
  if (!caller_name) return NextResponse.json({ error: 'caller_name required' }, { status: 400 })
  await query('DELETE FROM company_claims WHERE caller_name = $1', [caller_name])
  return NextResponse.json({ ok: true })
}
