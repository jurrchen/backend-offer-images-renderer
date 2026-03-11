'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RenderAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'

interface QueueDepthChartProps {
  data: RenderAnalyticsRow[]
}

export function QueueDepthChart({ data }: QueueDepthChartProps) {
  const chartData = data
    .filter((row) => row.queue_depth != null)
    .map((row) => ({
      time: format(new Date(row.timestamp), 'HH:mm'),
      queueDepth: row.queue_depth,
    }))

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Queue Depth Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No queue depth data recorded yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Queue Depth Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} label={{ value: 'Jobs', position: 'insideLeft' }} />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="queueDepth"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.3}
              name="Queue Depth"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
