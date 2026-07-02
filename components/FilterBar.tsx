'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { REGIONS, RESPONSE_STATUSES, TEAM_MEMBERS } from '@/types'

interface MultiSelectProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}

function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false)

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          selected.length > 0
            ? 'border-blue-500 bg-blue-950/40 text-blue-300'
            : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-white text-black text-xs px-1.5 py-0.5 rounded-full font-medium">
            {selected.length}
          </span>
        )}
        <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] max-h-64 overflow-y-auto">
            {options.map(opt => (
              <label
                key={opt}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-800 cursor-pointer text-sm text-gray-300"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-blue-500 w-3.5 h-3.5"
                />
                {opt}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function FilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const getParam = (key: string) => searchParams.get(key) ?? ''
  const getArrayParam = (key: string) => {
    const v = searchParams.get(key)
    return v ? v.split(',') : []
  }

  const regions = getArrayParam('regions')
  const responses = getArrayParam('responses')
  const whoCalled = getArrayParam('whoCalled')
  const search = getParam('search')
  const notCalled = searchParams.get('notCalled') === 'true'
  const demoBooked = searchParams.get('demoBooked') === 'true'

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([key, val]) => {
      if (val === null || val === '') {
        params.delete(key)
      } else {
        params.set(key, val)
      }
    })
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, router, pathname])

  const hasFilters = regions.length > 0 || responses.length > 0 || whoCalled.length > 0 ||
    search || notCalled || demoBooked

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search companies…"
          value={search}
          onChange={e => updateParams({ search: e.target.value || null })}
          className="pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-48"
        />
      </div>

      <MultiSelect
        label="Region"
        options={REGIONS}
        selected={regions}
        onChange={vals => updateParams({ regions: vals.join(',') || null })}
      />

      <MultiSelect
        label="Response"
        options={RESPONSE_STATUSES}
        selected={responses}
        onChange={vals => updateParams({ responses: vals.join(',') || null })}
      />

      <MultiSelect
        label="Who Called"
        options={TEAM_MEMBERS}
        selected={whoCalled}
        onChange={vals => updateParams({ whoCalled: vals.join(',') || null })}
      />

      <button
        onClick={() => updateParams({ notCalled: notCalled ? null : 'true', demoBooked: null })}
        className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          notCalled
            ? 'border-gray-500 bg-gray-700 text-gray-200'
            : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
        }`}
      >
        Not yet called
      </button>

      <button
        onClick={() => updateParams({ demoBooked: demoBooked ? null : 'true', notCalled: null })}
        className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          demoBooked
            ? 'border-green-600 bg-green-950/40 text-green-300'
            : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
        }`}
      >
        Demo booked
      </button>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="px-3 py-1.5 rounded-lg border border-red-900 bg-red-950/30 text-red-400 hover:bg-red-950/50 text-sm transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
