'use client'

export default function RecordingsPlayer({ src }: { src: string }) {
  return (
    <audio
      controls
      src={src}
      preload="none"
      className="h-8 w-48 shrink-0"
    />
  )
}
