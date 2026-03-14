import { NextRequest, NextResponse } from 'next/server'

// Proxies a Twilio recording URL through our server so the browser
// never needs to send Twilio Basic-auth credentials directly.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url param', { status: 400 })

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    return new NextResponse('Twilio credentials not configured', { status: 500 })
  }

  // Ensure the URL points to Twilio's API domain for security
  if (!url.startsWith('https://api.twilio.com/')) {
    return new NextResponse('Invalid recording URL', { status: 400 })
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const upstream = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}` },
  })

  if (!upstream.ok) {
    return new NextResponse(`Twilio returned ${upstream.status}`, { status: 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'audio/mpeg')
  const cl = upstream.headers.get('Content-Length')
  if (cl) headers.set('Content-Length', cl)
  headers.set('Cache-Control', 'private, max-age=3600')

  return new NextResponse(upstream.body, { status: 200, headers })
}
