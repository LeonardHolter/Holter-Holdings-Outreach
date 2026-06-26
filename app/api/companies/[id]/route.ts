import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import type { Company } from '@/types'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    
    const { id } = await params
    const body: Partial<Company> = await request.json()

    const activeResponse =
      body.reach_out_response !== undefined &&
      body.reach_out_response !== 'Not called' &&
      body.reach_out_response !== null

    if (activeResponse && !body.last_reach_out) {
      body.last_reach_out = new Date().toISOString().slice(0, 10)
    }

    const keys = Object.keys(body)
    const sets = keys.map((k, i) => `${k} = $${i + 2}`)
    const values = keys.map(k => (body as Record<string, unknown>)[k])

    const rows = await query(
      `UPDATE companies SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values]
    )

    return NextResponse.json(rows[0])
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
    
    const { id } = await params
    await query('DELETE FROM companies WHERE id = $1', [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete company' }, { status: 500 })
  }
}
