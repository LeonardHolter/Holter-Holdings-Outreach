import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import twilio from 'twilio'
import { query } from '@/lib/db'

const { AccessToken } = twilio.jwt
const { VoiceGrant } = AccessToken

const CALLERS = ['Leonard', 'William']
const DAILY_CAP = 80

function dayOfYear(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000)
}

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
  const idx = callerIdx >= 0 ? callerIdx : 0
  const baseIdx = (idx + dayOfYear()) % numbers.length

  
  const today = new Date().toISOString().slice(0, 10)

  const usageData = await query(
    'SELECT number, dial_count FROM number_daily_usage WHERE date = $1',
    [today]
  )
  const usageMap: Record<string, number> = {}
  for (const row of usageData) usageMap[row.number as string] = row.dial_count as number

  const lockData = await query(
    'SELECT number, caller_name FROM number_locks WHERE expires_at > $1',
    [new Date().toISOString()]
  )
  const lockedByOthers = new Set(
    lockData
      .filter(l => (l.caller_name as string).toLowerCase() !== callerName.toLowerCase())
      .map(l => l.number as string)
  )

  let chosenIdx = baseIdx
  let found = false
  for (let i = 0; i < numbers.length; i++) {
    const candidate = (baseIdx + i) % numbers.length
    const num = numbers[candidate]
    if (!lockedByOthers.has(num) && (usageMap[num] ?? 0) < DAILY_CAP) {
      chosenIdx = candidate
      found = true
      break
    }
  }
  if (!found) chosenIdx = baseIdx

  const chosen = numbers[chosenIdx]

  try {
    await query(
      `INSERT INTO number_locks (number, caller_name, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (number) DO UPDATE SET caller_name = $2, expires_at = $3`,
      [chosen, callerName.toLowerCase(), new Date(Date.now() + 2 * 60 * 1000).toISOString()]
    )
  } catch {
    // non-fatal
  }

  const allUsage = numbers.map(n => ({ number: n, count: usageMap[n] ?? 0 }))
  return { callerId: chosen, usageToday: usageMap[chosen] ?? 0, dailyCap: DAILY_CAP, allUsage }
}

export async function POST(request: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json({ error: 'Twilio env vars missing' }, { status: 500 })
  }

  const { callerName, clientId } = await request.json()

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
    token: token.toJwt(),
    callerId: assignment.callerId,
    usageToday: assignment.usageToday,
    dailyCap: assignment.dailyCap,
    allUsage: assignment.allUsage,
    identity,
  })
}
