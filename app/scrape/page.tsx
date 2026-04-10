'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Nav } from '@/components/Nav'

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
}

interface ProgressEvent {
  type: 'query_start' | 'query_done' | 'subdivision' | 'done' | 'error'
  query?: string
  found?: number
  newCompanies?: number
  duplicates?: number
  apiCalls?: number
  subdivisions?: number
  total?: number
  depth?: number
  message?: string
}

interface StateStatus {
  count: number
  scraping: boolean
  progress?: ProgressEvent
}

export default function ScrapePage() {
  const [statuses, setStatuses] = useState<Record<string, StateStatus>>({})
  const [activeState, setActiveState] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Load existing counts on mount
  useEffect(() => {
    fetch('/api/scrape/counts')
      .then(r => r.json())
      .then((counts: Record<string, number>) => {
        setStatuses(prev => {
          const next = { ...prev }
          for (const [st, count] of Object.entries(counts)) {
            next[st] = { ...next[st], count, scraping: false }
          }
          return next
        })
      })
      .catch(() => {})
  }, [])

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  const startScrape = useCallback(async (state: string) => {
    if (activeState) return

    setActiveState(state)
    setStatuses(prev => ({
      ...prev,
      [state]: { ...prev[state], count: prev[state]?.count ?? 0, scraping: true },
    }))
    setLog([`Starting scrape for ${STATE_NAMES[state]} (${state})...`])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const err = await res.text()
        setLog(prev => [...prev, `Error: ${err}`])
        setActiveState(null)
        setStatuses(prev => ({
          ...prev,
          [state]: { ...prev[state], scraping: false },
        }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const dataLine = line.trim()
          if (!dataLine.startsWith('data: ')) continue
          const json = dataLine.slice(6)

          try {
            const event: ProgressEvent = JSON.parse(json)

            if (event.type === 'query_start') {
              setLog(prev => [...prev, `Searching: "${event.query}"...`])
            } else if (event.type === 'query_done') {
              setLog(prev => [...prev,
                `  "${event.query}" done: +${event.newCompanies} new, ${event.duplicates} dupes, ${event.apiCalls} API calls, ${event.subdivisions} subdivisions`,
              ])
            } else if (event.type === 'subdivision') {
              // Don't spam the log with every subdivision
            } else if (event.type === 'done') {
              setLog(prev => [...prev,
                ``,
                `Done! ${event.total} unique companies found and saved to pipeline.`,
              ])
              setStatuses(prev => ({
                ...prev,
                [state]: { count: event.total ?? 0, scraping: false },
              }))
            } else if (event.type === 'error') {
              setLog(prev => [...prev, `Error: ${event.message}`])
              setStatuses(prev => ({
                ...prev,
                [state]: { ...prev[state], scraping: false },
              }))
            }

            setStatuses(prev => ({
              ...prev,
              [state]: { ...prev[state], scraping: true, progress: event },
            }))
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setLog(prev => [...prev, `Error: ${(err as Error).message}`])
      }
      setStatuses(prev => ({
        ...prev,
        [state]: { ...prev[state], scraping: false },
      }))
    } finally {
      setActiveState(null)
      abortRef.current = null
    }
  }, [activeState])

  const totalScraped = Object.values(statuses).reduce((sum, s) => sum + (s.count || 0), 0)
  const statesCompleted = Object.values(statuses).filter(s => s.count > 0 && !s.scraping).length

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-white">Scrape Google Maps</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Click a state to find every garage door company listed on Google Maps.
              Companies are added to the pipeline automatically.
            </p>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">States Scraped</p>
              <p className="text-2xl font-bold text-white mt-1">{statesCompleted}<span className="text-gray-600 text-sm font-normal"> / 50</span></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Companies Found</p>
              <p className="text-2xl font-bold text-green-400 mt-1">{totalScraped.toLocaleString()}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Status</p>
              <p className="text-2xl font-bold mt-1">
                {activeState ? (
                  <span className="text-blue-400">Scraping {activeState}...</span>
                ) : (
                  <span className="text-gray-500">Idle</span>
                )}
              </p>
            </div>
          </div>

          {/* State grid */}
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
            {STATES.map(st => {
              const status = statuses[st]
              const isScraping = status?.scraping
              const count = status?.count || 0
              const isActive = activeState === st
              const isDone = count > 0 && !isScraping

              return (
                <button
                  key={st}
                  onClick={() => startScrape(st)}
                  disabled={!!activeState}
                  title={`${STATE_NAMES[st]}${count > 0 ? ` (${count} companies)` : ''}`}
                  className={`
                    relative flex flex-col items-center justify-center rounded-xl py-3 px-1 text-sm font-semibold
                    transition-all active:scale-[0.97]
                    disabled:cursor-not-allowed
                    ${isActive
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400/50 shadow-lg shadow-blue-600/20'
                      : isDone
                        ? 'bg-green-950/60 border border-green-800/50 text-green-400 hover:border-green-700'
                        : activeState
                          ? 'bg-gray-900 border border-gray-800 text-gray-600'
                          : 'bg-gray-900 border border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white hover:bg-gray-800'
                    }
                  `}
                >
                  {isScraping && (
                    <div className="absolute inset-0 rounded-xl overflow-hidden">
                      <div className="absolute inset-0 bg-blue-500/10 animate-pulse" />
                    </div>
                  )}
                  <span className="relative z-10">{st}</span>
                  {isDone && (
                    <span className="relative z-10 text-[10px] font-medium text-green-500 mt-0.5 tabular-nums">
                      {count.toLocaleString()}
                    </span>
                  )}
                  {isScraping && !isActive && (
                    <span className="relative z-10 text-[10px] text-blue-400 mt-0.5">...</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Live progress log */}
          {log.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
                <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">Progress Log</span>
                {!activeState && log.length > 1 && (
                  <button
                    onClick={() => setLog([])}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="px-4 py-3 max-h-60 overflow-y-auto font-mono text-xs text-gray-400 space-y-0.5">
                {log.map((line, i) => (
                  <div key={i} className={line.startsWith('Done') ? 'text-green-400 font-semibold' : line.startsWith('Error') ? 'text-red-400' : ''}>
                    {line || '\u00A0'}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
