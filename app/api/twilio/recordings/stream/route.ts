import { NextRequest, NextResponse } from 'next/server'

// Proxies a Twilio recording URL through our server so the browser
// never needs to send Twilio Basic-auth credentials directly.
// Supports Range requests so the browser can determine duration and seek.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url param', { status: 400 })

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    return new NextResponse('Twilio credentials not configured', { status: 500 })
  }

  if (!url.startsWith('https://api.twilio.com/')) {
    return new NextResponse('Invalid recording URL', { status: 400 })
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const upstreamHeaders: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
  }

  const rangeHeader = request.headers.get('Range')
  if (rangeHeader) {
    upstreamHeaders['Range'] = rangeHeader
  }

  const upstream = await fetch(url, { headers: upstreamHeaders })

  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse(`Twilio returned ${upstream.status}`, { status: 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'audio/mpeg')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('Accept-Ranges', 'bytes')

  const cl = upstream.headers.get('Content-Length')
  if (cl) headers.set('Content-Length', cl)

  const cr = upstream.headers.get('Content-Range')
  if (cr) headers.set('Content-Range', cr)

  return new NextResponse(upstream.body, { status: upstream.status, headers })
}
