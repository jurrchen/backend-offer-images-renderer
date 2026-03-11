'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RenderAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'

interface ThroughputChartProps {
  data: RenderAnalyticsRow[]
}

export function ThroughputChart({ data }: ThroughputChartProps) {
  const validRows = data.filter((r) => r.duration_ms > 0)

  // Build a continuous minute-by-minute time series
  let chartData: { time: string; throughput: number }[] = []

  if (validRows.length > 0) {
    // Determine range: last 3 hours from the most recent data point
    const maxTs = Math.max(...validRows.map((r) => new Date(r.timestamp).getTime()))
    const rangeEnd = new Date(Math.ceil(maxTs / 60000) * 60000) // round up to next minute
    const rangeStart = new Date(rangeEnd.getTime() - 3 * 60 * 60 * 1000) // 3 hours back

    // Bucket renders by minute
    const buckets = new Map<number, { totalImages: number; totalDurationMs: number }>()
    for (const row of validRows) {
      const ts = new Date(row.timestamp).getTime()
      if (ts < rangeStart.getTime()) continue
      const minuteKey = Math.floor(ts / 60000) * 60000
      const bucket = buckets.get(minuteKey) ?? { totalImages: 0, totalDurationMs: 0 }
      bucket.totalImages += row.image_count
      bucket.totalDurationMs += row.duration_ms
      buckets.set(minuteKey, bucket)
    }

    // Fill every minute in the range
    for (let t = rangeStart.getTime(); t <= rangeEnd.getTime(); t += 60000) {
      const bucket = buckets.get(t)
      chartData.push({
        time: format(new Date(t), 'HH:mm'),
        throughput: bucket
          ? Number(((bucket.totalImages / bucket.totalDurationMs) * 1000).toFixed(2))
          : 0,
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Throughput (images/sec)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} label={{ value: 'img/s', position: 'insideLeft' }} />
            <Tooltip />
            <Line type="monotone" dataKey="throughput" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
