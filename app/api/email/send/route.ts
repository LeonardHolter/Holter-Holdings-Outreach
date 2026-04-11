import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/gmail'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { companyId, to, subject, body: emailBody, scheduledAt } = body as {
    companyId: string
    to: string
    subject: string
    body: string
    scheduledAt: string
  }

  if (!to || !subject || !emailBody) {
    return NextResponse.json({ error: 'to, subject, and body are required' }, { status: 400 })
  }

  const supabase = await createClient()

  const scheduledTime = new Date(scheduledAt)
  const now = new Date()
  const sendImmediately = scheduledTime.getTime() - now.getTime() < 60_000

  if (sendImmediately) {
    try {
      const { messageId } = await sendEmail({
        to,
        subject,
        body: emailBody,
        fromName: 'Holter Holdings',
      })

      const { data, error } = await supabase
        .from('scheduled_emails')
        .insert({
          company_id: companyId,
          to_email: to,
          subject,
          body: emailBody,
          scheduled_at: now.toISOString(),
          status: 'sent',
          sent_at: now.toISOString(),
        })
        .select()
        .single()

      if (error) {
        console.error('[email/send] DB insert failed:', error)
        return NextResponse.json({ error: 'Email sent but failed to log' }, { status: 500 })
      }

      return NextResponse.json({ ...data, messageId, sent: true })
    } catch (err) {
      console.error('[email/send] Send failed:', err)
      return NextResponse.json(
        { error: `Failed to send: ${err instanceof Error ? err.message : 'Unknown error'}` },
        { status: 500 },
      )
    }
  }

  // Schedule for later
  const { data, error } = await supabase
    .from('scheduled_emails')
    .insert({
      company_id: companyId,
      to_email: to,
      subject,
      body: emailBody,
      scheduled_at: scheduledTime.toISOString(),
      status: 'scheduled',
    })
    .select()
    .single()

  if (error) {
    console.error('[email/send] DB insert failed:', error)
    return NextResponse.json({ error: 'Failed to schedule email' }, { status: 500 })
  }

  return NextResponse.json({ ...data, sent: false })
}
