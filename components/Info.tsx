'use client'

import { useRef, useState } from 'react'

/**
 * Hover explanation for a metric.
 *
 * The first version used the native `title` attribute — it never showed up in
 * practice (browsers delay it ~1s, and on a "?" this small the pointer often
 * moves before it fires). This renders our own bubble instead, positioned with
 * `position: fixed` from the trigger's bounding rect so it escapes the
 * `overflow-x-auto` scroll boxes every stats table lives in — CSS makes
 * overflow-y compute to `auto` alongside overflow-x, which is what would clip
 * an absolutely-positioned popup.
 *
 * Opens on hover AND on focus/click, so it works on touch and by keyboard.
 */
export function Info({ text }: { text: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  function open() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 })
  }

  return (
    <span className="relative inline-block align-middle">
      <button
        ref={ref}
        type="button"
        aria-label={text}
        onMouseEnter={open}
        onMouseLeave={() => setPos(null)}
        onFocus={open}
        onBlur={() => setPos(null)}
        onClick={() => (pos ? setPos(null) : open())}
        className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-gray-600 text-[9px] font-normal leading-none text-gray-400 hover:border-gray-400 hover:text-gray-200"
      >
        ?
      </button>

      {pos && (
        <span
          role="tooltip"
          // -translate-x-1/2 centres the bubble on the "?"; max-w keeps long
          // explanations readable rather than one endless line.
          className="pointer-events-none fixed z-[100] block w-64 max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-lg border border-gray-700 bg-black px-3 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-gray-300 shadow-xl"
          style={{ top: pos.top, left: pos.left }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
