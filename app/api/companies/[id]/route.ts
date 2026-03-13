import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id } = await params
    const body: Partial<Company> = await request.json()

    // Auto-fill last_reach_out to today whenever a real response is saved
    // and the caller hasn't already supplied a date explicitly
    const activeResponse =
      body.reach_out_response !== undefined &&
      body.reach_out_response !== 'Not called' &&
      body.reach_out_response !== null

    if (activeResponse && !body.last_reach_out) {
      body.last_reach_out = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    }

    const { data, error } = await supabase
      .from('companies')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update company' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id } = await params

    const { error } = await supabase.from('companies').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete company' }, { status: 500 })
  }
}
