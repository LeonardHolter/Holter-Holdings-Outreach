import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const { to, from, body } = await request.json() as {
    to: string; from: string; body: string
  }

  if (!to || !from || !body?.trim()) {
    return NextResponse.json({ error: 'to, from, and body are required' }, { status: 400 })
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 })
  }

  const client = twilio(accountSid, authToken)

  try {
    const message = await client.messages.create({ to, from, body: body.trim() })

    // Log the outbound message to the same table
    const supabase = await createClient()
    await supabase.from('incoming_messages').insert({
      twilio_sid:   message.sid,
      from_number:  from,
      to_number:    to,
      body:         body.trim(),
      direction:    'outbound',
      status:       'sent',
    })

    return NextResponse.json({ success: true, sid: message.sid })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[send-sms]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
