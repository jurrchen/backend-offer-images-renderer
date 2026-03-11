'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RenderAnalyticsRow } from '@fourthwall/shared'

interface DurationByMethodChartProps {
  data: RenderAnalyticsRow[]
}

export function DurationByMethodChart({ data }: DurationByMethodChartProps) {
  const byMethod: Record<string, number[]> = {}
  data.forEach((row) => {
    const method = row.print_method || 'UNKNOWN'
    if (!byMethod[method]) byMethod[method] = []
    byMethod[method].push(row.duration_ms)
  })

  const chartData = Object.entries(byMethod).map(([method, durations]) => ({
    method,
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    count: durations.length,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Avg Duration by Production Method</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" fontSize={12} label={{ value: 'ms', position: 'insideBottom' }} />
            <YAxis dataKey="method" type="category" fontSize={12} width={120} />
            <Tooltip formatter={(value: number) => [`${value}ms`, 'Avg Duration']} />
            <Bar dataKey="avg" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
