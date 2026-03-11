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
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorkerPoolMetricsRow } from '@fourthwall/shared'
import { format } from 'date-fns'
import { formatDateTime, relativeTime } from '@/lib/utils/formatters'

interface ChartRow {
  time: string
  timestamp: string
  workers_busy: number
  workers_idle: number
  workers_error: number
  workers_total: number
  queue_depth: number
  total_jobs_processed: number
}

interface Props {
  data: WorkerPoolMetricsRow[]
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  const utilPct = row.workers_total > 0
    ? Math.round((row.workers_busy / row.workers_total) * 100)
    : 0

  return (
    <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2.5 text-zinc-100 shadow-xl text-xs space-y-1.5 min-w-[200px]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-semibold">{formatDateTime(row.timestamp)}</span>
        <span className="text-muted-foreground">{relativeTime(row.timestamp)}</span>
      </div>
      <div className="border-t pt-1.5 space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <span>Utilization</span>
          <span className="font-mono font-semibold">{utilPct}%</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
            <span>Busy</span>
          </div>
          <span className="font-mono">{row.workers_busy}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#6b7280' }} />
            <span>Idle</span>
          </div>
          <span className="font-mono">{row.workers_idle}</span>
        </div>
        {row.workers_error > 0 && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
              <span>Error</span>
            </div>
            <span className="font-mono text-red-400">{row.workers_error}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Total Workers</span>
          <span className="font-mono">{row.workers_total}</span>
        </div>
      </div>
      <div className="border-t pt-1.5 space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#8b5cf6' }} />
            <span>Queue Depth</span>
          </div>
          <span className="font-mono">{row.queue_depth}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Jobs Processed</span>
          <span className="font-mono">{row.total_jobs_processed}</span>
        </div>
      </div>
    </div>
  )
}

export function WorkerUtilizationChart({ data }: Props) {
  const hasErrors = data.some((r) => (r.workers_error ?? 0) > 0)
  const workersTotal = data.length > 0 ? data[data.length - 1].workers_total : 0

  const chartData: ChartRow[] = data.map((row) => ({
    time: format(new Date(row.timestamp), 'HH:mm'),
    timestamp: row.timestamp,
    workers_busy: row.workers_busy,
    workers_idle: row.workers_idle,
    workers_error: row.workers_error ?? 0,
    workers_total: row.workers_total,
    queue_depth: row.queue_depth,
    total_jobs_processed: row.total_jobs_processed,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Worker & Queue Pressure</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
            <Legend />
            {workersTotal > 0 && (
              <ReferenceLine
                y={workersTotal}
                stroke="#6b7280"
                strokeDasharray="6 3"
                label={{ value: `Capacity (${workersTotal})`, position: 'right', fontSize: 11, fill: '#6b7280' }}
              />
            )}
            <Area
              type="monotone"
              dataKey="workers_busy"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.3}
              strokeWidth={2}
              name="Busy Workers"
            />
            <Line
              type="monotone"
              dataKey="queue_depth"
              stroke="#8b5cf6"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              name="Queue Depth"
            />
            {hasErrors && (
              <Line
                type="monotone"
                dataKey="workers_error"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                name="Error Workers"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
