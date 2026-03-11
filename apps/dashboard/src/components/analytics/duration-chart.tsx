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
import type { RenderAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'

const PRINT_METHOD_COLORS: Record<string, string> = {
  DTG: '#3b82f6',
  SUBLIMATION: '#10b981',
  EMBROIDERY: '#f59e0b',
  UV: '#8b5cf6',
  ALL_OVER_PRINT: '#ef4444',
  PRINTED: '#06b6d4',
  KNITTED: '#ec4899',
  UNKNOWN: '#6b7280',
}

interface DurationChartProps {
  data: RenderAnalyticsRow[]
}

export function DurationChart({ data }: DurationChartProps) {
  const chartData = data.map((row) => ({
    time: format(new Date(row.timestamp), 'HH:mm'),
    duration: row.duration_ms,
    method: row.print_method || 'UNKNOWN',
  }))

  const methods = [...new Set(chartData.map((d) => d.method))]

  // Group by time for multi-line
  const grouped = chartData.reduce(
    (acc, item) => {
      const existing = acc.find((a) => a.time === item.time)
      if (existing) {
        existing[item.method] = item.duration
      } else {
        acc.push({ time: item.time, [item.method]: item.duration })
      }
      return acc
    },
    [] as Array<Record<string, any>>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Render Duration Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={grouped}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} label={{ value: 'ms', position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            {methods.map((method) => (
              <Line
                key={method}
                type="monotone"
                dataKey={method}
                stroke={PRINT_METHOD_COLORS[method] || '#6b7280'}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
