'use client'

import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/call',      label: 'Calling'    },
  { href: '/pipeline',  label: 'Companies'  },
  { href: '/demos',     label: 'Booked Demos' },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <header className="shrink-0 border-b border-gray-800 bg-gray-900 safe-top">
      <div className="flex items-center h-12 px-2 gap-1">
        <span className="font-semibold text-white text-sm px-2 shrink-0">
          <span className="hidden sm:inline">AI Receptionist Sales</span>
          <span className="sm:hidden">ARS</span>
        </span>

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
    </header>
  )
}
