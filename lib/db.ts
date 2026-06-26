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
