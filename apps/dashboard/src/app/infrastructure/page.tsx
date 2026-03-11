import { rendererAnalytics } from '@/lib/renderer-analytics'
import { WorkerUtilizationChart } from '@/components/infrastructure/worker-utilization-chart'
import { QueueMemoryChart } from '@/components/infrastructure/queue-memory-chart'
import { CacheHitRateChart } from '@/components/infrastructure/cache-hit-rate-chart'
import { CacheUtilizationChart } from '@/components/infrastructure/cache-utilization-chart'
import { AutoRefresh } from '@/components/auto-refresh'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorkerPoolMetricsRow, CacheAnalyticsRow } from '@fourthwall/shared'
import { formatMs, formatMb } from '@/lib/utils/formatters'

export const dynamic = 'force-dynamic'

export default async function InfrastructurePage() {
  const [workerResult, cacheResult] = await Promise.all([
    rendererAnalytics.workers({ limit: '500' }),
    rendererAnalytics.cache({ limit: '500' }),
  ])

  // Infrastructure charts expect ascending order (oldest first)
  const workerRows = (([...workerResult.data] as unknown as WorkerPoolMetricsRow[])).reverse()
  const cacheRows = (([...cacheResult.data] as unknown as CacheAnalyticsRow[])).reverse()
  const latestWorker = workerRows[workerRows.length - 1]

  const hasData = workerRows.length > 0 || cacheRows.length > 0
  const fetchError = workerResult.error || cacheResult.error

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Infrastructure</h2>
          <AutoRefresh intervalMs={15000} />
        </div>
        <span className="text-sm text-muted-foreground">
          {workerRows.length} worker snapshots, {cacheRows.length} cache snapshots
        </span>
      </div>

      {fetchError && (
        <p className="text-red-500">Error fetching data: {fetchError}</p>
      )}

      {!hasData && !fetchError ? (
        <p className="text-muted-foreground">No infrastructure metrics found. Start the renderer server to begin collecting data.</p>
      ) : (
        <>
          {latestWorker && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Workers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {latestWorker.workers_busy}/{latestWorker.workers_total}
                  </div>
                  <p className="text-xs text-muted-foreground">busy / total</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Queue Depth</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{latestWorker.queue_depth}</div>
                  <p className="text-xs text-muted-foreground">pending jobs</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Memory RSS</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMb(latestWorker.memory_rss_mb)}</div>
                  <p className="text-xs text-muted-foreground">resident set size</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Event Loop Lag</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMs(latestWorker.event_loop_lag_ms)}</div>
                  <p className="text-xs text-muted-foreground">latency</p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {workerRows.length > 0 && <WorkerUtilizationChart data={workerRows} />}
            {workerRows.length > 0 && <QueueMemoryChart data={workerRows} />}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {cacheRows.length > 0 && <CacheHitRateChart data={cacheRows} />}
            {cacheRows.length > 0 && <CacheUtilizationChart data={cacheRows} />}
          </div>
        </>
      )}
    </div>
  )
}
