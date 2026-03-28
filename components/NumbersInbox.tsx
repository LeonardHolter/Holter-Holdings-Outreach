'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InboundMessage {
  id: string
  twilio_sid: string | null
  from_number: string
  to_number: string
  body: string | null
  direction: 'inbound' | 'outbound'
  status: string
  created_at: string
}

interface InboundCall {
  id: string
  twilio_sid: string | null
  from_number: string
  to_number: string
  status: string | null
  duration_seconds: number | null
  called_at: string
}

interface Props {
  numbers: string[]
  initialMessages: InboundMessage[]
  initialCalls: InboundCall[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNumber(n: string): string {
  const d = n.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return n
}

function fmtDuration(s: number | null): string {
  if (!s) return '0:00'
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtTime(dateStr: string): string {
  try {
    const d = parseISO(dateStr)
    if (isToday(d)) return format(d, 'h:mm a')
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'MMM d')
  } catch { return '' }
}

function fmtFull(dateStr: string): string {
  try { return format(parseISO(dateStr), 'MMM d, yyyy · h:mm a') } catch { return dateStr }
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function SummaryCards({
  inboundMessages,
  inboundCalls,
  newCount,
}: {
  inboundMessages: number
  inboundCalls: number
  newCount: number
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">New</p>
        <p className={`text-xl font-bold tabular-nums mt-0.5 ${newCount > 0 ? 'text-blue-400' : 'text-gray-400'}`}>{newCount}</p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Messages</p>
        <p className="text-xl font-bold tabular-nums mt-0.5 text-white">{inboundMessages}</p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Calls</p>
        <p className="text-xl font-bold tabular-nums mt-0.5 text-white">{inboundCalls}</p>
      </div>
    </div>
  )
}

// ── Activity feed item ────────────────────────────────────────────────────────

function ActivityItem({
  type,
  from,
  to,
  body,
  time,
  duration,
  status,
  isNew,
  onClick,
}: {
  type: 'sms' | 'call'
  from: string
  to: string
  body?: string | null
  time: string
  duration?: number | null
  status?: string | null
  isNew: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors ${
        isNew ? 'bg-blue-950/20 hover:bg-blue-950/30' : 'hover:bg-gray-800/40'
      }`}
    >
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        type === 'sms' ? 'bg-purple-900/50 text-purple-400' : 'bg-green-900/50 text-green-400'
      }`}>
        {type === 'sms' ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-white truncate">{fmtNumber(from)}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            {isNew && <span className="w-2 h-2 rounded-full bg-blue-500" />}
            <span className="text-xs text-gray-500">{fmtTime(time)}</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">to {fmtNumber(to)}</p>
        {type === 'sms' && body && (
          <p className="text-sm text-gray-400 mt-1 line-clamp-2">{body}</p>
        )}
        {type === 'call' && (
          <p className="text-sm text-gray-400 mt-1">
            <span className={
              status === 'completed' ? 'text-green-400'
                : status === 'no-answer' ? 'text-yellow-400'
                : status === 'busy' ? 'text-orange-400'
                : status === 'failed' ? 'text-red-400'
                : 'text-gray-400'
            }>
              {status ?? 'unknown'}
            </span>
            {duration != null && duration > 0 && (
              <span className="text-gray-600"> · {fmtDuration(duration)}</span>
            )}
          </p>
        )}
      </div>
    </button>
  )
}

// ── Conversation view ─────────────────────────────────────────────────────────

function ConversationView({
  myNumber,
  theirNumber,
  messages,
  onSend,
  onBack,
}: {
  myNumber: string
  theirNumber: string
  messages: InboundMessage[]
  onSend: (body: string) => Promise<void>
  onBack: () => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      await onSend(draft.trim())
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-200px)] min-h-80 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors p-1 -ml-1">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p className="text-white font-semibold text-sm">{fmtNumber(theirNumber)}</p>
          <p className="text-gray-500 text-xs">via {fmtNumber(myNumber)}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm ${
              m.direction === 'outbound'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-800 text-gray-100 rounded-bl-sm'
            }`}>
              <p className="leading-snug">{m.body || '(no content)'}</p>
              <p className={`text-xs mt-1.5 ${m.direction === 'outbound' ? 'text-blue-300' : 'text-gray-500'}`}>
                {fmtFull(m.created_at)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply */}
      <form onSubmit={submit} className="px-4 py-3 border-t border-gray-800 flex gap-2 shrink-0">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Reply..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-40 transition-colors shrink-0"
        >
          {sending ? '...' : 'Send'}
        </button>
      </form>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NumbersInbox({ numbers, initialMessages, initialCalls }: Props) {
  const [messages, setMessages] = useState<InboundMessage[]>(initialMessages)
  const [calls, setCalls] = useState<InboundCall[]>(initialCalls)
  const [openThread, setOpenThread] = useState<{ their: string; my: string } | null>(null)
  // Track IDs that arrived via realtime (truly new while user is on this page)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  // Real-time subscriptions
  useEffect(() => {
    const supabase = createClient()

    const msgSub = supabase
      .channel('inbox-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incoming_messages' },
        payload => {
          const m = payload.new as InboundMessage
          setMessages(prev => prev.find(x => x.id === m.id) ? prev : [...prev, m])
          if (m.direction === 'inbound') {
            setNewIds(prev => new Set(prev).add(`msg-${m.id}`))
            toast(`New text from ${fmtNumber(m.from_number)}`, { description: m.body ?? '' })
          }
        }
      )
      .subscribe()

    const callSub = supabase
      .channel('inbox-calls')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incoming_calls' },
        payload => {
          const c = payload.new as InboundCall
          setCalls(prev => prev.find(x => x.id === c.id) ? prev : [c, ...prev])
          setNewIds(prev => new Set(prev).add(`call-${c.id}`))
          toast(`Incoming call from ${fmtNumber(c.from_number)}`)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(msgSub)
      supabase.removeChannel(callSub)
    }
  }, [])

  async function sendSms(to: string, from: string, body: string) {
    const res = await fetch('/api/twilio/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from, body }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      toast.error(`Failed to send: ${error}`)
      throw new Error(error)
    }
    toast.success('Message sent')
  }

  // Build unified activity feed
  const inboundMsgs = messages.filter(m => m.direction === 'inbound')
  const feed: Array<{
    id: string; type: 'sms' | 'call'; from: string; to: string;
    body?: string | null; time: string; duration?: number | null;
    status?: string | null; isNew: boolean
  }> = []

  for (const m of inboundMsgs) {
    const fid = `msg-${m.id}`
    feed.push({
      id: fid, type: 'sms', from: m.from_number, to: m.to_number,
      body: m.body, time: m.created_at, isNew: newIds.has(fid),
    })
  }
  for (const c of calls) {
    const fid = `call-${c.id}`
    feed.push({
      id: fid, type: 'call', from: c.from_number, to: c.to_number,
      time: c.called_at, duration: c.duration_seconds, status: c.status,
      isNew: newIds.has(fid),
    })
  }

  feed.sort((a, b) => b.time.localeCompare(a.time))
  const newCount = feed.filter(f => f.isNew).length

  // Thread lookup for opening conversations
  function openConversation(from: string, to: string) {
    setOpenThread({ their: from, my: to })
  }

  function getThreadMessages(their: string, my: string): InboundMessage[] {
    return messages.filter(m => {
      const isOurs = numbers.includes(m.from_number)
      const myNum = isOurs ? m.from_number : m.to_number
      const other = isOurs ? m.to_number : m.from_number
      return myNum === my && other === their
    }).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  // Conversation view
  if (openThread) {
    const threadMsgs = getThreadMessages(openThread.their, openThread.my)
    return (
      <ConversationView
        myNumber={openThread.my}
        theirNumber={openThread.their}
        messages={threadMsgs}
        onSend={body => sendSms(openThread.their, openThread.my, body)}
        onBack={() => setOpenThread(null)}
      />
    )
  }

  // Main view
  return (
    <div className="space-y-4">
      <SummaryCards
        inboundMessages={inboundMsgs.length}
        inboundCalls={calls.length}
        newCount={newCount}
      />

      {/* Activity feed */}
      {feed.length === 0 ? (
        <div className="text-center py-16">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-700 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-gray-500 text-sm">No activity yet</p>
          <p className="text-gray-700 text-xs mt-1">Incoming calls and texts will show up here.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800/60">
          {feed.map(item => (
            <ActivityItem
              key={item.id}
              type={item.type}
              from={item.from}
              to={item.to}
              body={item.body}
              time={item.time}
              duration={item.duration}
              status={item.status}
              isNew={item.isNew}
              onClick={item.type === 'sms' ? () => openConversation(item.from, item.to) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
