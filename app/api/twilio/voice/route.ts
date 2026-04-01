import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

const VoiceResponse = twilio.twiml.VoiceResponse

// Twilio calls this webhook when the browser places an outbound call.
// It returns TwiML that dials the target number and records the call.
// It also atomically increments today's dial counter for the chosen number.
export async function POST(request: NextRequest) {
  const formData      = await request.formData()
  const to            = formData.get('To')         as string | null
  const callerIdParam = formData.get('CallerId')   as string | null
  const callerName    = formData.get('CallerName') as string | null

  if (!to) return new NextResponse('Missing To parameter', { status: 400 })

  const numbers  = (process.env.TWILIO_PHONE_NUMBERS ?? '').split(',').map(n => n.trim()).filter(Boolean)
  let callerId = callerIdParam ?? numbers[0] ?? undefined

  // If the requested caller ID is locked by someone else, pick a free number.
  // This is a safety net — the token route should already assign unique numbers,
  // but races can happen if two callers init nearly simultaneously.
  if (callerId && callerName) {
    try {
      const supabase = await createClient()
      const { data: locks } = await supabase
        .from('number_locks')
        .select('number, caller_name')
        .gt('expires_at', new Date().toISOString())

      const lockedByOthers = new Set(
        (locks ?? [])
          .filter(l => l.caller_name.toLowerCase() !== callerName.toLowerCase())
          .map(l => l.number)
      )

      if (lockedByOthers.has(callerId)) {
        // Requested number is busy — pick a free one
        const free = numbers.find(n => !lockedByOthers.has(n))
        if (free) {
          console.warn(`[voice] Number ${callerId} locked, switching to ${free} for ${callerName}`)
          callerId = free
        }
      }

      // Refresh the lock for this caller's number (extends the 2-min lease)
      try {
        await supabase
          .from('number_locks')
          .upsert({
            number: callerId,
            caller_name: callerName.toLowerCase(),
            expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          }, { onConflict: 'number' })
      } catch {
        // non-fatal
      }
    } catch {
      // Lock check failed — proceed with the original number
    }
  }

  // Increment daily dial count for this number (fire-and-forget, non-blocking)
  if (callerId) {
    const today = new Date().toISOString().slice(0, 10)
    createClient().then(supabase =>
      supabase.rpc('increment_number_usage', { p_number: callerId, p_date: today })
    ).catch(err => console.warn('Usage tracking failed:', err))
  }

  const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`

  const cbParams = new URLSearchParams()
  if (callerName)  cbParams.set('callerName', callerName)
  if (callerId)    cbParams.set('callerNumber', callerId)
  const recordingCb = `${baseUrl}/api/twilio/recording-webhook?${cbParams.toString()}`

  const twiml = new VoiceResponse()
  const dial  = twiml.dial({
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
