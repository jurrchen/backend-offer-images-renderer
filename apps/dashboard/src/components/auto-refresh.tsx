'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  intervalMs?: number
  children?: React.ReactNode
}

export function AutoRefresh({ intervalMs = 15000 }: Props) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [secondsAgo, setSecondsAgo] = useState(0)

  const refresh = useCallback(() => {
    router.refresh()
    setLastRefresh(new Date())
  }, [router])

  // Auto-refresh interval
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs, refresh])

  // Tick the "seconds ago" counter
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastRefresh.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastRefresh])

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>Updated {secondsAgo}s ago</span>
      <button
        onClick={refresh}
        className="hover:text-foreground transition-colors"
        title="Refresh now"
      >
        ↻
      </button>
      <button
        onClick={() => setEnabled(!enabled)}
        className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
          enabled
            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
            : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
        }`}
      >
        {enabled ? 'LIVE' : 'PAUSED'}
      </button>
    </div>
  )
}
