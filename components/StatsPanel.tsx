'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Company } from '@/types'

interface Props {
  companies: Company[]
}

export function StatsPanel({ companies }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const total = companies.length
  const called = companies.filter(c => c.reach_out_response && c.reach_out_response !== 'Not called').length
  const notCalled = total - called
  const introMeetings = companies.filter(c => c.reach_out_response === 'Intro-meeting wanted').length
  const notInterested = companies.filter(c => c.reach_out_response === 'Owner is not interested').length
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shrink-0">
      <button
        onClick={() => setCollapsed(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Summary</span>
        <div className="flex items-center gap-3">
          <Link
            href="/stats"
            onClick={e => e.stopPropagation()}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Full stats →
          </Link>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 grid grid-cols-3 sm:grid-cols-5 gap-4 border-t border-gray-800">
          <Stat label="Companies" value={total.toLocaleString()} />
          <Stat label="Called" value={called.toLocaleString()} />
          <Stat label="Not Called" value={notCalled.toLocaleString()} color="text-gray-400" />
          <Stat label="Intro Meetings" value={introMeetings.toString()} color="text-green-400" />
          <Stat label="Not Interested" value={notInterested.toString()} color="text-red-400" />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 pt-3">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
