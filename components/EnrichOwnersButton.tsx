'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

export function EnrichOwnersButton() {
  const [missing, setMissing] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [found, setFound] = useState(0)
  const [checked, setChecked] = useState(0)
  const [current, setCurrent] = useState('')

  useEffect(() => {
    fetch('/api/enrich-owners')
      .then(r => r.json())
      .then(d => setMissing(d.missing))
      .catch(() => null)
  }, [])

  async function run() {
    if (running) return
    setRunning(true)
    setFound(0)
    setChecked(0)

    let remaining = missing ?? 0
    let errors = 0

    while (remaining > 0 && errors < 3) {
      try {
        const res = await fetch('/api/enrich-owners', { method: 'POST' })
        const data = await res.json()

        if (!res.ok) {
          toast.error(`Error: ${data.error || res.statusText}`)
          errors++
          continue
        }

        if (data.done || (typeof data.remaining === 'number' && data.remaining === 0)) {
          remaining = 0
          break
        }

        if (typeof data.remaining !== 'number') {
          toast.error('Unexpected response from server')
          errors++
          continue
        }

        errors = 0
        remaining = data.remaining
        setMissing(remaining)
        setChecked(c => c + 1)
        setCurrent(data.company || '')

        if (data.owner) {
          setFound(f => f + 1)
          toast.success(`${data.company} → ${data.owner}`, { duration: 3000 })
        } else {
          toast(`${data.company} → not found`, { duration: 2000 })
        }
      } catch (err) {
        toast.error(`Network error: ${err}`)
        errors++
      }
    }

    if (errors >= 3) {
      toast.error('Stopped after 3 consecutive errors. Check that ANTHROPIC_API_KEY is set in Vercel environment variables.')
    } else {
      toast.success('Owner search complete', { duration: 5000 })
    }

    setRunning(false)
    setCurrent('')
  }

  if (missing === null) return null
  if (missing === 0 && !running) return null

  return (
    <button
      onClick={run}
      disabled={running}
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
        running
          ? 'border-blue-700 bg-blue-950/40 text-blue-300 cursor-wait'
          : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
      }`}
    >
      {running ? (
        <>
          <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          {current ? `${checked} done · ${found} found · ${current}` : 'Starting…'}
        </>
      ) : (
        <>
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          Find {missing} missing owner{missing !== 1 ? 's' : ''}
        </>
      )}
    </button>
  )
}
