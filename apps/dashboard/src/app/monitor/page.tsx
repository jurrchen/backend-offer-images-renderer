'use client'

import { useReducer, useRef, useEffect, useCallback } from 'react'
import {
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemorySnapshot {
  ts: number
  rss_mb: number
  heap_used_mb: number
  heap_total_mb: number
  external_mb: number
  array_buffers_mb: number
  workers: number
  workerStatus: { idle: number; busy: number; starting: number; error: number }
  queue_depth: number
  totalJobsProcessed: number
  container?: { limit_mb: number; usage_mb: number; usage_pct: number }
  uptime_s: number
}

type ConnectionStatus = 'disconnected' | 'live' | 'error'

interface State {
  snapshots: MemorySnapshot[]
  status: ConnectionStatus
  errorMsg: string | null
  rendererUrl: string
  intervalMs: number
  active: boolean
}

type Action =
  | { type: 'SET_URL'; url: string }
  | { type: 'SET_INTERVAL'; ms: number }
  | { type: 'TOGGLE_CONNECT' }
  | { type: 'SNAPSHOT'; data: MemorySnapshot }
  | { type: 'ERROR'; msg: string }
  | { type: 'DISCONNECT' }

const MAX_SNAPSHOTS = 120 // 2-min at 1s, 4-min at 2s

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_URL':
      return { ...state, rendererUrl: action.url }
    case 'SET_INTERVAL':
      return { ...state, intervalMs: action.ms }
    case 'TOGGLE_CONNECT':
      if (state.active) {
        return { ...state, active: false, status: 'disconnected', errorMsg: null }
      }
      return { ...state, active: true, status: 'live', errorMsg: null, snapshots: [] }
    case 'SNAPSHOT':
      return {
        ...state,
        status: 'live',
        errorMsg: null,
        snapshots:
          state.snapshots.length >= MAX_SNAPSHOTS
            ? [...state.snapshots.slice(-MAX_SNAPSHOTS + 1), action.data]
            : [...state.snapshots, action.data],
      }
    case 'ERROR':
      return { ...state, status: 'error', errorMsg: action.msg }
    case 'DISCONNECT':
      return { ...state, active: false, status: 'disconnected' }
    default:
      return state
  }
}

const DEFAULT_URL = 'http://localhost:3000'

function getStoredUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_URL
  return localStorage.getItem('renderer-monitor-url') ?? DEFAULT_URL
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rssColor(rss: number): string {
  if (rss < 1024) return '#22c55e'
  if (rss < 1536) return '#f59e0b'
  return '#ef4444'
}

function fmtTs(ts: number): string {
  return format(new Date(ts), 'HH:mm:ss')
}

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

// ─── Trend arrow ──────────────────────────────────────────────────────────────

function Trend({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev === undefined) return null
  const diff = current - prev
  if (Math.abs(diff) < 1) return <span className="text-muted-foreground text-xs ml-1">→</span>
  if (diff > 0) return <span className="text-red-500 text-xs ml-1">↑{Math.round(diff)}</span>
  return <span className="text-green-500 text-xs ml-1">↓{Math.round(Math.abs(diff))}</span>
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  trend,
}: {
  title: string
  value: string
  sub?: string
  trend?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold">{value}</span>
          {trend}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [state, dispatch] = useReducer(reducer, {
    snapshots: [],
    status: 'disconnected',
    errorMsg: null,
    rendererUrl: DEFAULT_URL,
    intervalMs: 2000,
    active: false,
  })

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  // Restore URL from localStorage on mount
  useEffect(() => {
    const stored = getStoredUrl()
    if (stored !== DEFAULT_URL) {
      dispatch({ type: 'SET_URL', url: stored })
    }
  }, [])

  // Persist URL to localStorage on change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('renderer-monitor-url', state.rendererUrl)
    }
  }, [state.rendererUrl])

  const poll = useCallback(async (url: string) => {
    try {
      const res = await fetch(
        `/api/memory-monitor?rendererUrl=${encodeURIComponent(url)}`,
        { cache: 'no-store' },
      )
      if (cancelledRef.current) return
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        dispatch({ type: 'ERROR', msg: body.error ?? `HTTP ${res.status}` })
        return
      }
      const d = await res.json()
      const snapshot: MemorySnapshot = {
        ts: Date.now(),
        rss_mb: d.process?.rss_mb ?? 0,
        heap_used_mb: d.process?.heap_used_mb ?? 0,
        heap_total_mb: d.process?.heap_total_mb ?? 0,
        external_mb: d.process?.external_mb ?? 0,
        array_buffers_mb: d.process?.array_buffers_mb ?? 0,
        workers: d.workers ?? 0,
        workerStatus: d.workerStatus ?? { idle: 0, busy: 0, starting: 0, error: 0 },
        queue_depth: d.queue_depth ?? 0,
        totalJobsProcessed: d.totalJobsProcessed ?? 0,
        container: d.container,
        uptime_s: d.uptime_s ?? 0,
      }
      dispatch({ type: 'SNAPSHOT', data: snapshot })
    } catch (err) {
      if (!cancelledRef.current) {
        dispatch({ type: 'ERROR', msg: (err as Error).message })
      }
    }
  }, [])

  // Start / stop polling when active or interval changes
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    cancelledRef.current = false

    if (!state.active || !state.rendererUrl) return

    const url = state.rendererUrl
    poll(url)
    intervalRef.current = setInterval(() => poll(url), state.intervalMs)

    return () => {
      cancelledRef.current = true
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [state.active, state.rendererUrl, state.intervalMs, poll])

  const { snapshots, status, errorMsg, rendererUrl, intervalMs, active } = state

  const current = snapshots[snapshots.length - 1]
  const prev = snapshots[snapshots.length - 2]

  // Chart data
  const chartData = snapshots.map((s) => ({
    time: fmtTs(s.ts),
    ts: s.ts,
    rss: s.rss_mb,
    heap: s.heap_used_mb,
    external: s.external_mb,
    array_buffers: s.array_buffers_mb,
    queue: s.queue_depth,
    workers_busy: s.workerStatus.busy,
  }))

  // Detect recycle events: RSS drops > 100MB between consecutive points
  const recycleTs = snapshots
    .map((s, i) => {
      if (i === 0) return null
      const drop = snapshots[i - 1].rss_mb - s.rss_mb
      return drop > 100 ? fmtTs(s.ts) : null
    })
    .filter(Boolean) as string[]

  // RSS color based on current value
  const currentRssColor = current ? rssColor(current.rss_mb) : '#22c55e'

  return (
    <div className="space-y-6">
      {/* ── Section 1: Config bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Live Monitor</h2>
        <div className="flex items-center gap-2">
          <Badge
            variant={status === 'live' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}
            className={status === 'live' ? 'bg-green-600 text-white animate-pulse' : ''}
          >
            {status.toUpperCase()}
          </Badge>
          {errorMsg && (
            <span className="text-xs text-destructive max-w-xs truncate" title={errorMsg}>
              {errorMsg}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-72"
          value={rendererUrl}
          onChange={(e) => dispatch({ type: 'SET_URL', url: e.target.value })}
          placeholder="http://localhost:3000"
          disabled={active}
        />
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={intervalMs}
          onChange={(e) => dispatch({ type: 'SET_INTERVAL', ms: Number(e.target.value) })}
          disabled={active}
        >
          <option value={2000}>2s</option>
          <option value={5000}>5s</option>
          <option value={10000}>10s</option>
        </select>
        <Button
          onClick={() => dispatch({ type: 'TOGGLE_CONNECT' })}
          variant={active ? 'destructive' : 'default'}
          className={active ? '' : 'bg-green-600 hover:bg-green-700 text-white'}
        >
          {active ? 'Disconnect' : 'Connect'}
        </Button>
        {snapshots.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {snapshots.length} snapshots · rolling {Math.round((snapshots.length * intervalMs) / 1000 / 60)}m window
          </span>
        )}
      </div>

      {/* ── Section 2: Stat cards ─────────────────────────────────────── */}
      {current && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            title="RSS"
            value={`${current.rss_mb} MB`}
            sub="resident set size"
            trend={<Trend current={current.rss_mb} prev={prev?.rss_mb} />}
          />
          <StatCard
            title="Heap Used"
            value={`${current.heap_used_mb} MB`}
            sub={`of ${current.heap_total_mb} MB total`}
            trend={<Trend current={current.heap_used_mb} prev={prev?.heap_used_mb} />}
          />
          <StatCard
            title="Workers"
            value={`${current.workerStatus.idle}/${current.workers} idle`}
            sub={`busy=${current.workerStatus.busy} starting=${current.workerStatus.starting}`}
          />
          <StatCard
            title="Queue Depth"
            value={String(current.queue_depth)}
            sub="pending jobs"
            trend={<Trend current={current.queue_depth} prev={prev?.queue_depth} />}
          />
          <StatCard
            title="Jobs Processed"
            value={String(current.totalJobsProcessed)}
            sub="cumulative"
          />
          <StatCard
            title="Uptime"
            value={fmtUptime(current.uptime_s)}
            sub={current.container ? `Container ${current.container.usage_pct}%` : undefined}
          />
        </div>
      )}

      {!current && !active && (
        <p className="text-muted-foreground text-sm">
          Enter a renderer URL and click Connect to start monitoring.
        </p>
      )}

      {!current && active && (
        <p className="text-muted-foreground text-sm animate-pulse">Waiting for first snapshot…</p>
      )}

      {/* ── Section 3: Charts ─────────────────────────────────────────── */}
      {snapshots.length > 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Chart 1: RSS over time */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">RSS over time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="rssGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={currentRssColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={currentRssColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" fontSize={11} />
                  <YAxis
                    fontSize={11}
                    label={{ value: 'MB', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v} MB`, 'RSS']}
                    labelFormatter={(l) => `Time: ${l}`}
                  />
                  <ReferenceLine y={1500} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '⚠️ 1.5GB', fontSize: 10, fill: '#f59e0b' }} />
                  <ReferenceLine y={6000} stroke="#ef4444" strokeDasharray="4 2" label={{ value: '🔴 6GB', fontSize: 10, fill: '#ef4444' }} />
                  {recycleTs.map((t) => (
                    <ReferenceLine key={t} x={t} stroke="#a855f7" strokeDasharray="3 3" label={{ value: '♻️', fontSize: 10 }} />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="rss"
                    stroke={currentRssColor}
                    fill="url(#rssGrad)"
                    strokeWidth={2}
                    dot={false}
                    name="RSS (MB)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart 2: Memory breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Memory breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" fontSize={11} />
                  <YAxis
                    fontSize={11}
                    label={{ value: 'MB', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  />
                  <Tooltip formatter={(v: number, name: string) => [`${v} MB`, name]} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="heap"
                    stackId="1"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.6}
                    strokeWidth={1.5}
                    dot={false}
                    name="Heap Used"
                  />
                  <Area
                    type="monotone"
                    dataKey="external"
                    stackId="1"
                    stroke="#a855f7"
                    fill="#a855f7"
                    fillOpacity={0.5}
                    strokeWidth={1.5}
                    dot={false}
                    name="External"
                  />
                  <Area
                    type="monotone"
                    dataKey="array_buffers"
                    stackId="1"
                    stroke="#71717a"
                    fill="#71717a"
                    fillOpacity={0.4}
                    strokeWidth={1.5}
                    dot={false}
                    name="ArrayBuffers"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart 3: Queue + Workers busy */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Queue depth &amp; Workers busy</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" fontSize={11} />
                  <YAxis yAxisId="left" fontSize={11} allowDecimals={false} label={{ value: 'Queue', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" fontSize={11} allowDecimals={false} label={{ value: 'Workers', angle: 90, position: 'insideRight', fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="queue" fill="#f59e0b" fillOpacity={0.7} name="Queue Depth" />
                  <Line yAxisId="right" type="monotone" dataKey="workers_busy" stroke="#ef4444" strokeWidth={2} dot={false} name="Workers Busy" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart 4: Container usage (if available) or placeholder */}
          {current?.container ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Container memory — {current.container.usage_pct}% of {current.container.limit_mb} MB
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                  {/* Simple progress bar */}
                  <div className="h-6 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(current.container.usage_pct, 100)}%`,
                        backgroundColor:
                          current.container.usage_pct < 60
                            ? '#22c55e'
                            : current.container.usage_pct < 85
                            ? '#f59e0b'
                            : '#ef4444',
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{current.container.usage_mb} MB used</span>
                    <span>{current.container.limit_mb} MB limit</span>
                  </div>
                  {recycleTs.length > 0 && (
                    <p className="text-xs text-purple-400">
                      ♻️ {recycleTs.length} recycle event{recycleTs.length > 1 ? 's' : ''} detected in window
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recycle events</CardTitle>
              </CardHeader>
              <CardContent>
                {recycleTs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recycle events in current window (RSS drop &gt; 100 MB)</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {recycleTs.map((t) => (
                      <li key={t} className="flex items-center gap-2 text-purple-400">
                        ♻️ <span className="font-mono">{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Section 4: Raw log table ──────────────────────────────────── */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent snapshots (last 20)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="py-1 pr-4">Time</th>
                  <th className="py-1 pr-4">RSS MB</th>
                  <th className="py-1 pr-4">Heap MB</th>
                  <th className="py-1 pr-4">Ext MB</th>
                  <th className="py-1 pr-4">Queue</th>
                  <th className="py-1 pr-4">Idle/Busy</th>
                  <th className="py-1">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().slice(0, 20).map((s) => (
                  <tr key={s.ts} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="py-1 pr-4">{fmtTs(s.ts)}</td>
                    <td className="py-1 pr-4" style={{ color: rssColor(s.rss_mb) }}>{s.rss_mb}</td>
                    <td className="py-1 pr-4">{s.heap_used_mb}/{s.heap_total_mb}</td>
                    <td className="py-1 pr-4">{s.external_mb}</td>
                    <td className="py-1 pr-4">{s.queue_depth}</td>
                    <td className="py-1 pr-4">{s.workerStatus.idle}/{s.workerStatus.busy}</td>
                    <td className="py-1">{s.totalJobsProcessed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
