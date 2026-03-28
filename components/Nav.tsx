'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/pipeline',    label: 'Pipeline'   },
  { href: '/call',        label: 'Calling'    },
  { href: '/follow-up',   label: 'Follow-up'  },
  { href: '/meetings',    label: 'Leads'      },
  { href: '/stats',       label: 'Stats'      },
  { href: '/recordings',  label: 'Recordings' },
  { href: '/settings',    label: 'Settings'   },
]

export function Nav() {
  const pathname = usePathname()
  const [topCallers, setTopCallers] = useState<Array<{ name: string; calls: number }>>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res = await fetch('/api/stats/top-callers')
        if (!res.ok || !mounted) return
        const data = await res.json() as { top?: Array<{ name: string; calls: number }> }
        if (mounted) setTopCallers(Array.isArray(data.top) ? data.top : [])
      } catch {
        // silent
      }
    }
    load()
    const id = setInterval(load, 60000) // refresh every minute
    return () => { mounted = false; clearInterval(id) }
  }, [])

  return (
    <header className="shrink-0 border-b border-gray-800 bg-gray-900 safe-top">
      <div className="flex items-center h-12 px-2 gap-1">
        {/* Brand — abbreviated on mobile */}
        <span className="font-semibold text-white text-sm px-2 shrink-0">
          <span className="hidden sm:inline">Holter Holdings</span>
          <span className="sm:hidden">HH</span>
        </span>

        {/* Scrollable nav — no wrap, no visible scrollbar */}
        <nav className="flex items-center gap-0.5 overflow-x-auto flex-1 scrollbar-none"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {LINKS.map(link => {
            const active = pathname === link.href
            return (
              <a key={link.href} href={link.href}
                className={`shrink-0 text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap min-h-[36px] flex items-center ${
                  active
                    ? 'font-medium text-white bg-gray-800'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}>
                {link.label}
              </a>
            )
          })}
        </nav>
      </div>
      <div className="h-7 px-3 border-t border-gray-800/80 flex items-center text-xs">
        <span className="text-gray-500 mr-2 shrink-0">Today top callers:</span>
        {topCallers.length === 0 ? (
          <span className="text-gray-600">No calls yet</span>
        ) : (
          <div className="flex items-center gap-3 overflow-x-auto scrollbar-none">
            {topCallers.map((c, i) => (
              <span key={c.name} className="text-gray-300 whitespace-nowrap">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {c.name} <span className="text-gray-500">({c.calls})</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}
