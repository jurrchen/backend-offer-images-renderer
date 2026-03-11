'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RendererApiMetricsRow } from '@fourthwall/shared'
import { format } from 'date-fns'

const ENDPOINT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
]

interface Props {
  data: RendererApiMetricsRow[]
}

export function ApiResponseTimeChart({ data }: Props) {
  // Find top 5 endpoints by frequency
  const endpointCounts = new Map<string, number>()
  for (const row of data) {
    endpointCounts.set(row.endpoint, (endpointCounts.get(row.endpoint) || 0) + 1)
  }
  const topEndpoints = Array.from(endpointCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ep]) => ep)

  const filtered = data.filter((r) => topEndpoints.includes(r.endpoint))

  // Group by time
  const buckets = new Map<string, Record<string, any>>()
  for (const row of filtered) {
    const time = format(new Date(row.timestamp), 'HH:mm')
    if (!buckets.has(time)) buckets.set(time, { time })
    const bucket = buckets.get(time)!
    if (bucket[row.endpoint] == null) {
      bucket[row.endpoint] = row.duration_ms
    } else {
      bucket[row.endpoint] = Math.round((bucket[row.endpoint] + row.duration_ms) / 2)
    }
  }

  const chartData = Array.from(buckets.values())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">API Response Time by Endpoint</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} label={{ value: 'ms', position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            {topEndpoints.map((ep, i) => (
              <Line
                key={ep}
                type="monotone"
                dataKey={ep}
                stroke={ENDPOINT_COLORS[i]}
                strokeWidth={2}
                dot={chartData.length < 10}
                name={ep}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
