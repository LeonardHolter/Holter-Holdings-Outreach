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
 * Lead-priority ordering based on driftsinntekter (revenue, stored in
 * thousands NOK). Highest priority first:
 *   1. 10–20 MNOK     — the sweet spot, called first
 *   2. Under 10 MNOK  — real shop, real revenue, real pain
 *   3. 20–25 MNOK     — getting large, lower priority
 *   4. Unknown revenue — kept, ranked below known-good leads
 *   5. Over 25 MNOK   — too big, wrong buyer (sinks to the bottom)
 * Within a tier, larger revenue ranks first.
 */
export const PRIORITY_ORDER_BY = `
  CASE
    WHEN revenue IS NOT NULL AND revenue >= 10000 AND revenue <= 20000 THEN 1
    WHEN revenue IS NOT NULL AND revenue < 10000 THEN 2
    WHEN revenue IS NOT NULL AND revenue <= 25000 THEN 3
    WHEN revenue IS NULL THEN 4
    ELSE 5
  END ASC,
  revenue DESC NULLS LAST,
  company_name ASC`
