import { NextResponse } from 'next/server'

interface SkipCallsResult {
  number: string
  isSpam: boolean
  reportCount: number
  lastReported: string | null
}

interface NumberHealth extends SkipCallsResult {
  raw: string  // original E.164 number
  error?: string
}

async function checkOne(e164: string): Promise<NumberHealth> {
  // SkipCalls expects just digits, no + prefix
  const digits = e164.replace(/\D/g, '')
  try {
    const res = await fetch(`https://spam.skipcalls.app/check/${digits}`, {
      headers: { 'User-Agent': 'HolterHoldings-Outreach/1.0' },
      // 8-second timeout
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { raw: e164, number: digits, isSpam: false, reportCount: 0, lastReported: null, error: `HTTP ${res.status}` }
    const data: SkipCallsResult = await res.json()
    return { ...data, raw: e164 }
  } catch (err) {
    return { raw: e164, number: digits, isSpam: false, reportCount: 0, lastReported: null, error: String(err) }
  }
}

export async function GET() {
  const numbers = (process.env.TWILIO_PHONE_NUMBERS ?? '')
    .split(',').map(n => n.trim()).filter(Boolean)

  if (numbers.length === 0) {
    return NextResponse.json({ error: 'TWILIO_PHONE_NUMBERS not set' }, { status: 500 })
  }

  const results = await Promise.all(numbers.map(checkOne))
  return NextResponse.json(results)
}
