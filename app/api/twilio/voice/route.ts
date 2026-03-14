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
  const callerId = callerIdParam ?? numbers[0] ?? undefined

  // Increment daily dial count for this number (fire-and-forget, non-blocking)
  if (callerId) {
    const today = new Date().toISOString().slice(0, 10)
    createClient().then(supabase =>
      supabase.rpc('increment_number_usage', { p_number: callerId, p_date: today })
    ).catch(err => console.warn('Usage tracking failed:', err))
  }

  const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`

  // Embed callerName + callerId into the callback URL so the recording webhook
  // knows who made the call when it fires 30-60s later
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
