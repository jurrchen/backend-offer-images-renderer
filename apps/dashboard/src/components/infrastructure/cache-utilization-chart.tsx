'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CacheAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'
import { formatDateTime, relativeTime, formatBytes } from '@/lib/utils/formatters'

const CACHE_COLORS: Record<string, string> = {
  texture_memory: '#3b82f6',
  mesh_memory: '#10b981',
  disk: '#f59e0b',
}

const CACHE_LABELS: Record<string, string> = {
  texture_memory: 'Texture',
  mesh_memory: 'Mesh',
  disk: 'Disk',
}

interface BucketRow {
  time: string
  timestamp: string
  [key: string]: string | number | null | undefined
}

interface Props {
  data: CacheAnalyticsRow[]
}

function CustomTooltip({
  active,
  payload,
  cacheTypes,
  rawMap,
}: {
  active?: boolean
  payload?: Array<{ payload: BucketRow }>
  cacheTypes: string[]
  rawMap: Map<string, Map<string, CacheAnalyticsRow>>
}) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload

  return (
    <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2.5 text-zinc-100 shadow-xl text-xs space-y-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-semibold">{formatDateTime(row.timestamp)}</span>
        <span className="text-muted-foreground">{relativeTime(row.timestamp)}</span>
      </div>
      <div className="border-t pt-1.5 space-y-2">
        {cacheTypes.map((type) => {
          const raw = rawMap.get(row.time)?.get(type)
          const util = row[`${type}_util`] as number | null | undefined
          if (util == null && !raw) return null
          return (
            <div key={type} className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 font-semibold">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: CACHE_COLORS[type] || '#6b7280' }}
                  />
                  <span>{CACHE_LABELS[type] || type}</span>
                </div>
                {util != null && (
                  <span className="font-mono font-semibold" style={{
                    color: util > 90 ? '#ef4444' : util > 70 ? '#f59e0b' : '#22c55e',
                  }}>
                    {util}%
                  </span>
                )}
              </div>
              {raw && (
                <div className="ml-4 text-muted-foreground space-y-0.5">
                  <div className="flex justify-between gap-3">
                    <span>Entries</span>
                    <span className="font-mono">{raw.entries} / {raw.max_entries}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Size</span>
                    <span className="font-mono">
                      {formatBytes(raw.size_bytes)} / {formatBytes(raw.max_size_bytes)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CacheUtilizationChart({ data }: Props) {
  const cacheTypes = [...new Set(data.map((d) => d.cache_type))]

  // Build time buckets with utilization per cache type
  const buckets = new Map<string, BucketRow>()
  const rawMap = new Map<string, Map<string, CacheAnalyticsRow>>()

  for (const row of data) {
    const time = format(new Date(row.timestamp), 'HH:mm')
    if (!buckets.has(time)) buckets.set(time, { time, timestamp: row.timestamp })
    const bucket = buckets.get(time)!
    bucket[`${row.cache_type}_util`] = Math.round(row.utilization_pct)

    if (!rawMap.has(time)) rawMap.set(time, new Map())
    rawMap.get(time)!.set(row.cache_type, row)
  }

  const chartData = Array.from(buckets.values())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Cache Capacity</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis fontSize={12} domain={[0, 100]} label={{ value: '%', position: 'insideLeft', fontSize: 11 }} />
            <Tooltip
              content={<CustomTooltip cacheTypes={cacheTypes} rawMap={rawMap} />}
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            />
            <Legend />
            <ReferenceLine
              y={90}
              stroke="#ef4444"
              strokeDasharray="6 3"
              label={{ value: 'Warning (90%)', position: 'right', fontSize: 11, fill: '#ef4444' }}
            />
            {cacheTypes.map((type) => (
              <Area
                key={`${type}_util`}
                type="monotone"
                dataKey={`${type}_util`}
                stroke={CACHE_COLORS[type] || '#6b7280'}
                fill={CACHE_COLORS[type] || '#6b7280'}
                fillOpacity={0.3}
                strokeWidth={2}
                name={`${CACHE_LABELS[type] || type} Utilization`}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
