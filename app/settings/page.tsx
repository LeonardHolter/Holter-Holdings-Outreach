import { Nav } from '@/components/Nav'
import Link from 'next/link'

const MAIN_ITEMS = [
  {
    href: '/pipeline',
    title: 'Pipeline',
    description: 'Full company list with filters, search, and response tracking.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    href: '/meetings',
    title: 'Leads',
    description: 'Companies that want an intro meeting, sorted by priority and follow-up date.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/stats',
    title: 'Stats',
    description: 'Leaderboard, call volume, intro rates, talk time, and pipeline breakdown.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
]

const TOOL_ITEMS = [
  {
    href: '/quick-add',
    title: 'Quick Add',
    description: 'Paste a Google Maps listing to extract and add a company to the pipeline instantly.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
  {
    href: '/numbers',
    title: 'Numbers & Inbox',
    description: 'View Twilio number health, daily usage caps, and the incoming SMS/call inbox.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
]

function ItemList({ items }: { items: typeof MAIN_ITEMS }) {
  return (
    <div className="space-y-2">
      {items.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-4 p-4 bg-gray-900 border border-gray-800 rounded-2xl hover:border-gray-700 hover:bg-gray-900/80 transition-all group"
        >
          <div className="w-11 h-11 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 group-hover:text-white group-hover:border-gray-600 transition-colors shrink-0">
            {item.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">{item.title}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.description}</p>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-xl mx-auto space-y-6">

          <div>
            <h1 className="text-xl font-bold text-white">Menu</h1>
            <p className="text-sm text-gray-500 mt-0.5">All pages and tools</p>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-2 px-1">Views</p>
              <ItemList items={MAIN_ITEMS} />
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-2 px-1">Tools</p>
              <ItemList items={TOOL_ITEMS} />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
