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
import type { RenderAnalyticsRow } from '@fourthwall/shared'

interface AssetLoadingChartProps {
  data: RenderAnalyticsRow[]
}

export function AssetLoadingChart({ data }: AssetLoadingChartProps) {
  const chartData = data
    .filter((r) => r.asset_network_ms != null || r.asset_processing_ms != null)
    .slice(0, 50)
    .map((row, i) => ({
      name: row.generator_id.substring(0, 8),
      network: row.asset_network_ms ?? 0,
      processing: row.asset_processing_ms ?? 0,
    }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Asset Loading Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" fontSize={10} />
            <YAxis fontSize={12} label={{ value: 'ms', position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="network" stackId="a" fill="#3b82f6" name="Network" />
            <Bar dataKey="processing" stackId="a" fill="#f59e0b" name="Processing" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
