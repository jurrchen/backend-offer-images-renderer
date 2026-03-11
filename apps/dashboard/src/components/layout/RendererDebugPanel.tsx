'use client'

import { useState, useEffect } from 'react'
import { useRendererConfig } from '@/contexts/RendererConfigContext'
import { useHealthMonitor } from '@/hooks/useHealthMonitor'
import { Sparkline } from '@/components/ui/sparkline'
import { Settings, X } from 'lucide-react'

const COLLAPSED_KEY = 'renderer-debug-collapsed'

export function RendererDebugPanel() {
  const { rendererUrl, setRendererUrl } = useRendererConfig()
  const { current, history, error } = useHealthMonitor(rendererUrl, true)
  const [collapsed, setCollapsed] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate collapsed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY)
    if (stored !== null) setCollapsed(stored === 'true')
    setHydrated(true)
  }, [])

  // Persist collapsed state
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    }
  }, [collapsed, hydrated])

  const busy = current?.workerStatus.busy ?? 0
  const total = current ? current.workerStatus.idle + current.workerStatus.busy : 0
  const isHealthy = current?.status === 'healthy'
  const hasError = !!error && !current

  const queueHistory = history.map((s) => s.queueDepth)
  const queueWarning = (current?.queueDepth ?? 0) > 10

  // Collapsed pill
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 shadow-lg transition-shadow hover:shadow-xl"
      >
        <div
          className={`h-2 w-2 rounded-full ${
            hasError ? 'bg-yellow-500' : isHealthy ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="text-xs font-medium">Renderer</span>
        {current && (
          <span className="text-xs font-mono text-muted-foreground">
            {busy}/{total}
          </span>
        )}
      </button>
    )
  }

  // Expanded panel
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[272px] rounded-lg border bg-card shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold">Renderer Status</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="rounded p-1 hover:bg-muted transition-colors"
            title="Settings"
          >
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="rounded p-1 hover:bg-muted transition-colors"
            title="Collapse"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Settings row */}
      {showSettings && (
        <div className="border-b px-3 py-2">
          <label className="text-[10px] text-muted-foreground">Renderer URL</label>
          <input
            type="text"
            value={rendererUrl}
            onChange={(e) => setRendererUrl(e.target.value)}
            className="mt-0.5 flex h-7 w-full rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="http://localhost:3000"
          />
        </div>
      )}

      {/* Body */}
      <div className="space-y-2 px-3 py-2.5">
        {hasError ? (
          <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
            {error}
          </p>
        ) : current ? (
          <>
            {/* Workers */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Workers</span>
              <span className="text-xs font-mono">
                <span className="text-orange-600 dark:text-orange-400">{busy}</span>
                {' busy / '}
                <span className="text-green-600 dark:text-green-400">
                  {current.workerStatus.idle}
                </span>
                {' idle'}
              </span>
            </div>

            {/* Queue */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Queue</span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-mono font-bold ${
                    queueWarning ? 'text-red-600 dark:text-red-400' : ''
                  }`}
                >
                  {current.queueDepth}
                </span>
                <Sparkline data={queueHistory} width={80} height={18} />
              </div>
            </div>

            {/* RSS */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">RSS</span>
              <span className="text-xs font-mono">{current.memory.rssMb}MB</span>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-2 w-2 rounded-full ${
                    isHealthy ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-xs">{current.status}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Connecting...</p>
        )}
      </div>
    </div>
  )
}
