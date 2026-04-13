'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'

interface Props {
  company: Company
  onClose: () => void
  onSent: () => void
}

function buildDefaultBody(company: Company): string {
  const ownerFirst = company.owners_name?.split(/\s+/)[0] || 'there'
  const companyName = company.company_name || 'your company'
  return `Hi ${ownerFirst},

My name is Leonard, I'm the owner of a small family office in NY that is looking to buy an overhead door company just like ${companyName}. Have you ever considered selling? If so, please shoot me an email back!

Best,
Leonard`
}

export default function EmailComposeModal({ company, onClose, onSent }: Props) {
  const defaultDate = company.next_reach_out || format(new Date(), 'yyyy-MM-dd')

  const [to, setTo] = useState(company.email || '')
  const [subject, setSubject] = useState(`Follow-up: ${company.company_name}`)
  const [body, setBody] = useState(() => buildDefaultBody(company))
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('09:00')
  const [sending, setSending] = useState(false)

  async function handleSubmit(sendNow: boolean) {
    if (!to.trim()) { toast.error('Recipient email is required'); return }
    if (!subject.trim()) { toast.error('Subject is required'); return }
    if (!body.trim()) { toast.error('Email body is required'); return }

    setSending(true)
    try {
      const scheduledAt = sendNow
        ? new Date().toISOString()
        : new Date(`${date}T${time}:00`).toISOString()

      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          scheduledAt,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      if (data.sent) {
        toast.success('Email sent!')
      } else {
        toast.success(`Email scheduled for ${format(new Date(`${date}T${time}`), 'MMM d, h:mm a')}`)
      }
      onSent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Email {company.company_name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* To */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">To</label>
            <input
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="email@company.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject line"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              placeholder="Write your email..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-600 leading-relaxed"
            />
          </div>

          {/* Schedule date/time */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Schedule for</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-600 [color-scheme:dark]"
              />
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-600 [color-scheme:dark]"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-800">
          <button
            onClick={() => handleSubmit(false)}
            disabled={sending}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {sending ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            Schedule
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={sending}
            className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            Send now
          </button>
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2.5 rounded-xl text-gray-500 hover:text-gray-300 text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
