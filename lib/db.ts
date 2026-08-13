import { Pool, types } from '@neondatabase/serverless'

// Return DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings instead of JS
// Date objects. The default Date parsing both breaks date-fns' parseISO (which
// expects a string) and shifts date-only values across timezones (off-by-one).
types.setTypeParser(1082, (v: string) => v)

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL! })
  }
  return pool
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query(text: string, params?: unknown[]): Promise<any[]> {
  const { rows } = await getPool().query(text, params)
  return rows
}

/**
 * A lead is TERMINAL when it must never come back into the call queue.
 *
 * Deliberately short. In a proprietary acquisition search the modal answer
 * from a good target is "not right now", and three years later that is the
 * deal — so 'Not interested' is NOT terminal any more. It reschedules on the
 * exit horizon instead. Burning it was the single most expensive rule in the
 * queue: it threw away the leads the search exists to find.
 *
 * What genuinely closes a file:
 *  - Wrong number / Not needed / Not a fit — bad record or wrong profile.
 *  - exit_horizon 'never' | 'sold' — the owner answered the only question
 *    that matters, and the answer ends it.
 *  - 'Demo booked' on a TARGET — it is in an active process on /demos, and
 *    re-dialling from the cold queue would cut across that. Intermediaries
 *    keep recurring: a booked intro with an accountant starts the
 *    relationship, it does not end it.
 *
 * Every column is COALESCEd before comparison, and that is load-bearing, not
 * defensive habit. `exit_horizon IN ('never','sold')` evaluates to NULL — not
 * false — on the rows where exit_horizon IS NULL, which is most of them. That
 * NULL propagates through the OR, and `NOT NULL` is NULL rather than true, so
 * an un-COALESCEd version of this predicate silently empties the entire call
 * queue.
 */
export const QUEUE_TERMINAL_SQL = `(
  COALESCE(reach_out_response, '') IN ('Wrong number', 'Not needed', 'Not a fit')
  OR COALESCE(exit_horizon, '') IN ('never', 'sold')
  OR (COALESCE(reach_out_response, '') = 'Demo booked' AND COALESCE(lead_type, 'target') <> 'intermediary')
)`

/**
 * Lead-priority ordering based on driftsinntekter (revenue, stored in
 * thousands NOK). Highest priority first:
 *   1. 20–50 MNOK     — the sweet spot (decided 2026-08-06), called first
 *   2. 10–20 MNOK     — the previous sweet spot, next in line
 *   3. Under 10 MNOK  — real shop, real revenue, real pain
 *   4. Unknown revenue — kept, ranked below known-good leads
 *   5. Over 50 MNOK   — too big, wrong buyer (sinks to the bottom)
 * Within a tier, larger revenue ranks first. Must stay in sync with
 * revenuePriority in components/CallingSession.tsx.
 */
export const PRIORITY_ORDER_BY = `
  CASE
    WHEN revenue IS NOT NULL AND revenue > 20000 AND revenue <= 50000 THEN 1
    WHEN revenue IS NOT NULL AND revenue >= 10000 THEN 2
    WHEN revenue IS NOT NULL AND revenue < 10000 THEN 3
    WHEN revenue IS NULL THEN 4
    ELSE 5
  END ASC,
  revenue DESC NULLS LAST,
  company_name ASC`
