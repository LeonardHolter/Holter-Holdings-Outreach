'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import { isValid, parseISO, isPast, isToday } from 'date-fns'
import type { Company } from '@/types'
import { EditableCell } from './EditableCell'
import { getRowHighlight } from './ResponseBadge'

const col = createColumnHelper<Company>()

interface Props {
  initialData: Company[]
}

async function patchCompany(id: string, payload: Partial<Company>): Promise<Company> {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to save')
  return res.json()
}

async function deleteCompanyReq(id: string): Promise<void> {
  const res = await fetch(`/api/companies/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete')
}

async function createCompanyReq(payload: Partial<Company>): Promise<Company> {
  const res = await fetch('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to create')
  return res.json()
}


export function CompanyTable({ initialData }: Props) {
  const router = useRouter()
  const [data, setData] = useState<Company[]>(initialData)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'google_reviews', desc: true }])
  const [newRow, setNewRow] = useState<Partial<Company> | null>(null)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newNameError, setNewNameError] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)

  const makeUpdater = useCallback(
    (id: string, field: keyof Company) =>
      async (value: string | number | null) => {
        const prev = data.find(c => c.id === id)
        if (!prev) return
        const optimistic = { ...prev, [field]: value }
        setData(d => d.map(c => c.id === id ? optimistic : c))
        try {
          const updated = await patchCompany(id, { [field]: value })
          setData(d => d.map(c => c.id === id ? updated : c))
          toast.success('Saved')
        } catch {
          setData(d => d.map(c => c.id === id ? prev : c))
          toast.error('Failed to save')
        }
      },
    [data]
  )

  async function saveNewRow() {
    if (!newCompanyName.trim()) { setNewNameError(true); return }
    try {
      const created = await createCompanyReq({ ...newRow, company_name: newCompanyName.trim() })
      setData(d => [created, ...d])
      setNewRow(null)
      setNewCompanyName('')
      toast.success('Company added')
    } catch {
      toast.error('Failed to create company')
    }
  }

  function cancelNewRow() {
    setNewRow(null)
    setNewCompanyName('')
    setNewNameError(false)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    const prev = data.find(c => c.id === id)
    setData(d => d.filter(c => c.id !== id))
    try {
      await deleteCompanyReq(id)
      toast.success('Deleted')
    } catch {
      if (prev) setData(d => [prev, ...d])
      toast.error('Failed to delete')
    }
  }

  const columns = [
    col.accessor('company_name', {
      header: 'Company Name',
      size: 260,
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            <EditableCell
              value={row.original.company_name}
              type="text"
              onSave={makeUpdater(row.original.id, 'company_name')}
              className="font-medium text-white"
            />
          </div>
        )
      },
    }),
    col.accessor('google_reviews', {
      header: 'Reviews',
      size: 80,
      cell: ({ row }) => (
        <EditableCell value={row.original.google_reviews} type="number" onSave={makeUpdater(row.original.id, 'google_reviews')} />
      ),
    }),
    col.accessor('state', {
      header: 'State',
      size: 70,
      cell: ({ row }) => (
        <EditableCell value={row.original.state} type="select-state" onSave={makeUpdater(row.original.id, 'state')} />
      ),
    }),
    col.accessor('phone_number', {
      header: 'Phone',
      size: 140,
      cell: ({ row }) => (
        <EditableCell value={row.original.phone_number} type="phone" onSave={makeUpdater(row.original.id, 'phone_number')} />
      ),
    }),
    col.accessor('reach_out_response', {
      header: 'Response',
      size: 200,
      cell: ({ row }) => (
        <EditableCell value={row.original.reach_out_response} type="select-response" onSave={makeUpdater(row.original.id, 'reach_out_response')} />
      ),
    }),
    col.accessor('last_reach_out', {
      header: 'Last Reach Out',
      size: 120,
      cell: ({ row }) => (
        <EditableCell value={row.original.last_reach_out} type="date" onSave={makeUpdater(row.original.id, 'last_reach_out')} />
      ),
    }),
    col.accessor('next_reach_out', {
      header: 'Next Reach Out',
      size: 120,
      cell: ({ row }) => {
        const val = row.original.next_reach_out
        const parsed = val ? parseISO(val) : null
        const overdue = parsed && isValid(parsed) && (isPast(parsed) || isToday(parsed))
        return (
          <EditableCell value={val} type="date" onSave={makeUpdater(row.original.id, 'next_reach_out')} className={overdue ? 'text-orange-400' : ''} />
        )
      },
    }),
    col.accessor('owners_name', {
      header: "Owner's Name",
      size: 140,
      cell: ({ row }) => (
        <EditableCell value={row.original.owners_name} type="text" onSave={makeUpdater(row.original.id, 'owners_name')} />
      ),
    }),
    col.accessor('amount_of_calls', {
      header: 'Calls',
      size: 70,
      cell: ({ row }) => (
        <EditableCell value={row.original.amount_of_calls} type="number" onSave={makeUpdater(row.original.id, 'amount_of_calls')} />
      ),
    }),
    col.accessor('who_called', {
      header: 'Who Called',
      size: 110,
      cell: ({ row }) => (
        <EditableCell value={row.original.who_called} type="select-caller" onSave={makeUpdater(row.original.id, 'who_called')} />
      ),
    }),
    col.accessor('email', {
      header: 'Email',
      size: 180,
      cell: ({ row }) => (
        <EditableCell value={row.original.email} type="email" onSave={makeUpdater(row.original.id, 'email')} />
      ),
    }),
    col.accessor('notes', {
      header: 'Notes',
      size: 200,
      cell: ({ row }) => (
        <EditableCell value={row.original.notes} type="textarea" onSave={makeUpdater(row.original.id, 'notes')} />
      ),
    }),
    col.display({
      id: 'revenue',
      header: 'Revenue Est.',
      size: 140,
      cell: ({ row }) => {
        const c = row.original
        if (!c.enriched_at) return <span className="text-gray-600 text-xs">—</span>
        const fmt = (n: number | null) => {
          if (!n) return '?'
          if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
          if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
          return `$${n}`
        }
        return (
          <div className="text-xs leading-tight">
            <span className="text-white font-medium">{fmt(c.estimated_revenue_low)}–{fmt(c.estimated_revenue_high)}</span>
            <span className="text-gray-500">/yr</span>
            {c.revenue_confidence && (
              <span className={`ml-1 ${c.revenue_confidence === 'high' ? 'text-green-400' : c.revenue_confidence === 'medium' ? 'text-yellow-400' : 'text-gray-500'}`}>
                ({c.revenue_confidence})
              </span>
            )}
            {c.technician_count_estimate != null && (
              <p className="text-gray-500">~{c.technician_count_estimate} techs</p>
            )}
          </div>
        )
      },
    }),
    col.display({
      id: 'actions',
      size: 100,
      cell: ({ row }) => {
        const isLead = row.original.reach_out_response === 'Intro-meeting wanted'
        return (
          <div className="flex items-center gap-0.5">
            <button
              onClick={async () => {
                const id = row.original.id
                const newVal = isLead ? 'Not called' : 'Intro-meeting wanted'
                setData(d => d.map(c => c.id === id ? { ...c, reach_out_response: newVal } : c))
                try {
                  await patchCompany(id, { reach_out_response: newVal })
                  toast.success(isLead ? 'Removed from leads' : 'Added to leads')
                } catch {
                  setData(d => d.map(c => c.id === id ? { ...c, reach_out_response: row.original.reach_out_response } : c))
                  toast.error('Failed to update')
                }
              }}
              className={`p-1 rounded transition-colors ${isLead ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-600 hover:text-yellow-400'}`}
              title={isLead ? 'Remove from leads' : 'Add to leads'}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isLead ? 'currentColor' : 'none'} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
            {row.original.phone_number && (
              <button
                onClick={(e) => { e.stopPropagation(); router.push(`/call?dial=${encodeURIComponent(row.original.phone_number!)}`) }}
                className="text-gray-600 hover:text-green-400 transition-colors p-1 rounded"
                title={`Call ${row.original.phone_number}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            )}
            {isLead && (
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  const id = row.original.id
                  if (analyzingId === id) return
                  setAnalyzingId(id)
                  try {
                    const res = await fetch(`/api/companies/${id}/enrich`, { method: 'POST' })
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({ error: 'Unknown error' }))
                      throw new Error(body.error || `HTTP ${res.status}`)
                    }
                    const result = await res.json()
                    setData(d => d.map(c => c.id === id ? { ...c, ...result.company } : c))
                    const low = result.estimated_revenue_low >= 1e6 ? `$${(result.estimated_revenue_low / 1e6).toFixed(1)}M` : `$${(result.estimated_revenue_low / 1e3).toFixed(0)}K`
                    const high = result.estimated_revenue_high >= 1e6 ? `$${(result.estimated_revenue_high / 1e6).toFixed(1)}M` : `$${(result.estimated_revenue_high / 1e3).toFixed(0)}K`
                    toast.success(`${row.original.company_name}: ${low}–${high}/yr (${result.revenue_confidence})`)
                  } catch (err) {
                    toast.error(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
                  } finally {
                    setAnalyzingId(null)
                  }
                }}
                className={`p-1 rounded transition-colors ${
                  analyzingId === row.original.id
                    ? 'text-indigo-400 animate-pulse'
                    : row.original.enriched_at
                      ? 'text-indigo-400 hover:text-indigo-300'
                      : 'text-gray-600 hover:text-indigo-400'
                }`}
                title={row.original.enriched_at ? 'Re-analyze lead' : 'Analyze lead (revenue estimate)'}
                disabled={analyzingId !== null}
              >
                {analyzingId === row.original.id ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={() => handleDelete(row.original.id, row.original.company_name)}
              className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded"
              title="Delete row"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )
      },
    }),
  ]

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {data.length.toLocaleString()} {data.length === 1 ? 'company' : 'companies'}
          </span>
        </div>
        <button
          onClick={() => { setNewRow({}); setNewCompanyName(''); setNewNameError(false) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Company
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="border-collapse w-max min-w-full text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="bg-gray-900 border-b border-gray-800">
                {hg.headers.map((header, i) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className={`px-2 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-r border-gray-800 ${
                      i === 0 ? 'sticky left-0 z-20 bg-gray-900' : ''
                    } ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-gray-200' : ''}`}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && <span>↑</span>}
                      {header.column.getIsSorted() === 'desc' && <span>↓</span>}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {/* New row */}
            {newRow !== null && (
              <tr className="bg-blue-950/20 border-b border-blue-900/50">
                <td className="sticky left-0 z-10 bg-blue-950/30 px-2 py-1.5 border-r border-gray-800">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Company name *"
                      value={newCompanyName}
                      onChange={e => { setNewCompanyName(e.target.value); setNewNameError(false) }}
                      onKeyDown={e => { if (e.key === 'Enter') saveNewRow(); if (e.key === 'Escape') cancelNewRow() }}
                      className={`bg-gray-800 border rounded px-2 py-1 text-sm text-white focus:outline-none w-44 ${newNameError ? 'border-red-500' : 'border-blue-500'}`}
                    />
                    <button onClick={saveNewRow} className="text-green-400 hover:text-green-300 p-1" title="Save">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button onClick={cancelNewRow} className="text-gray-500 hover:text-gray-300 p-1" title="Cancel">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {newNameError && <p className="text-red-400 text-xs mt-1">Required</p>}
                </td>
                {Array.from({ length: columns.length - 1 }).map((_, i) => (
                  <td key={i} className="border-r border-gray-800 px-2 py-1.5 text-gray-600 text-xs">—</td>
                ))}
              </tr>
            )}

            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-16 text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No companies match your filters.</p>
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, rowIdx) => {
                const rowBg = getRowHighlight(row.original.reach_out_response)
                const isEven = rowIdx % 2 === 0
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-800/60 transition-colors group ${rowBg || (isEven ? 'bg-gray-950' : 'bg-gray-900/40')}`}
                  >
                    {row.getVisibleCells().map((cell, cellIdx) => (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className={`px-1 py-0.5 border-r border-gray-800/50 align-middle max-w-0 ${
                          cellIdx === 0 ? 'sticky left-0 z-10 bg-inherit' : ''
                        }`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
