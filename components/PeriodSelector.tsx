'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

export type Period = 'day' | 'week' | 'month' | 'all'

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'day',   label: 'Today' },
  { value: 'week',  label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all',   label: 'All time' },
]

export default function PeriodSelector({ current }: { current: Period }) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function select(p: Period) {
    const params = new URLSearchParams(searchParams.toString())
    if (p === 'all') params.delete('period')
    else params.set('period', p)
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  return (
    <div className={`flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      {OPTIONS.map(o => (
        <button
          key={o.value}
          onClick={() => select(o.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
            current === o.value
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
