import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

const STALE = '90 seconds'

async function checkAuth() {
  const cookieStore = await cookies()
  return cookieStore.get('session')?.value === 'authenticated'
}

/**
 * POST — server-authoritative "give me my next lead".
 *
 * The client sends an ordered list of candidate company ids (its sorted,
 * not-yet-called queue). The server walks them and atomically claims the FIRST
 * one no other active caller holds, then returns it. Because the lock table is
 * keyed by company_id, two callers sending overlapping candidate lists at the
 * same instant are serialized by Postgres — they can never be handed the same
 * company.
 *
 * Returns { company_id } (the claimed lead) or { company_id: null } if every
 * candidate is taken.
 */
export async function POST(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({ company_id: null }, { status: 401 })

  const { caller_name, candidate_ids } = await req.json()
  if (!caller_name || !Array.isArray(candidate_ids)) {
    return NextResponse.json({ error: 'caller_name and candidate_ids required' }, { status: 400 })
  }

  for (const id of candidate_ids) {
    const rows = await query(
      `INSERT INTO company_claims (company_id, caller_name, company_name, claimed_at)
       SELECT $1, $2, c.company_name, NOW()
       FROM companies c WHERE c.id = $1
       ON CONFLICT (company_id) DO UPDATE
         SET caller_name = EXCLUDED.caller_name,
             company_name = EXCLUDED.company_name,
             claimed_at = NOW()
         WHERE company_claims.caller_name = EXCLUDED.caller_name
            OR company_claims.claimed_at < NOW() - INTERVAL '${STALE}'
       RETURNING company_id`,
      [id, caller_name]
    )
    if (rows.length > 0) {
      // Got it — release any other company we were holding.
      await query(
        'DELETE FROM company_claims WHERE caller_name = $1 AND company_id <> $2',
        [caller_name, id]
      )
      return NextResponse.json({ company_id: id })
    }
  }

  return NextResponse.json({ company_id: null })
}
