import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  const form = await request.formData()

  const messageSid = form.get('MessageSid') as string | null
  const from = form.get('From') as string | null
  const to = form.get('To') as string | null
  const body = form.get('Body') as string | null

  if (from && to) {
    
    await query(
      `INSERT INTO incoming_messages (twilio_sid, from_number, to_number, body, direction, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (twilio_sid) DO NOTHING`,
      [messageSid, from, to, body ?? '', 'inbound', 'received']
    )
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
