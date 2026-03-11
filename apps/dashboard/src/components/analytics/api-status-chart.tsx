'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RendererApiMetricsRow } from '@fourthwall/shared'

const STATUS_COLORS: Record<string, string> = {
  '2xx': '#10b981',
  '4xx': '#f59e0b',
  '5xx': '#ef4444',
}

interface Props {
  data: RendererApiMetricsRow[]
}

function statusBucket(code: number): string {
  if (code < 300) return '2xx'
  if (code < 500) return '4xx'
  return '5xx'
}

export function ApiStatusChart({ data }: Props) {
  // Group by endpoint, count by status bucket
  const endpointMap = new Map<string, Record<string, number>>()
  for (const row of data) {
    if (!endpointMap.has(row.endpoint)) {
      endpointMap.set(row.endpoint, { endpoint: row.endpoint, '2xx': 0, '4xx': 0, '5xx': 0 } as any)
    }
    const bucket = statusBucket(row.status_code)
    endpointMap.get(row.endpoint)![bucket]++
  }

  const chartData = Array.from(endpointMap.values())
    .sort((a: any, b: any) => (b['2xx'] + b['4xx'] + b['5xx']) - (a['2xx'] + a['4xx'] + a['5xx']))
    .slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">API Status Codes by Endpoint</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="endpoint" fontSize={10} angle={-20} textAnchor="end" height={60} />
            <YAxis fontSize={12} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="2xx" stackId="1" fill={STATUS_COLORS['2xx']} name="2xx" />
            <Bar dataKey="4xx" stackId="1" fill={STATUS_COLORS['4xx']} name="4xx" />
            <Bar dataKey="5xx" stackId="1" fill={STATUS_COLORS['5xx']} name="5xx" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
