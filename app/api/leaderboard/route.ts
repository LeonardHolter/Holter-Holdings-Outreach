import { NextResponse } from 'next/server'
import { winsByCaller } from '@/lib/winsByCaller'

// All-time WON deals per caller, for the leaderboard banner in the nav.
// The attribution logic lives in lib/winsByCaller, shared with the Sales
// Performance table on /stats so the two can never disagree.

export const dynamic = 'force-dynamic'

export type { LeaderRow } from '@/lib/winsByCaller'

export async function GET() {
  try {
    return NextResponse.json({ leaders: await winsByCaller() })
  } catch {
    // A banner is decoration — never let it 500 a page load.
    return NextResponse.json({ leaders: [] })
  }
}
