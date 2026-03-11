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
import type { ErrorAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'

const CATEGORY_COLORS: Record<string, string> = {
  validation: '#3b82f6',
  timeout: '#f59e0b',
  worker_crash: '#ef4444',
  queue_full: '#8b5cf6',
  asset_fetch: '#06b6d4',
  gl_context: '#ec4899',
  upload_failed: '#f97316',
  api_upstream: '#10b981',
  authentication: '#6366f1',
  unknown: '#6b7280',
}

interface Props {
  data: ErrorAnalyticsRow[]
}

export function ErrorTimelineChart({ data }: Props) {
  // Group into 1-hour buckets
  const buckets = new Map<string, Record<string, number>>()
  for (const row of data) {
    const hour = format(new Date(row.timestamp), 'MM/dd HH:00')
    if (!buckets.has(hour)) buckets.set(hour, { time: hour } as any)
    const bucket = buckets.get(hour)!
    bucket[row.error_category] = (bucket[row.error_category] as number || 0) + 1
  }

  const chartData = Array.from(buckets.values())
  const categories = [...new Set(data.map((d) => d.error_category))]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Error Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            {categories.map((cat) => (
              <Area
                key={cat}
                type="monotone"
                dataKey={cat}
                stackId="1"
                stroke={CATEGORY_COLORS[cat] || '#6b7280'}
                fill={CATEGORY_COLORS[cat] || '#6b7280'}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
