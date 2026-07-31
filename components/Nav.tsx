'use client'

import { usePathname } from 'next/navigation'
import { Leaderboard } from './Leaderboard'

const LINKS = [
  { href: '/call',            label: 'Call'       },
  { href: '/pipeline',        label: 'Companies'  },
  { href: '/demos',           label: 'Demos'      },
  { href: '/lead-behandling', label: 'Behandling' },
  { href: '/stats',           label: 'Stats'      },
  { href: '/recordings',      label: 'Recordings' },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <>
    <header className="shrink-0 border-b border-gray-800 bg-black safe-top">
      <div className="flex items-stretch h-12 px-3 sm:px-4 gap-4">
        {/* Brand mark */}
        <a href="/call" className="flex items-center gap-2 shrink-0">
          <span className="w-5 h-5 rounded-sm bg-white flex items-center justify-center">
            <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </span>
          <span className="font-semibold text-white text-sm tracking-tight">
            <span className="hidden sm:inline">AI Receptionist</span>
            <span className="sm:hidden">AIR</span>
            <span className="ml-1.5 font-mono text-[10px] font-normal uppercase tracking-widest text-gray-500">Sales</span>
          </span>
        </a>

        {/* Nav links — active gets a white underline, console style */}
        <nav className="flex items-stretch overflow-x-auto flex-1 scrollbar-none"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {LINKS.map(link => {
            const active = pathname === link.href
            return (
              <a key={link.href} href={link.href}
                className={`shrink-0 relative flex items-center px-3 text-sm whitespace-nowrap transition-colors ${
                  active
                    ? 'text-white font-medium'
                    : 'text-gray-500 hover:text-gray-200'
                }`}>
                {link.label}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-white" />}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
    {/* All-time wins leaderboard — every page gets it via Nav. */}
    <Leaderboard />
    </>
  )
}
