import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Twilio posts here when a recording is ready (async, 30-60s after call ends).
// We save the recording metadata to call_recordings and link it to the company.
export async function POST(request: NextRequest) {
  const formData = await request.formData()

  const callSid      = formData.get('CallSid')           as string
  const recordingSid = formData.get('RecordingSid')       as string
  const recordingUrl = formData.get('RecordingUrl')       as string
  const duration     = formData.get('RecordingDuration')  as string

  // callerName + callerNumber were embedded in the callback URL by the voice webhook
  const callerName   = request.nextUrl.searchParams.get('callerName')   ?? null
  const callerNumber = request.nextUrl.searchParams.get('callerNumber') ?? null

  if (!callSid || !recordingUrl) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const supabase = await createClient()

  // Find the company that owns this callSid
  const { data: company } = await supabase
    .from('companies')
    .select('id, who_called')
    .eq('last_call_sid', callSid)
    .single()

  const row = {
    call_sid:         callSid,
    recording_url:    `${recordingUrl}.mp3`,
    duration_seconds: duration ? parseInt(duration, 10) : null,
    called_by:        callerName ?? company?.who_called ?? null,
    caller_name:      callerName,
    caller_number:    callerNumber,
  }

  if (company) {
    await supabase.from('call_recordings').insert({ company_id: company.id, ...row })
  } else {
    console.warn(`Recording ${callSid} could not be matched to a company — saving without company_id`)
  }

  console.log(`Recording saved: ${recordingSid} for call ${callSid} by ${callerName ?? 'unknown'}`)
  return NextResponse.json({ ok: true })
}
