import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const { data: pending, error: fetchErr } = await supabase
    .from('scheduled_emails')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (fetchErr) {
    console.error('[email/process] Fetch failed:', fetchErr)
    return NextResponse.json({ error: 'Failed to fetch pending emails' }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const email of pending) {
    try {
      await sendEmail({
        to: email.to_email,
        subject: email.subject,
        body: email.body,
        fromName: 'Holter Holdings',
      })

      await supabase
        .from('scheduled_emails')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', email.id)

      sent++
    } catch (err) {
      console.error(`[email/process] Failed to send ${email.id}:`, err)

      await supabase
        .from('scheduled_emails')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
        .eq('id', email.id)

      failed++
    }
  }

  return NextResponse.json({ processed: pending.length, sent, failed })
}
