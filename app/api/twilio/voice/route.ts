import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { query } from '@/lib/db'

const VoiceResponse = twilio.twiml.VoiceResponse

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const to = formData.get('To') as string | null
  const callerIdParam = formData.get('CallerId') as string | null
  const callerName = formData.get('CallerName') as string | null

  if (!to) return new NextResponse('Missing To parameter', { status: 400 })

  const numbers = (process.env.TWILIO_PHONE_NUMBERS ?? '').split(',').map(n => n.trim()).filter(Boolean)
  let callerId = callerIdParam ?? numbers[0] ?? undefined

  if (callerId && callerName) {
    try {
      
      const locks = await query(
        'SELECT number, caller_name FROM number_locks WHERE expires_at > $1',
        [new Date().toISOString()]
      )

      const lockedByOthers = new Set(
        locks
          .filter(l => (l.caller_name as string).toLowerCase() !== callerName.toLowerCase())
          .map(l => l.number as string)
      )

      if (lockedByOthers.has(callerId)) {
        const free = numbers.find(n => !lockedByOthers.has(n))
        if (free) {
          console.warn(`[voice] Number ${callerId} locked, switching to ${free} for ${callerName}`)
          callerId = free
        }
      }

      try {
        await query(
          `INSERT INTO number_locks (number, caller_name, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (number) DO UPDATE SET caller_name = $2, expires_at = $3`,
          [callerId, callerName.toLowerCase(), new Date(Date.now() + 2 * 60 * 1000).toISOString()]
        )
      } catch {
        // non-fatal
      }
    } catch {
      // Lock check failed — proceed with original number
    }
  }

  if (callerId) {
    const today = new Date().toISOString().slice(0, 10)
    
    query(
      `INSERT INTO number_daily_usage (number, date, dial_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (number, date) DO UPDATE SET dial_count = number_daily_usage.dial_count + 1`,
      [callerId, today]
    ).catch(err => console.warn('Usage tracking failed:', err))
  }

  const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`

  const cbParams = new URLSearchParams()
  if (callerName) cbParams.set('callerName', callerName)
  if (callerId) cbParams.set('callerNumber', callerId)
  // Pass the dialed number so the recording webhook can match the company
  // even when no last_call_sid link exists
  cbParams.set('to', to)
  const recordingCb = `${baseUrl}/api/twilio/recording-webhook?${cbParams.toString()}`

  const twiml = new VoiceResponse()
  const dial = twiml.dial({
    callerId,
    record: 'record-from-answer',
    recordingStatusCallback: recordingCb,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
    trim: 'trim-silence',
  })
  dial.number(to)

  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
