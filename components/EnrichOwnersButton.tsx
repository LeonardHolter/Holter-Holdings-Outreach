'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface BatchResult {
  company: string
  owner: string | null
  status: string
}

export function EnrichOwnersButton() {
  const [missing, setMissing] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ found: number; processed: number } | null>(null)

  useEffect(() => {
    fetch('/api/enrich-owners')
      .then(r => r.json())
      .then(d => setMissing(d.missing))
      .catch(() => null)
  }, [])

  async function handleEnrich() {
    if (running) return
    setRunning(true)
    setProgress({ found: 0, processed: 0 })

    let totalFound = 0
    let totalProcessed = 0
    let remaining = missing ?? 999

    const toastId = toast.loading(`Searching for owners… (${remaining} to go)`)

    try {
      while (remaining > 0) {
        const res = await fetch('/api/enrich-owners', { method: 'POST' })
        if (!res.ok) throw new Error('Server error')

        const data: {
          processed: number
          found: number
          remaining: number
          results: BatchResult[]
        } = await res.json()

        if (data.processed === 0) break

        totalFound += data.found
        totalProcessed += data.processed
        remaining = data.remaining

        setProgress({ found: totalFound, processed: totalProcessed })
        setMissing(remaining)

        toast.loading(
          `Searching… ${totalProcessed} checked, ${totalFound} found (${remaining} left)`,
          { id: toastId }
        )

        // Small pause between batches
        if (remaining > 0) await new Promise(r => setTimeout(r, 500))
      }

      toast.success(
        `Done! Found ${totalFound} owner${totalFound !== 1 ? 's' : ''} out of ${totalProcessed} companies searched.`,
        { id: toastId, duration: 6000 }
      )
    } catch {
      toast.error('Something went wrong during enrichment', { id: toastId })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  if (missing === null) return null
  if (missing === 0 && !running) return null

  return (
    <button
      onClick={handleEnrich}
      disabled={running}
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
        running
          ? 'border-blue-700 bg-blue-950/40 text-blue-300 cursor-not-allowed'
          : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
      }`}
      title={`${missing} companies have no owner logged`}
    >
      {running ? (
        <>
          <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          {progress
            ? `${progress.found} found / ${progress.processed} checked`
            : 'Starting…'}
        </>
      ) : (
        <>
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          AI: Find {missing} missing owner{missing !== 1 ? 's' : ''}
        </>
      )}
    </button>
  )
}
