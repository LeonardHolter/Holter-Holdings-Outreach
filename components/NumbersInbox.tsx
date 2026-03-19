'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
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
  if (d.length === 11 && d[0] === '1') {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return n
}

function fmtDuration(s: number | null): string {
  if (!s) return '0:00'
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function callStatusColor(status: string | null): string {
  switch (status) {
    case 'completed':   return 'text-green-400'
    case 'no-answer':   return 'text-yellow-400'
    case 'busy':        return 'text-orange-400'
    case 'failed':      return 'text-red-400'
    default:            return 'text-gray-400'
  }
}

// ── Conversation view (SMS thread for a specific "from" number) ────────────────

function Conversation({
  myNumber,
  theirNumber,
  messages,
  onSend,
}: {
  myNumber: string
  theirNumber: string
  messages: InboundMessage[]
  onSend: (body: string) => Promise<void>
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
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="px-4 py-3 border-b border-gray-800 shrink-0">
        <p className="text-white font-semibold text-sm">{fmtNumber(theirNumber)}</p>
        <p className="text-gray-500 text-xs mt-0.5">via {fmtNumber(myNumber)}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
              m.direction === 'outbound'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-800 text-gray-100 rounded-bl-sm'
            }`}>
              <p className="leading-snug">{m.body || '(no content)'}</p>
              <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-blue-300' : 'text-gray-500'}`}>
                {format(parseISO(m.created_at), 'MMM d · h:mm a')}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply input */}
      <form onSubmit={submit} className="px-4 py-3 border-t border-gray-800 flex gap-2 shrink-0">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Reply…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-40 transition-colors shrink-0"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

// ── Messages tab ─────────────────────────────────────────────────────────────

function MessagesTab({
  numbers,
  messages,
  onSend,
}: {
  numbers: string[]
  messages: InboundMessage[]
  onSend: (to: string, from: string, body: string) => Promise<void>
}) {
  const [selectedNumber, setSelectedNumber] = useState<string>(numbers[0] ?? '')
  const [selectedThread, setSelectedThread] = useState<string | null>(null)

  // Build thread list: group by {from_number} for a given to_number
  const threads: Record<string, InboundMessage[]> = {}
  for (const m of messages) {
    // Determine the "other" party (from perspective of our number)
    const isOurs = numbers.includes(m.from_number)
    const myNum  = isOurs ? m.from_number : m.to_number
    const other  = isOurs ? m.to_number   : m.from_number
    if (myNum !== selectedNumber) continue
    if (!threads[other]) threads[other] = []
    threads[other].push(m)
  }

  const threadKeys = Object.keys(threads).sort((a, b) => {
    const lastA = threads[a][threads[a].length - 1]?.created_at ?? ''
    const lastB = threads[b][threads[b].length - 1]?.created_at ?? ''
    return lastB.localeCompare(lastA)
  })

  const activeThread = selectedThread && threads[selectedThread] ? threads[selectedThread] : null

  return (
    <div className="flex gap-0 h-[calc(100dvh-200px)] min-h-80">

      {/* Left: number selector + thread list */}
      <div className="w-64 shrink-0 flex flex-col border-r border-gray-800">
        {/* Number picker */}
        {numbers.length > 1 && (
          <div className="px-3 pt-3 pb-2 shrink-0">
            <select
              value={selectedNumber}
              onChange={e => { setSelectedNumber(e.target.value); setSelectedThread(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none"
            >
              {numbers.map(n => <option key={n} value={n}>{fmtNumber(n)}</option>)}
            </select>
          </div>
        )}

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {threadKeys.length === 0 ? (
            <div className="text-center py-10 px-4">
              <p className="text-gray-600 text-sm">No messages yet</p>
              <p className="text-gray-700 text-xs mt-1">Texts to {fmtNumber(selectedNumber)} will appear here.</p>
            </div>
          ) : threadKeys.map(other => {
            const last = threads[other][threads[other].length - 1]
            const unread = threads[other].filter(m => m.direction === 'inbound').length
            return (
              <button
                key={other}
                onClick={() => setSelectedThread(other)}
                className={`w-full text-left px-4 py-3 border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors ${
                  selectedThread === other ? 'bg-gray-800/60' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-sm font-medium text-white truncate">{fmtNumber(other)}</p>
                  <span className="text-xs text-gray-600 shrink-0">
                    {format(parseISO(last.created_at), 'MMM d')}
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{last.body ?? '(media)'}</p>
                {unread > 0 && (
                  <span className="inline-block mt-1 text-xs bg-blue-600 text-white rounded-full px-1.5 py-0.5 font-medium">
                    {unread} msg{unread > 1 ? 's' : ''}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: conversation */}
      <div className="flex-1 min-w-0">
        {activeThread ? (
          <Conversation
            myNumber={selectedNumber}
            theirNumber={selectedThread!}
            messages={activeThread}
            onSend={body => onSend(selectedThread!, selectedNumber, body)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            Select a conversation
          </div>
        )}
      </div>
    </div>
  )
}

// ── Calls tab ─────────────────────────────────────────────────────────────────

function CallsTab({ numbers, calls }: { numbers: string[]; calls: InboundCall[] }) {
  const [filter, setFilter] = useState<string>(numbers[0] ?? 'all')

  const filtered = filter === 'all' ? calls : calls.filter(c => c.to_number === filter)

  return (
    <div className="space-y-4">
      {/* Number filter */}
      {numbers.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-800 hover:text-white'
            }`}
          >
            All
          </button>
          {numbers.map(n => (
            <button
              key={n}
              onClick={() => setFilter(n)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors font-mono ${
                filter === n ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-800 hover:text-white'
              }`}
            >
              {fmtNumber(n)}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📞</div>
          <p className="text-gray-500 text-sm">No incoming calls yet</p>
          <p className="text-gray-700 text-xs mt-1">Incoming calls will be logged here automatically.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800/80">
          {filtered.map(call => (
            <div key={call.id} className="px-5 py-4 flex items-center gap-4">
              {/* Icon */}
              <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                </svg>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">{fmtNumber(call.from_number)}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  to {fmtNumber(call.to_number)} · {format(parseISO(call.called_at), 'MMM d, yyyy · h:mm a')}
                </p>
              </div>

              {/* Status + duration */}
              <div className="text-right shrink-0">
                <p className={`text-xs font-medium capitalize ${callStatusColor(call.status)}`}>
                  {call.status ?? 'unknown'}
                </p>
                {call.duration_seconds != null && call.duration_seconds > 0 && (
                  <p className="text-xs text-gray-500 tabular-nums mt-0.5">{fmtDuration(call.duration_seconds)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NumbersInbox({ numbers, initialMessages, initialCalls }: Props) {
  const [tab, setTab]           = useState<'messages' | 'calls'>('messages')
  const [messages, setMessages] = useState<InboundMessage[]>(initialMessages)
  const [calls,    setCalls]    = useState<InboundCall[]>(initialCalls)

  // Real-time: subscribe to new incoming_messages and incoming_calls
  useEffect(() => {
    const supabase = createClient()

    const msgSub = supabase
      .channel('inbox-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incoming_messages' },
        payload => {
          const m = payload.new as InboundMessage
          setMessages(prev => {
            if (prev.find(x => x.id === m.id)) return prev
            return [...prev, m]
          })
          if (m.direction === 'inbound') {
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
          setCalls(prev => {
            if (prev.find(x => x.id === c.id)) return prev
            return [c, ...prev]
          })
          toast(`📞 Incoming call from ${fmtNumber(c.from_number)}`)
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

  const unreadCount = messages.filter(m => m.direction === 'inbound').length

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('messages')}
          className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'messages' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Messages
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('calls')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'calls' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Call log
        </button>
      </div>

      {/* Content */}
      {tab === 'messages' ? (
        <MessagesTab numbers={numbers} messages={messages} onSend={sendSms} />
      ) : (
        <CallsTab numbers={numbers} calls={calls} />
      )}
    </div>
  )
}
