import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
)

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
})

const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

function buildMimeMessage({
  to,
  subject,
  body,
  fromName,
  fromEmail,
}: {
  to: string
  subject: string
  body: string
  fromName?: string
  fromEmail: string
}): string {
  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ]
  return lines.join('\r\n')
}

export async function sendEmail({
  to,
  subject,
  body,
  fromName,
}: {
  to: string
  subject: string
  body: string
  fromName?: string
}): Promise<{ messageId: string }> {
  const fromEmail = process.env.GMAIL_SENDER_EMAIL
  if (!fromEmail) throw new Error('GMAIL_SENDER_EMAIL not configured')

  const raw = buildMimeMessage({ to, subject, body, fromName, fromEmail })
  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  })

  return { messageId: res.data.id ?? '' }
}
