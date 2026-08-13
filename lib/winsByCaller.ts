import { query } from '@/lib/db'

// All-time WON deals per caller — the single source used by both the nav
// leaderboard and the Sales Performance table on /stats, so the two can
// never disagree.
//
// Targets only: an intermediary (accountant) is a referral relationship with
// no deal of its own to win, and counting one here would inflate the rate
// against a denominator of target conversations.
//
// Attribution mirrors the Won list on /demos exactly: prefer whoever
// actually booked the demo (latest 'Demo booked' call event), fall back to
// companies.who_called, and finally infer from the per-person counters when
// only one of us ever dialled the company. A win we cannot attribute to
// anyone is left uncounted rather than guessed.
//
// The roster is fixed at two because calls_leonard / calls_william are baked
// into the schema; the result stays a sorted array so callers are
// roster-agnostic and a third teammate only needs a migration + one line.

export interface LeaderRow {
  name: string
  wins: number
}

export const ROSTER = ['Leonard', 'William']

export async function winsByCaller(): Promise<LeaderRow[]> {
  const rows = await query(
    `SELECT
       COALESCE(
         b.booked_by,
         c.who_called,
         CASE
           WHEN COALESCE(c.calls_leonard, 0) > 0 AND COALESCE(c.calls_william, 0) = 0 THEN 'Leonard'
           WHEN COALESCE(c.calls_william, 0) > 0 AND COALESCE(c.calls_leonard, 0) = 0 THEN 'William'
         END
       ) AS closed_by,
       COUNT(*)::int AS wins
     FROM companies c
     LEFT JOIN LATERAL (
       SELECT caller_name AS booked_by
       FROM call_events
       WHERE company_id = c.id AND response = 'Demo booked' AND caller_name IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1
     ) b ON true
     WHERE c.demo_outcome = 'Won'
       AND COALESCE(c.lead_type, 'target') <> 'intermediary'
     GROUP BY 1`,
  )

  // Names come from free-text columns — fold them onto the roster so a
  // stray 'leonard' doesn't split into its own entry.
  const tally = new Map(ROSTER.map(n => [n, 0]))
  for (const r of rows as Record<string, unknown>[]) {
    const raw = typeof r.closed_by === 'string' ? r.closed_by.trim().toLowerCase() : ''
    const name = ROSTER.find(n => n.toLowerCase() === raw)
    if (name) tally.set(name, (tally.get(name) ?? 0) + (Number(r.wins) || 0))
  }

  return ROSTER.map(name => ({ name, wins: tally.get(name) ?? 0 })).sort((a, b) => b.wins - a.wins)
}
