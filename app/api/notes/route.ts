import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

// GET /api/notes?date=YYYY-MM-DD — notes written on a given day, with the
// company and who wrote them. Used by the Stats day-detail panel.
export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json([], { status: 401 })
  }

  const date = req.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'valid date required' }, { status: 400 })
  }

  const rows = await query(
    `SELECT n.note, n.caller_name, n.created_at, c.company_name, c.id AS company_id
     FROM company_notes n
     LEFT JOIN companies c ON c.id = n.company_id
     WHERE n.created_at::date = $1
     ORDER BY n.created_at DESC`,
    [date]
  )
  return NextResponse.json(rows)
}
