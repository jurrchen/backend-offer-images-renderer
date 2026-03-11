'use client'

import { useReducer, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────

export interface SlugRunResult {
  image: string
  color: string
  view: string
  region: string
}

export interface SlugRunState {
  slug: string
  index: number
  status: 'pending' | 'running' | 'done' | 'failed'
  startedAt?: number
  completedAt?: number
  durationMs?: number
  results?: SlugRunResult[]
  imageCount?: number
  error?: string
  headers?: Record<string, string>
}

export interface BatchSummary {
  total: number
  completed: number
  failed: number
  running: number
  pending: number
  totalImages: number
  wallClockMs: number
  avgResponseMs: number
  minResponseMs: number
  maxResponseMs: number
}

interface State {
  runs: SlugRunState[]
  isRunning: boolean
  startedAt: number | null
}

// ─── Reducer ──────────────────────────────────────────────────

type Action =
  | { type: 'START'; slugs: string[] }
  | { type: 'SLUG_RUNNING'; index: number }
  | { type: 'SLUG_DONE'; index: number; results: SlugRunResult[]; durationMs: number; headers?: Record<string, string> }
  | { type: 'SLUG_FAILED'; index: number; error: string; durationMs: number }
  | { type: 'ALL_DONE' }
  | { type: 'RESET' }

const initialState: State = { runs: [], isRunning: false, startedAt: null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START': {
      const runs: SlugRunState[] = action.slugs.map((slug, i) => ({
        slug,
        index: i,
        status: 'pending',
      }))
      return { runs, isRunning: true, startedAt: Date.now() }
    }
    case 'SLUG_RUNNING':
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.index === action.index ? { ...r, status: 'running', startedAt: Date.now() } : r,
        ),
      }
    case 'SLUG_DONE':
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.index === action.index
            ? {
                ...r,
                status: 'done',
                completedAt: Date.now(),
                durationMs: action.durationMs,
                results: action.results,
                imageCount: action.results.length,
                headers: action.headers,
              }
            : r,
        ),
      }
    case 'SLUG_FAILED':
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.index === action.index
            ? {
                ...r,
                status: 'failed',
                completedAt: Date.now(),
                durationMs: action.durationMs,
                error: action.error,
              }
            : r,
        ),
      }
    case 'ALL_DONE':
      return { ...state, isRunning: false }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

// ─── Summary ──────────────────────────────────────────────────

function computeSummary(state: State): BatchSummary {
  const { runs, startedAt } = state
  const now = Date.now()
  const completed = runs.filter((r) => r.status === 'done')
  const failed = runs.filter((r) => r.status === 'failed')
  const running = runs.filter((r) => r.status === 'running')
  const pending = runs.filter((r) => r.status === 'pending')

  const durations = [...completed, ...failed]
    .map((r) => r.durationMs ?? 0)
    .filter((d) => d > 0)

  const totalImages = completed.reduce((sum, r) => sum + (r.imageCount ?? 0), 0)

  return {
    total: runs.length,
    completed: completed.length,
    failed: failed.length,
    running: running.length,
    pending: pending.length,
    totalImages,
    wallClockMs: startedAt ? now - startedAt : 0,
    avgResponseMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    minResponseMs: durations.length > 0 ? Math.min(...durations) : 0,
    maxResponseMs: durations.length > 0 ? Math.max(...durations) : 0,
  }
}

// ─── Hook ─────────────────────────────────────────────────────

export function useBatchBySlugRunner() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(
    async (slugs: string[], imageData: string, parallelism: number, rendererUrl: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      dispatch({ type: 'START', slugs })

      // Semaphore-style parallelism limiter
      let nextIndex = 0

      const runOne = async (): Promise<void> => {
        while (nextIndex < slugs.length) {
          if (controller.signal.aborted) return

          const index = nextIndex++
          const slug = slugs[index]

          dispatch({ type: 'SLUG_RUNNING', index })
          const t0 = performance.now()

          try {
            const res = await fetch('/api/batch-render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug, imageData, rendererUrl }),
              signal: controller.signal,
            })

            const durationMs = Math.round(performance.now() - t0)

            if (!res.ok) {
              const text = await res.text()
              let errorMsg: string
              try {
                errorMsg = JSON.parse(text).error || text
              } catch {
                errorMsg = text
              }
              dispatch({ type: 'SLUG_FAILED', index, error: `${res.status}: ${errorMsg}`, durationMs })
            } else {
              const data = await res.json()
              dispatch({
                type: 'SLUG_DONE',
                index,
                results: data.results ?? [],
                durationMs,
                headers: data.headers,
              })
            }
          } catch (err) {
            if (controller.signal.aborted) return
            const durationMs = Math.round(performance.now() - t0)
            dispatch({ type: 'SLUG_FAILED', index, error: (err as Error).message, durationMs })
          }
        }
      }

      // Launch `parallelism` workers
      const workers = Array.from({ length: Math.min(parallelism, slugs.length) }, () => runOne())
      await Promise.allSettled(workers)

      if (!controller.signal.aborted) {
        dispatch({ type: 'ALL_DONE' })
      }
    },
    [],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'ALL_DONE' })
  }, [])

  return {
    runs: state.runs,
    summary: computeSummary(state),
    isRunning: state.isRunning,
    start,
    reset,
    abort,
  }
}
