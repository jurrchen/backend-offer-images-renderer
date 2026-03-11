'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RenderAnalyticsRow } from '@fourthwall/shared'

interface SuccessRateChartProps {
  data: RenderAnalyticsRow[]
}

const COLORS = ['#10b981', '#ef4444']

export function SuccessRateChart({ data }: SuccessRateChartProps) {
  const success = data.filter((r) => r.status === 'success').length
  const failed = data.filter((r) => r.status === 'failed').length

  const chartData = [
    { name: 'Success', value: success },
    { name: 'Failed', value: failed },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Success / Failure Rate</CardTitle>
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
                <Cell key={index} fill={COLORS[index]} />
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
