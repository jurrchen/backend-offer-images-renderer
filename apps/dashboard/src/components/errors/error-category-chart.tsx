'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ErrorAnalyticsRow } from '@fourthwall/shared'

const COLORS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6',
  '#06b6d4', '#ec4899', '#f97316', '#6366f1', '#6b7280',
]

interface Props {
  data: ErrorAnalyticsRow[]
}

export function ErrorCategoryChart({ data }: Props) {
  const counts = new Map<string, number>()
  for (const row of data) {
    counts.set(row.error_category, (counts.get(row.error_category) || 0) + 1)
  }

  const chartData = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Error Categories</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              label={({ name, value }) => `${name}: ${value}`}
            >
              {chartData.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
