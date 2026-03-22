'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { STATES, RESPONSE_STATUSES, TEAM_MEMBERS } from '@/types'
import { format, isValid, parseISO } from 'date-fns'

type CellType = 'text' | 'textarea' | 'number' | 'select-state' | 'select-response' | 'select-caller' | 'date' | 'email' | 'phone'

interface EditableCellProps {
  value: string | number | null | undefined
  type: CellType
  onSave: (value: string | number | null) => Promise<void>
  className?: string
}

function formatDisplayValue(value: string | number | null | undefined, type: CellType): string {
  if (value === null || value === undefined || value === '') return ''
  if (type === 'date' && typeof value === 'string') {
    const parsed = parseISO(value)
    if (isValid(parsed)) return format(parsed, 'MM/dd/yy')
    return value
  }
  return String(value)
}

export function EditableCell({ value, type, onSave, className = '' }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)

  function startEdit() {
    if (saving) return
    let initial = ''
    if (value !== null && value !== undefined) {
      if (type === 'date' && typeof value === 'string') {
        const parsed = parseISO(value)
        if (isValid(parsed)) {
          initial = format(parsed, 'yyyy-MM-dd')
        } else {
          initial = value
        }
      } else {
        initial = String(value)
      }
    }
    setDraft(initial)
    setEditing(true)
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      // setSelectionRange is not supported on type="number" inputs
      if (
        (inputRef.current instanceof HTMLInputElement && inputRef.current.type !== 'number') ||
        inputRef.current instanceof HTMLTextAreaElement
      ) {
        const len = inputRef.current.value.length
        inputRef.current.setSelectionRange(len, len)
      }
    }
  }, [editing])

  const commit = useCallback(async () => {
    if (!editing) return
    setEditing(false)

    let parsed: string | number | null = draft === '' ? null : draft
    if (type === 'number' && draft !== '') {
      const n = parseInt(draft, 10)
      parsed = isNaN(n) ? null : n
    }

    if (parsed === value || (parsed === null && (value === null || value === undefined || value === ''))) return

    setSaving(true)
    try {
      await onSave(parsed)
    } finally {
      setSaving(false)
    }
  }, [editing, draft, type, value, onSave])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault()
      commit()
    }
    if (e.key === 'Escape') {
      setEditing(false)
      setDraft('')
    }
    if (e.key === 'Tab') {
      commit()
    }
  }

  async function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value === '' ? null : e.target.value
    setEditing(false)
    if (val === value) return
    setSaving(true)
    try {
      await onSave(val)
    } finally {
      setSaving(false)
    }
  }

  async function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value === '' ? null : e.target.value
    setEditing(false)
    if (val === value) return
    setSaving(true)
    try {
      await onSave(val)
    } finally {
      setSaving(false)
    }
  }

  const displayVal = formatDisplayValue(value, type)

  const baseDisplay = `min-h-[28px] w-full px-2 py-1 rounded cursor-pointer hover:bg-white/5 transition-colors text-sm select-none ${saving ? 'opacity-50' : ''} ${className}`

  if (editing) {
    if (type === 'select-state') {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={handleSelectChange}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="">—</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )
    }

    if (type === 'select-response') {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={handleSelectChange}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="">—</option>
          {RESPONSE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )
    }

    if (type === 'select-caller') {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={handleSelectChange}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="">—</option>
          {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )
    }

    if (type === 'date') {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="date"
          value={draft}
          onChange={handleDateChange}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
        />
      )
    }

    if (type === 'textarea') {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none resize-none"
        />
      )
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={type === 'number' ? 'number' : 'text'}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
      />
    )
  }

  if (type === 'phone' && displayVal) {
    return (
      <div className={baseDisplay} onClick={startEdit}>
        {saving ? (
          <span className="text-gray-500 text-xs">saving…</span>
        ) : (
          <a
            href={`tel:${displayVal}`}
            onClick={e => e.stopPropagation()}
            className="text-blue-400 hover:text-blue-300 hover:underline"
          >
            {displayVal}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className={baseDisplay} onClick={startEdit} title={displayVal || undefined}>
      {saving ? (
        <span className="text-gray-500 text-xs">saving…</span>
      ) : displayVal ? (
        <span className="block truncate">{displayVal}</span>
      ) : (
        <span className="text-gray-600 text-xs">—</span>
      )}
    </div>
  )
}
