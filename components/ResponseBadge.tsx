interface Props {
  response: string | null | undefined
}

export function getResponseColor(response: string | null | undefined): string {
  if (!response) return ''
  if (response === 'Demo booked') return 'text-black bg-white font-bold'
  if (response === 'Not interested' || response === 'Wrong number') return 'text-red-300 bg-red-950/60'
  if (response === 'Call back later') return 'text-yellow-300 bg-yellow-950/60'
  if (response === 'Email sendt') return 'text-gray-200 bg-gray-800/80'
  if (response === 'No answer') return 'text-orange-300 bg-orange-950/60'
  if (response === 'Not called') return 'text-gray-400 bg-gray-800/60'
  return 'text-gray-300'
}

export function getRowHighlight(response: string | null | undefined): string {
  if (!response) return ''
  if (response === 'Demo booked') return 'bg-green-950/10 hover:bg-green-950/20'
  if (response === 'Not interested' || response === 'Wrong number') return 'bg-red-950/10 hover:bg-red-950/20'
  if (response === 'Call back later') return 'bg-yellow-950/10 hover:bg-yellow-950/20'
  if (response === 'No answer') return 'bg-orange-950/10 hover:bg-orange-950/20'
  if (response === 'Not called') return 'bg-gray-900/50 hover:bg-gray-800/50'
  return 'hover:bg-gray-800/30'
}

export function ResponseBadge({ response }: Props) {
  if (!response) return <span className="text-gray-600 text-xs">—</span>
  const colorClass = getResponseColor(response)
  return (
    <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium truncate max-w-full ${colorClass}`}>
      {response}
    </span>
  )
}
