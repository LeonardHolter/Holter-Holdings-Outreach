import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

const { AccessToken } = twilio.jwt
const { VoiceGrant } = AccessToken

const CALLERS  = ['Leonard', 'Tommaso', 'John', 'Sunzim', 'Daniel', 'Ellison']
const DAILY_CAP = 80

/** Day-of-year (1–365) drives the rotation offset so it shifts automatically each day. */
function dayOfYear(): number {
  const now   = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Returns the best number for this caller today.
 *
 * Each caller gets a dedicated number so concurrent callers never share
 * the same outbound caller ID (which causes Twilio to drop the second call).
 *
 * 1. Base assignment = (callerIndex + dayOfYear) % numCount → daily rotation
 * 2. If base number is at/over DAILY_CAP, try next numbers in order
 * 3. If all numbers are capped, fall back to base anyway
 */
async function assignNumber(callerName: string): Promise<{
  callerId: string
  usageToday: number
  dailyCap: number
  allUsage: { number: string; count: number }[]
}> {
  const numbers = (process.env.TWILIO_PHONE_NUMBERS ?? '')
    .split(',').map(n => n.trim()).filter(Boolean)
  if (numbers.length === 0) throw new Error('TWILIO_PHONE_NUMBERS is not set')

  const callerIdx = CALLERS.findIndex(c => c.toLowerCase() === callerName.toLowerCase())
  const idx       = callerIdx >= 0 ? callerIdx : 0
  const baseIdx   = (idx + dayOfYear()) % numbers.length

  // Fetch today's usage for all numbers in one query
  const today   = new Date().toISOString().slice(0, 10)
  const supabase = await createClient()
  const { data } = await supabase
    .from('number_daily_usage')
    .select('number, dial_count')
    .eq('date', today)

  const usageMap: Record<string, number> = {}
  for (const row of data ?? []) usageMap[row.number] = row.dial_count

  // Pick lowest-loaded number starting from base rotation
  let chosenIdx = baseIdx
  for (let i = 0; i < numbers.length; i++) {
    const candidate = (baseIdx + i) % numbers.length
    if ((usageMap[numbers[candidate]] ?? 0) < DAILY_CAP) {
      chosenIdx = candidate
      break
    }
  }

  const chosen = numbers[chosenIdx]
  const allUsage = numbers.map(n => ({ number: n, count: usageMap[n] ?? 0 }))

  return { callerId: chosen, usageToday: usageMap[chosen] ?? 0, dailyCap: DAILY_CAP, allUsage }
}

export async function POST(request: NextRequest) {
  const accountSid  = process.env.TWILIO_ACCOUNT_SID
  const apiKey      = process.env.TWILIO_API_KEY
  const apiSecret   = process.env.TWILIO_API_SECRET
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json({ error: 'Twilio env vars missing' }, { status: 500 })
  }

  const { callerName, clientId } = await request.json()

  // Build a unique identity per browser tab so two people (or two tabs)
  // never collide on the same Twilio Device registration.
  // Twilio only allows ONE registered Device per identity — a second
  // registration silently unregisters the first, killing its active call.
  const baseName = (callerName ?? 'user').replace(/\s+/g, '-').toLowerCase()
  const suffix = clientId
    ? String(clientId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12)
    : crypto.randomBytes(4).toString('hex')
  const identity = `${baseName}_${suffix}`

  let assignment: Awaited<ReturnType<typeof assignNumber>>
  try {
    assignment = await assignNumber(callerName ?? '')
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const grant = new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true })
  const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 })
  token.addGrant(grant)

  return NextResponse.json({
    token:      token.toJwt(),
    callerId:   assignment.callerId,
    usageToday: assignment.usageToday,
    dailyCap:   assignment.dailyCap,
    allUsage:   assignment.allUsage,
    identity,
  })
}
