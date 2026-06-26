import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  const rows = await query(
    'SELECT id, note, caller_name, created_at FROM company_notes WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50',
    [id]
  )
  return NextResponse.json(rows)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { note, caller_name } = await req.json()
  if (!note?.trim()) return NextResponse.json({ error: 'note is required' }, { status: 400 })

  
  const rows = await query(
    'INSERT INTO company_notes (company_id, note, caller_name) VALUES ($1, $2, $3) RETURNING *',
    [id, note.trim(), caller_name ?? null]
  )
  return NextResponse.json(rows[0])
}
