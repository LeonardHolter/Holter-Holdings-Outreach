'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Company } from '@/types'
import { toast } from 'sonner'

interface CimDocument {
  id: string
  company_id: string
  file_name: string
  file_path: string
  file_size: number
  uploaded_at: string
}

async function patchCompany(id: string, payload: Partial<Company>): Promise<Company> {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to update company')
  return res.json()
}

export function CimClient({ companies }: { companies: Company[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {companies.map(c => (
        <CompanyCard
          key={c.id}
          company={c}
          expanded={expanded === c.id}
          onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
        />
      ))}
    </div>
  )
}

function CompanyCard({
  company: c,
  expanded,
  onToggle,
}: {
  company: Company
  expanded: boolean
  onToggle: () => void
}) {
  const [docs, setDocs] = useState<CimDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [loiSent, setLoiSent] = useState(c.loi_sent ?? false)
  const [loiDate, setLoiDate] = useState(c.loi_sent_date ?? null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/cim/${c.id}`)
      if (!res.ok) throw new Error()
      setDocs(await res.json())
    } catch {
      toast.error('Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [c.id])

  useEffect(() => {
    if (expanded && !loaded.current) {
      loaded.current = true
      loadDocs()
    }
  }, [expanded, loadDocs])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/cim/${c.id}`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }
      const newDoc: CimDocument = await res.json()
      setDocs(prev => [newDoc, ...prev])
      toast.success('Document uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(doc: CimDocument) {
    if (!confirm(`Delete "${doc.file_name}"?`)) return
    try {
      const res = await fetch(
        `/api/cim/${c.id}?docId=${doc.id}&filePath=${encodeURIComponent(doc.file_path)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error()
      setDocs(prev => prev.filter(d => d.id !== doc.id))
      toast.success('Document deleted')
    } catch {
      toast.error('Failed to delete document')
    }
  }

  async function toggleLoi() {
    const next = !loiSent
    setLoiSent(next)
    const date = next ? new Date().toISOString().slice(0, 10) : null
    setLoiDate(date)
    try {
      await patchCompany(c.id, { loi_sent: next, loi_sent_date: date })
      toast.success(next ? 'LOI marked as sent' : 'LOI cleared')
    } catch {
      setLoiSent(!next)
      setLoiDate(!next ? new Date().toISOString().slice(0, 10) : null)
      toast.error('Failed to update LOI status')
    }
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="border rounded-2xl bg-gray-900 border-gray-800 overflow-hidden">
      {/* Header row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{c.company_name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {c.state && <span className="uppercase tracking-wider mr-2">{c.state}</span>}
            {c.owners_name && <span>{c.owners_name}</span>}
          </p>
        </div>

        {/* LOI badge */}
        {loiSent && (
          <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-900/60 border border-purple-700 text-purple-300">
            LOI Sent{loiDate ? ` ${loiDate}` : ''}
          </span>
        )}

        <span className="shrink-0 text-xs text-gray-600">{docs.length} doc{docs.length !== 1 ? 's' : ''}</span>

        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* Actions row */}
          <div className="flex items-center gap-3">
            <label className="cursor-pointer">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleUpload}
                className="hidden"
              />
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                uploading
                  ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-wait'
                  : 'bg-blue-900/40 border-blue-700/60 text-blue-300 hover:bg-blue-900/60'
              }`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {uploading ? 'Uploading...' : 'Upload PDF'}
              </span>
            </label>

            <button
              onClick={toggleLoi}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                loiSent
                  ? 'bg-purple-900/60 border-purple-700 text-purple-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-purple-300 hover:border-purple-700/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill={loiSent ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {loiSent ? 'LOI Sent' : 'Mark LOI Sent'}
            </button>
          </div>

          {/* Documents list */}
          {loading ? (
            <p className="text-xs text-gray-500 py-4 text-center">Loading documents...</p>
          ) : docs.length === 0 ? (
            <p className="text-xs text-gray-600 py-4 text-center">No documents uploaded yet</p>
          ) : (
            <div className="space-y-1.5">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-800/50 border border-gray-800">
                  <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{doc.file_name}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(doc.file_size)}</p>
                  </div>
                  <a
                    href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cim-documents/${doc.file_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium shrink-0"
                  >
                    View
                  </a>
                  <button
                    onClick={() => handleDelete(doc)}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
