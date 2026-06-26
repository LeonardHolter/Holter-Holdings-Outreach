import { Pool } from '@neondatabase/serverless'

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
 *   1. Under 15 MNOK  — real shop, real revenue, real pain
 *   2. 15–25 MNOK     — getting large, lower priority
 *   3. Unknown revenue — kept, ranked below known-good leads
 *   4. Over 25 MNOK   — too big, wrong buyer (sinks to the bottom)
 * Within a tier, larger revenue ranks first.
 */
export const PRIORITY_ORDER_BY = `
  CASE
    WHEN revenue IS NOT NULL AND revenue < 15000 THEN 1
    WHEN revenue IS NOT NULL AND revenue <= 25000 THEN 2
    WHEN revenue IS NULL THEN 3
    ELSE 4
  END ASC,
  revenue DESC NULLS LAST,
  company_name ASC`
