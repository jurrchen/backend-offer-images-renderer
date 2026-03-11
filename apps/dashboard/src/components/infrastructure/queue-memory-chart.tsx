'use client'

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorkerPoolMetricsRow } from '@fourthwall/shared'
import { format } from 'date-fns'
import { formatDateTime, relativeTime, formatMb, formatMs } from '@/lib/utils/formatters'

interface ChartRow {
  time: string
  timestamp: string
  memory_rss_mb: number
  memory_heap_used_mb: number
  event_loop_lag_ms: number
}

interface Props {
  data: WorkerPoolMetricsRow[]
}

function lagColor(ms: number): string {
  if (ms < 50) return '#22c55e'
  if (ms < 200) return '#f59e0b'
  return '#ef4444'
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  const overhead = Math.max(0, row.memory_rss_mb - row.memory_heap_used_mb)

  return (
    <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2.5 text-zinc-100 shadow-xl text-xs space-y-1.5 min-w-[200px]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-semibold">{formatDateTime(row.timestamp)}</span>
        <span className="text-muted-foreground">{relativeTime(row.timestamp)}</span>
      </div>
      <div className="border-t pt-1.5 space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
            <span>RSS</span>
          </div>
          <span className="font-mono">{formatMb(row.memory_rss_mb)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#fb923c' }} />
            <span>Heap Used</span>
          </div>
          <span className="font-mono">{formatMb(row.memory_heap_used_mb)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground ml-4">Overhead (native/GL)</span>
          <span className="font-mono">{formatMb(overhead)}</span>
        </div>
      </div>
      <div className="border-t pt-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: lagColor(row.event_loop_lag_ms) }}
            />
            <span>Event Loop Lag</span>
          </div>
          <span className="font-mono" style={{ color: lagColor(row.event_loop_lag_ms) }}>
            {formatMs(row.event_loop_lag_ms)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function QueueMemoryChart({ data }: Props) {
  const chartData: ChartRow[] = data.map((row) => ({
    time: format(new Date(row.timestamp), 'HH:mm'),
    timestamp: row.timestamp,
    memory_rss_mb: row.memory_rss_mb ?? 0,
    memory_heap_used_mb: row.memory_heap_used_mb ?? 0,
    event_loop_lag_ms: row.event_loop_lag_ms ?? 0,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Memory & Event Loop</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis
              yAxisId="left"
              fontSize={12}
              label={{ value: 'MB', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              fontSize={12}
              label={{ value: 'ms', angle: 90, position: 'insideRight', fontSize: 11 }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
            <Legend />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="memory_rss_mb"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.2}
              strokeWidth={2}
              name="RSS (MB)"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="memory_heap_used_mb"
              stroke="#fb923c"
              strokeWidth={2}
              dot={false}
              name="Heap Used (MB)"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="event_loop_lag_ms"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="Event Loop Lag (ms)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
