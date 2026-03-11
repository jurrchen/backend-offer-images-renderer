'use client'

import {
  AreaChart,
  Area,
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

interface MemoryChartProps {
  data: RenderAnalyticsRow[]
}

export function MemoryChart({ data }: MemoryChartProps) {
  const chartData = data.map((row) => ({
    time: format(new Date(row.timestamp), 'HH:mm'),
    rss: row.memory_rss_mb ?? 0,
    heapUsed: row.memory_heap_used_mb ?? 0,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Memory Usage Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} label={{ value: 'MB', position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            <Area
              type="monotone"
              dataKey="rss"
              stackId="1"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.3}
              name="RSS"
            />
            <Area
              type="monotone"
              dataKey="heapUsed"
              stackId="2"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.3}
              name="Heap Used"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
