'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function RecordingsPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing,  setPlaying]  = useState(false)
  const [current,  setCurrent]  = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume,   setVolume]   = useState(1)
  const [muted,    setMuted]    = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onPlay  = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime  = () => { if (!dragging) setCurrent(el.currentTime) }
    const onMeta  = () => { if (isFinite(el.duration)) setDuration(el.duration) }
    const onEnd   = () => { setPlaying(false); setCurrent(0) }
    el.addEventListener('play',           onPlay)
    el.addEventListener('pause',          onPause)
    el.addEventListener('timeupdate',     onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('ended',          onEnd)
    return () => {
      el.removeEventListener('play',           onPlay)
      el.removeEventListener('pause',          onPause)
      el.removeEventListener('timeupdate',     onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('ended',          onEnd)
    }
  }, [dragging])

  const seekToFraction = useCallback((clientX: number) => {
    const track = trackRef.current
    const el = audioRef.current
    if (!track || !el || !duration) return
    const rect = track.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const t = frac * duration
    el.currentTime = t
    setCurrent(t)
  }, [duration])

  // Mouse drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    seekToFraction(e.clientX)

    const onMove = (ev: PointerEvent) => seekToFraction(ev.clientX)
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [seekToFraction])

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }

  function skip(delta: number) {
    const el = audioRef.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(duration || 9999, el.currentTime + delta))
  }

  function changeVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current
    if (!el) return
    const v = Number(e.target.value)
    el.volume = v
    el.muted  = v === 0
    setVolume(v)
    setMuted(v === 0)
  }

  function toggleMute() {
    const el = audioRef.current
    if (!el) return
    el.muted = !muted
    setMuted(!muted)
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className="w-full select-none">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Scrub bar */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 w-9 text-right tabular-nums shrink-0">{fmt(current)}</span>

        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          className="relative flex-1 h-10 flex items-center cursor-pointer touch-none"
          style={{ minWidth: 0 }}
        >
          {/* Visual track */}
          <div className="absolute inset-x-0 h-2 rounded-full bg-gray-700">
            <div className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-[width] duration-75" style={{ width: `${pct}%` }} />
          </div>
          {/* Thumb */}
          <div
            className={`absolute w-5 h-5 rounded-full bg-white shadow-lg border-2 border-blue-500 transition-transform ${dragging ? 'scale-125' : ''}`}
            style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
          />
        </div>

        <span className="text-xs text-gray-500 w-9 tabular-nums shrink-0">{fmt(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => skip(-10)}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700/50 font-mono"
        >
          −10s
        </button>

        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 flex items-center justify-center transition-all shrink-0 shadow"
        >
          {playing ? (
            <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1.5"/>
              <rect x="14" y="4" width="4" height="16" rx="1.5"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        <button
          onClick={() => skip(10)}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700/50 font-mono"
        >
          +10s
        </button>

        <div className="flex-1" />

        <button onClick={toggleMute} className="text-gray-500 hover:text-gray-300 transition-colors shrink-0 p-1">
          {muted || volume === 0 ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          )}
        </button>

        <input
          type="range" min={0} max={1} step={0.05}
          value={muted ? 0 : volume}
          onChange={changeVolume}
          className="w-16 accent-blue-500 cursor-pointer"
        />
      </div>
    </div>
  )
}
