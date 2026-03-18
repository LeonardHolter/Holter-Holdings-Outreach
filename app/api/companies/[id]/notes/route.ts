import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('company_notes')
    .select('id, note, caller_name, created_at')
    .eq('company_id', id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { note, caller_name } = await req.json()
  if (!note?.trim()) return NextResponse.json({ error: 'note is required' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('company_notes')
    .insert({ company_id: id, note: note.trim(), caller_name: caller_name ?? null })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
