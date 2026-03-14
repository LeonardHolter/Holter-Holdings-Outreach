import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

const VoiceResponse = twilio.twiml.VoiceResponse

// Twilio calls this webhook when the browser places an outbound call.
// It returns TwiML that dials the target number and records the call.
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const to       = formData.get('To')   as string | null
  const from     = formData.get('From') as string | null

  if (!to) {
    return new NextResponse('Missing To parameter', { status: 400 })
  }

  const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`

  const twiml = new VoiceResponse()
  const dial  = twiml.dial({
    callerId: from ?? undefined,
    record: 'record-from-answer',
    recordingStatusCallback: `${baseUrl}/api/twilio/recording-webhook`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
    trim: 'trim-silence',
  })
  dial.number(to)

  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
