'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

export interface HealthSnapshot {
  timestamp: number
  status: string
  workers: number
  workerStatus: { idle: number; busy: number }
  queueDepth: number
  uptime: number
  memory: {
    rssMb: number
    heapUsedMb: number
    heapTotalMb: number
    externalMb: number
    containerUsedMb?: number
    containerLimitMb?: number
    containerUsagePercent?: number
  }
}

const MAX_HISTORY = 60 // 2 minutes at 2s interval

export function useHealthMonitor(rendererUrl: string, active: boolean) {
  const [current, setCurrent] = useState<HealthSnapshot | null>(null)
  const [history, setHistory] = useState<HealthSnapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  const reset = useCallback(() => {
    setCurrent(null)
    setHistory([])
    setError(null)
  }, [])

  useEffect(() => {
    if (!active || !rendererUrl) return

    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/health-proxy?rendererUrl=${encodeURIComponent(rendererUrl)}`,
        )
        if (cancelled) return

        if (!res.ok) {
          setError(`Health check failed (${res.status})`)
          return
        }

        const data = await res.json()
        const snapshot: HealthSnapshot = {
          timestamp: Date.now(),
          status: data.status,
          workers: data.workers,
          workerStatus: data.workerStatus,
          queueDepth: data.queueDepth,
          uptime: data.uptime,
          memory: data.memory,
        }

        setCurrent(snapshot)
        setHistory((prev) => {
          const next = [...prev, snapshot]
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
        })
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
        }
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [active, rendererUrl])

  return { current, history, error, reset }
}
