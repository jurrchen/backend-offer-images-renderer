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

interface GeneratorUsageChartProps {
  data: RenderAnalyticsRow[]
}

export function GeneratorUsageChart({ data }: GeneratorUsageChartProps) {
  const counts: Record<string, number> = {}
  data.forEach((row) => {
    const id = row.generator_id.substring(0, 16)
    counts[id] = (counts[id] || 0) + 1
  })

  const chartData = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([generator, count]) => ({ generator, count }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Generator Usage (Top 10)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" fontSize={12} />
            <YAxis dataKey="generator" type="category" fontSize={10} width={130} />
            <Tooltip />
            <Bar dataKey="count" fill="#06b6d4" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
