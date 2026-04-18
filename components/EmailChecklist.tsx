'use client'

import { useState, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import type { Company, CompanyWithRecording } from '@/types'

interface Props {
  initialCompanies: CompanyWithRecording[]
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000

function isEmailedRecently(emailedAt: string | null): boolean {
  if (!emailedAt) return false
  return Date.now() - new Date(emailedAt).getTime() < TWO_WEEKS_MS
}

async function patchCompany(id: string, payload: Partial<Company>) {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to save')
  return res.json() as Promise<Company>
}

function streamUrl(raw: string) {
  return `/api/twilio/recordings/stream?url=${encodeURIComponent(raw)}`
}

// ── Inline audio player ───────────────────────────────────────

function AudioRow({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause() } else { a.play() }
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const a = audioRef.current
    if (!a || !duration) return
    const t = (Number(e.target.value) / 100) * duration
    a.currentTime = t
    setProgress(Number(e.target.value))
  }

  return (
    <div className="mt-2 flex items-center gap-2 px-1" onClick={e => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onTimeUpdate={() => {
          const a = audioRef.current
          if (a && a.duration) setProgress((a.currentTime / a.duration) * 100)
        }}
      />
      <button
        onClick={togglePlay}
        className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center transition-colors"
      >
        {playing ? (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0} max={100} step={0.1}
        value={progress}
        onChange={handleScrub}
        className="flex-1 h-1 accent-indigo-500 cursor-pointer"
      />
      <span className="shrink-0 text-xs text-gray-500 tabular-nums w-10 text-right">
        {duration > 0 ? fmt((progress / 100) * duration) : '—'}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────

export function EmailChecklist({ initialCompanies }: Props) {
  const [companies, setCompanies] = useState<CompanyWithRecording[]>(initialCompanies)
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [showChecked, setShowChecked] = useState(true)
  const [expandedAudio, setExpandedAudio] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const emailedCount = useMemo(
    () => companies.filter(c => isEmailedRecently(c.emailed_at)).length,
    [companies]
  )

  const filtered = useMemo(() => {
    let list = companies
    if (!showChecked) list = list.filter(c => !isEmailedRecently(c.emailed_at))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(c =>
        c.company_name.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.state ?? '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      const ac = isEmailedRecently(a.emailed_at) ? 1 : 0
      const bc = isEmailedRecently(b.emailed_at) ? 1 : 0
      if (ac !== bc) return ac - bc
      return a.company_name.localeCompare(b.company_name)
    })
  }, [companies, search, showChecked])

  async function handleToggle(company: CompanyWithRecording) {
    const wasEmailed = isEmailedRecently(company.emailed_at)
    const newEmailedAt = wasEmailed ? null : new Date().toISOString()

    setToggling(s => new Set(s).add(company.id))
    setCompanies(prev =>
      prev.map(c => c.id === company.id ? { ...c, emailed_at: newEmailedAt } : c)
    )

    try {
      const updated = await patchCompany(company.id, { emailed_at: newEmailedAt })
      setCompanies(prev => prev.map(c => c.id === company.id ? { ...c, ...updated } : c))
    } catch {
      setCompanies(prev => prev.map(c => c.id === company.id ? company : c))
      toast.error('Failed to save')
    } finally {
      setToggling(s => { const n = new Set(s); n.delete(company.id); return n })
    }
  }

  async function handleCopyEmail(e: React.MouseEvent, company: CompanyWithRecording) {
    e.stopPropagation()
    if (!company.email) return
    try {
      await navigator.clipboard.writeText(company.email)
      setCopiedId(company.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      toast.error('Could not copy — try manually')
    }
  }

  function handleToggleAudio(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setExpandedAudio(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const resetDate = useMemo(() => {
    const emailedDates = companies
      .map(c => c.emailed_at)
      .filter(Boolean)
      .map(d => new Date(d!).getTime())
    if (emailedDates.length === 0) return null
    const oldest = Math.min(...emailedDates)
    return new Date(oldest + TWO_WEEKS_MS)
  }, [companies])

  return (
    <div className="space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">Email List</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {emailedCount} / {companies.length} emailed
              {resetDate && (
                <span className="ml-2 text-gray-600">
                  · resets {resetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </p>
          </div>
          <div className="shrink-0 relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f2937" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.9" fill="none"
                stroke="#3b82f6" strokeWidth="3"
                strokeDasharray={`${companies.length > 0 ? (emailedCount / companies.length) * 100 : 0} 100`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
              {companies.length > 0 ? Math.round((emailedCount / companies.length) * 100) : 0}%
            </span>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search company or email…"
              className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={() => setShowChecked(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors shrink-0 ${
              showChecked
                ? 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
                : 'border-blue-700 bg-blue-950/40 text-blue-300'
            }`}
          >
            {showChecked ? 'Hide done' : 'Show done'}
          </button>
        </div>

        {/* 2-week reset notice */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg">
          <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <p className="text-xs text-gray-500">
            Checkboxes auto-reset 2 weeks after being checked — no manual action needed.
          </p>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <svg className="w-8 h-8 mx-auto mb-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">{search ? 'No matches' : 'All emailed — great work!'}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map(company => {
              const checked = isEmailedRecently(company.emailed_at)
              const loading = toggling.has(company.id)
              const audioOpen = expandedAudio.has(company.id)
              const copied = copiedId === company.id
              const recUrl = company.latestRecordingUrl ? streamUrl(company.latestRecordingUrl) : null

              return (
                <div
                  key={company.id}
                  className={`rounded-xl border transition-all ${
                    checked
                      ? 'bg-gray-900/40 border-gray-800 opacity-60'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-3 px-4 py-3">

                    {/* Checkbox */}
                    <button
                      onClick={() => handleToggle(company)}
                      disabled={loading}
                      className="shrink-0 touch-manipulation"
                      aria-label={checked ? 'Unmark as emailed' : 'Mark as emailed'}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        loading
                          ? 'border-gray-600 bg-transparent'
                          : checked
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-600 bg-transparent hover:border-gray-400'
                      }`}>
                        {loading ? (
                          <svg className="w-3 h-3 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        ) : checked ? (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </div>
                    </button>

                    {/* Company info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${checked ? 'line-through text-gray-500' : 'text-white'}`}>
                        {company.company_name}
                      </p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{company.email}</p>
                    </div>

                    {/* Action buttons */}
                    <div className="shrink-0 flex items-center gap-1.5">

                      {/* Copy email */}
                      <button
                        onClick={e => handleCopyEmail(e, company)}
                        title="Copy email address"
                        className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
                          copied
                            ? 'text-green-400 bg-green-950/40'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        {copied ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>

                      {/* Play recording */}
                      {recUrl && (
                        <button
                          onClick={e => handleToggleAudio(e, company.id)}
                          title={audioOpen ? 'Hide recording' : 'Play recording'}
                          className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
                            audioOpen
                              ? 'text-indigo-400 bg-indigo-950/40'
                              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      )}

                      {/* State + date */}
                      <div className="text-right ml-1">
                        {company.state && (
                          <p className="text-xs text-gray-600">{company.state}</p>
                        )}
                        {checked && company.emailed_at && (
                          <p className="text-xs text-blue-500 mt-0.5">
                            {new Date(company.emailed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Inline audio player */}
                  {audioOpen && recUrl && (
                    <div className="px-4 pb-3 border-t border-gray-800/60 pt-2">
                      <AudioRow url={recUrl} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
