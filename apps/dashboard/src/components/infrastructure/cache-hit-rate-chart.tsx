'use client'

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CacheAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'
import { formatDateTime, relativeTime } from '@/lib/utils/formatters'

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

function hitRateColor(pct: number): string {
  if (pct > 80) return '#22c55e'
  if (pct > 50) return '#f59e0b'
  return '#ef4444'
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
          const hitRate = row[`${type}_rate`] as number | null | undefined
          if (hitRate == null && !raw) return null
          return (
            <div key={type} className="space-y-0.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: CACHE_COLORS[type] || '#6b7280' }}
                />
                <span>{CACHE_LABELS[type] || type}</span>
                {hitRate != null && (
                  <span className="ml-auto font-mono" style={{ color: hitRateColor(hitRate) }}>
                    {hitRate}%
                  </span>
                )}
              </div>
              {raw && (
                <div className="ml-4 text-muted-foreground space-y-0.5">
                  <div className="flex justify-between gap-3">
                    <span>Hits / Misses</span>
                    <span className="font-mono">{raw.hits ?? 0} / {raw.misses ?? 0}</span>
                  </div>
                  {(raw.evictions ?? 0) > 0 && (
                    <div className="flex justify-between gap-3">
                      <span>Evictions</span>
                      <span className="font-mono text-amber-400">{raw.evictions}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CacheHitRateChart({ data }: Props) {
  const cacheTypes = [...new Set(data.map((d) => d.cache_type))]
  const hasEvictions = data.some((d) => (d.evictions ?? 0) > 0)

  // Build buckets keyed by time, and keep raw data for tooltips
  const buckets = new Map<string, BucketRow>()
  const rawMap = new Map<string, Map<string, CacheAnalyticsRow>>()

  for (const row of data) {
    const time = format(new Date(row.timestamp), 'HH:mm')
    if (!buckets.has(time)) buckets.set(time, { time, timestamp: row.timestamp })
    const bucket = buckets.get(time)!

    // Use hit_rate_pct from DB directly
    bucket[`${row.cache_type}_rate`] = row.hit_rate_pct != null
      ? Math.round(row.hit_rate_pct)
      : null

    if (hasEvictions) {
      bucket[`${row.cache_type}_evictions`] = row.evictions ?? 0
    }

    // Store raw row for tooltip
    if (!rawMap.has(time)) rawMap.set(time, new Map())
    rawMap.get(time)!.set(row.cache_type, row)
  }

  const chartData = Array.from(buckets.values())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Cache Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis
              yAxisId="left"
              fontSize={12}
              domain={[0, 100]}
              label={{ value: '%', position: 'insideLeft', fontSize: 11 }}
            />
            {hasEvictions && (
              <YAxis
                yAxisId="right"
                orientation="right"
                fontSize={12}
                allowDecimals={false}
                label={{ value: 'evictions', position: 'insideRight', fontSize: 11 }}
              />
            )}
            <Tooltip
              content={<CustomTooltip cacheTypes={cacheTypes} rawMap={rawMap} />}
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            />
            <Legend />
            {cacheTypes.map((type) => (
              <Line
                key={`${type}_rate`}
                yAxisId="left"
                type="monotone"
                dataKey={`${type}_rate`}
                stroke={CACHE_COLORS[type] || '#6b7280'}
                strokeWidth={2}
                dot={false}
                name={`${CACHE_LABELS[type] || type} Hit Rate`}
                connectNulls
              />
            ))}
            {hasEvictions &&
              cacheTypes.map((type) => (
                <Bar
                  key={`${type}_evictions`}
                  yAxisId="right"
                  dataKey={`${type}_evictions`}
                  fill={CACHE_COLORS[type] || '#6b7280'}
                  fillOpacity={0.3}
                  name={`${CACHE_LABELS[type] || type} Evictions`}
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
