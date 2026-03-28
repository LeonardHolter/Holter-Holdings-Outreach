import { Nav } from '@/components/Nav'
import Link from 'next/link'

const SETTINGS_ITEMS = [
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

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-xl mx-auto space-y-6">

          <div>
            <h1 className="text-xl font-bold text-white">Settings</h1>
            <p className="text-sm text-gray-500 mt-0.5">Tools and configuration</p>
          </div>

          <div className="space-y-2">
            {SETTINGS_ITEMS.map(item => (
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

        </div>
      </div>
    </div>
  )
}
