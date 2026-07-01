import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

async function checkAuth() {
  const cookieStore = await cookies()
  return cookieStore.get('session')?.value === 'authenticated'
}

// GET /api/notes?date=YYYY-MM-DD — company notes written that day plus any
// free-form day notes the team added. Used by the Stats day-detail panel.
export async function GET(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json([], { status: 401 })

  const date = req.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'valid date required' }, { status: 400 })
  }

  const [companyNotes, dayNotes] = await Promise.all([
    query(
      `SELECT n.note, n.caller_name, n.created_at, c.company_name, c.id AS company_id
       FROM company_notes n
       LEFT JOIN companies c ON c.id = n.company_id
       WHERE n.created_at::date = $1
       ORDER BY n.created_at DESC`,
      [date]
    ),
    query(
      `SELECT id, note, caller_name, created_at
       FROM day_notes WHERE day = $1 ORDER BY created_at DESC`,
      [date]
    ),
  ])

  return NextResponse.json({
    company: companyNotes,
    day: dayNotes,
  })
}

// POST /api/notes — add a free-form note for a day.
// body: { date, note, caller_name? }
export async function POST(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const { date, note, caller_name } = await req.json()
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !note?.trim()) {
    return NextResponse.json({ error: 'date and note required' }, { status: 400 })
  }
  const rows = await query(
    `INSERT INTO day_notes (day, note, caller_name) VALUES ($1, $2, $3)
     RETURNING id, note, caller_name, created_at`,
    [date, note.trim(), caller_name || null]
  )
  return NextResponse.json(rows[0])
}

// DELETE /api/notes?id=<day_note_id> — remove a day note.
export async function DELETE(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({}, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await query('DELETE FROM day_notes WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
