'use client'

import { useEffect, useRef, useState } from 'react'
import { Nav } from '@/components/Nav'

const TEAM_MEMBERS = ['Leonard', 'Tommaso', 'John', 'Sunzim', 'Daniel', 'Ellison']
const STORAGE_KEY = 'quickAddUser'

interface ParsedCompany {
  company_name: string
  phone_number: string | null
  state: string | null
  google_reviews: number | null
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  text?: string
  company?: ParsedCompany & { id: string }
}

function CompanyCard({ company }: { company: ParsedCompany & { id: string } }) {
  return (
    <div className="bg-gray-800 border border-green-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white font-semibold">{company.company_name}</p>
          {company.state && (
            <span className="inline-block mt-1 text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{company.state}</span>
          )}
        </div>
        <span className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-green-950/60 border border-green-800/50 rounded-full text-xs text-green-400 font-medium">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Added to pipeline
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {company.phone_number && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Phone</p>
            <p className="text-gray-200 font-mono mt-0.5">{company.phone_number}</p>
          </div>
        )}
        {company.google_reviews != null && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Reviews</p>
            <p className="text-gray-200 mt-0.5">{company.google_reviews.toLocaleString()}</p>
          </div>
        )}
      </div>
      <a
        href={`/?search=${encodeURIComponent(company.company_name)}`}
        className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        View in pipeline →
      </a>
    </div>
  )
}

export default function QuickAddPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Paste a Google Maps listing below and I'll extract the company details and add it to the pipeline automatically.",
    },
  ])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [addedBy, setAddedBy] = useState<string>('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && TEAM_MEMBERS.includes(stored)) setAddedBy(stored)
  }, [])

  function handleAddedByChange(name: string) {
    setAddedBy(name)
    localStorage.setItem(STORAGE_KEY, name)
  }

  function scrollBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  async function submit() {
    const text = draft.trim()
    if (!text || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text }
    setMessages(prev => [...prev, userMsg])
    setDraft('')
    setLoading(true)
    scrollBottom()

    try {
      const res = await fetch('/api/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, added_by: addedBy || null }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'error',
          text: data.error ?? 'Something went wrong.',
        }])
      } else {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          company: data.company,
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'error',
        text: 'Network error — please try again.',
      }])
    } finally {
      setLoading(false)
      scrollBottom()
      textareaRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-950">
      <Nav />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-2xl w-full mx-auto">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && !m.company && (
              <div className="max-w-[85%] bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-300 leading-relaxed">
                {m.text}
              </div>
            )}
            {m.role === 'assistant' && m.company && (
              <div className="max-w-[85%] w-full">
                <CompanyCard company={m.company} />
              </div>
            )}
            {m.role === 'user' && (
              <div className="max-w-[85%] bg-blue-600 rounded-2xl rounded-br-sm px-4 py-3 text-sm text-white whitespace-pre-wrap leading-relaxed">
                {m.text}
              </div>
            )}
            {m.role === 'error' && (
              <div className="max-w-[85%] bg-red-950/60 border border-red-800/60 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-red-300 leading-relaxed">
                ⚠ {m.text}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-800 bg-gray-900 px-4 py-3 safe-bottom">
        <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">Adding as</span>
          <div className="flex flex-wrap gap-1.5">
            {TEAM_MEMBERS.map(name => (
              <button
                key={name}
                onClick={() => handleAddedByChange(name)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  addedBy === name
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste a Google Maps listing here…"
            rows={3}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 resize-none leading-relaxed"
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || loading}
            className="flex flex-col items-center justify-center gap-1 px-4 py-3 h-[76px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors touch-manipulation shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Add
          </button>
        </div>
        <p className="text-xs text-gray-600 text-center mt-2">⌘↵ to submit · paste multiple companies one at a time</p>
      </div>
    </div>
  )
}
