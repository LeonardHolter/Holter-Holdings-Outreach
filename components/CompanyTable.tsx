'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { isValid, parseISO, isPast, isToday } from 'date-fns'
import type { Company } from '@/types'
import { EditableCell } from './EditableCell'
import { getRowHighlight } from './ResponseBadge'

const col = createColumnHelper<Company>()

interface Props {
  initialData: Company[]
  totalCount: number
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

// ── Duplicate detection ───────────────────────────────────────

interface DupeInfo {
  reasons: string[]          // e.g. ["same phone", "same name"]
  matchIds: string[]         // other row IDs this one collides with
}

function buildDupeMap(rows: Company[]): Map<string, DupeInfo> {
  const map = new Map<string, DupeInfo>()

  // Only flag when BOTH name AND phone match
  const byNameAndPhone = new Map<string, string[]>()
  for (const r of rows) {
    const phone = r.phone_number ? r.phone_number.replace(/\D/g, '') : ''
    if (!phone) continue
    const key = `${r.company_name.trim().toLowerCase()}||${phone}`
    if (!byNameAndPhone.has(key)) byNameAndPhone.set(key, [])
    byNameAndPhone.get(key)!.push(r.id)
  }

  for (const [, ids] of byNameAndPhone) {
    if (ids.length < 2) continue
    for (const id of ids) {
      if (!map.has(id)) map.set(id, { reasons: ['same name & phone'], matchIds: [] })
      map.get(id)!.matchIds.push(...ids.filter(x => x !== id))
    }
  }

  return map
}

// ── Dedupe modal ──────────────────────────────────────────────

interface DupeGroup {
  key: string         // "name||phone"
  ids: string[]
}

function buildDupeGroups(rows: Company[]): DupeGroup[] {
  const byKey = new Map<string, string[]>()
  for (const r of rows) {
    const phone = r.phone_number ? r.phone_number.replace(/\D/g, '') : ''
    if (!phone) continue
    const key = `${r.company_name.trim().toLowerCase()}||${phone}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(r.id)
  }
  const groups: DupeGroup[] = []
  for (const [key, ids] of byKey) {
    if (ids.length >= 2) groups.push({ key, ids })
  }
  return groups
}

function scoreCompany(c: Company): number {
  // Higher = more data = better to keep
  return (
    (c.amount_of_calls ?? 0) * 3 +
    (c.owners_name ? 2 : 0) +
    (c.notes ? 1 : 0) +
    (c.email ? 1 : 0) +
    (c.reach_out_response && c.reach_out_response !== 'Not called' ? 2 : 0)
  )
}

interface DedupeModalProps {
  data: Company[]
  onClose: () => void
  onDeleted: (deletedId: string) => void
}

function DedupeModal({ data, onClose, onDeleted }: DedupeModalProps) {
  const groups = useMemo(() => buildDupeGroups(data), [data])
  const byId = useMemo(() => new Map(data.map(c => [c.id, c])), [data])
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await deleteCompanyReq(id)
      onDeleted(id)
      toast.success('Duplicate removed')
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(null)
    }
  }

  // Filter to groups that still exist in data (after deletions)
  const activeGroups = groups.filter(g => g.ids.filter(id => byId.has(id)).length >= 2)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-lg">Remove Duplicates</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {activeGroups.length} group{activeGroups.length !== 1 ? 's' : ''} of duplicates — keep the best one, delete the rest
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {activeGroups.length === 0 && (
            <div className="text-center py-10 text-green-400">
              <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="font-medium">All clean! No more duplicates.</p>
            </div>
          )}
          {activeGroups.map(group => {
            const companies = group.ids.map(id => byId.get(id)).filter(Boolean) as Company[]
            const sorted = [...companies].sort((a, b) => scoreCompany(b) - scoreCompany(a))
            const keepId = sorted[0]?.id

            return (
              <div key={group.key} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/80">
                  <p className="text-xs text-orange-400 font-semibold uppercase tracking-wide">Duplicate group</p>
                  <p className="text-white font-medium text-sm mt-0.5">{sorted[0]?.company_name}</p>
                </div>
                <div className="divide-y divide-gray-800">
                  {sorted.map((c, idx) => {
                    const isKeep = c.id === keepId
                    return (
                      <div key={c.id} className={`flex items-start gap-3 px-4 py-3 ${isKeep ? 'bg-green-950/20' : ''}`}>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isKeep
                              ? <span className="text-xs bg-green-900/60 border border-green-700/50 text-green-400 px-2 py-0.5 rounded-full font-medium">Recommended to keep</span>
                              : <span className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-full font-medium">#{idx + 1}</span>
                            }
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs mt-1.5">
                            <span className="text-gray-500">Phone</span>
                            <span className="text-gray-300 font-mono">{c.phone_number ?? '—'}</span>
                            <span className="text-gray-500">State</span>
                            <span className="text-gray-300">{c.state ?? '—'}</span>
                            <span className="text-gray-500">Calls made</span>
                            <span className="text-gray-300">{c.amount_of_calls ?? 0}</span>
                            <span className="text-gray-500">Owner</span>
                            <span className="text-gray-300">{c.owners_name ?? '—'}</span>
                            <span className="text-gray-500">Status</span>
                            <span className="text-gray-300">{c.reach_out_response ?? '—'}</span>
                            <span className="text-gray-500">Notes</span>
                            <span className="text-gray-400 truncate">{c.notes ? c.notes.slice(0, 40) + (c.notes.length > 40 ? '…' : '') : '—'}</span>
                          </div>
                        </div>
                        <div className="shrink-0 pt-1">
                          {isKeep ? (
                            <span className="flex items-center gap-1 text-xs text-green-500 font-medium py-1.5 px-3">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              Keep
                            </span>
                          ) : (
                            <button
                              disabled={deleting === c.id}
                              onClick={() => handleDelete(c.id)}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-800/60 text-red-400 hover:bg-red-950/70 hover:text-red-300 transition-colors disabled:opacity-50"
                            >
                              {deleting === c.id ? 'Deleting…' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 shrink-0 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DupeFlag badge ────────────────────────────────────────────

function DupeFlag({ info, companyName: _companyName }: { info: DupeInfo; companyName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/50 rounded text-orange-400 text-xs font-medium hover:bg-orange-500/30 transition-colors"
        title="Possible duplicate — click to see details"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Dupe
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 bg-gray-900 border border-orange-700/60 rounded-lg shadow-xl p-3 w-56 text-xs">
            <p className="font-semibold text-orange-400 mb-1">Duplicate detected</p>
            <p className="text-gray-400">{info.matchIds.length} other row{info.matchIds.length !== 1 ? 's' : ''} share the same name and phone number.</p>
          </div>
        </>
      )}
    </div>
  )
}

export function CompanyTable({ initialData, totalCount }: Props) {
  const router = useRouter()
  const [data, setData] = useState<Company[]>(initialData)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'google_reviews', desc: true }])
  const [newRow, setNewRow] = useState<Partial<Company> | null>(null)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newNameError, setNewNameError] = useState(false)
  const [showDupesOnly, setShowDupesOnly] = useState(false)
  const [showDedupeModal, setShowDedupeModal] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [allLoaded, setAllLoaded] = useState(initialData.length >= totalCount)

  const loadMore = useCallback(async () => {
    if (loadingMore || allLoaded) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams(window.location.search)
      params.set('offset', String(data.length))
      params.set('limit', '2000')
      const res = await fetch(`/api/companies?${params}`)
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      const more = json.companies as Company[]
      setData(d => [...d, ...more])
      if (!json.hasMore) setAllLoaded(true)
    } catch {
      toast.error('Failed to load more companies')
    } finally {
      setLoadingMore(false)
    }
  }, [data.length, loadingMore, allLoaded])

  // Recompute dupe map whenever data changes
  const dupeMap = useMemo(() => buildDupeMap(data), [data])
  const dupeCount = dupeMap.size

  const displayData = useMemo(
    () => showDupesOnly ? data.filter(c => dupeMap.has(c.id)) : data,
    [data, dupeMap, showDupesOnly]
  )

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

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    let prev: Company | undefined
    setData(d => {
      prev = d.find(c => c.id === id)
      return d.filter(c => c.id !== id)
    })
    try {
      await deleteCompanyReq(id)
      toast.success('Deleted')
    } catch {
      if (prev) setData(d => [prev!, ...d])
      toast.error('Failed to delete')
    }
  }, [])

  const columns = useMemo(() => [
    col.accessor('company_name', {
      header: 'Company Name',
      size: 260,
      cell: ({ row }) => {
        const dupeInfo = dupeMap.get(row.original.id)
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            {dupeInfo && <DupeFlag info={dupeInfo} companyName={row.original.company_name} />}
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
  ], [dupeMap, makeUpdater, handleDelete, router])

  const table = useReactTable({
    data: displayData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const { rows: tableRows } = table.getRowModel()
  const scrollRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 20,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {totalCount.toLocaleString()} {totalCount === 1 ? 'company' : 'companies'}
          </span>
          {!allLoaded && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-blue-700/50 bg-blue-950/20 text-blue-400 hover:bg-blue-950/40 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'Load all'}
            </button>
          )}
          {dupeCount > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowDupesOnly(o => !o)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  showDupesOnly
                    ? 'border-orange-500 bg-orange-950/40 text-orange-300'
                    : 'border-orange-700/50 bg-orange-950/20 text-orange-400 hover:bg-orange-950/30'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {dupeCount} duplicate{dupeCount !== 1 ? 's' : ''}
                {showDupesOnly && ' — showing only'}
              </button>
              <button
                onClick={() => setShowDedupeModal(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-orange-700/50 bg-orange-950/20 text-orange-400 hover:bg-orange-950/40 text-xs font-medium transition-colors"
              >
                Clean up
              </button>
            </div>
          )}
          {dupeCount === 0 && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              No duplicates
            </span>
          )}
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
      <div ref={scrollRef} className="overflow-auto flex-1">
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

            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-16 text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>{showDupesOnly ? 'No duplicates found — the data is clean!' : 'No companies match your filters.'}</p>
                    {showDupesOnly && (
                      <button onClick={() => setShowDupesOnly(false)} className="text-blue-400 text-sm hover:underline">
                        Show all companies
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr><td colSpan={columns.length} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>
                )}
                {virtualRows.map(virtualRow => {
                  const row = tableRows[virtualRow.index]
                  const isDupe = dupeMap.has(row.original.id)
                  const rowBg = getRowHighlight(row.original.reach_out_response)
                  const isEven = virtualRow.index % 2 === 0
                  return (
                    <tr
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className={`border-b transition-colors group ${
                        isDupe
                          ? 'border-orange-900/40 bg-orange-950/10 hover:bg-orange-950/20'
                          : `border-gray-800/60 ${rowBg || (isEven ? 'bg-gray-950' : 'bg-gray-900/40')}`
                      }`}
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
                })}
                {paddingBottom > 0 && (
                  <tr><td colSpan={columns.length} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {showDedupeModal && (
        <DedupeModal
          data={data}
          onClose={() => setShowDedupeModal(false)}
          onDeleted={deletedId => {
            setData(prev => prev.filter(c => c.id !== deletedId))
          }}
        />
      )}
    </div>
  )
}
