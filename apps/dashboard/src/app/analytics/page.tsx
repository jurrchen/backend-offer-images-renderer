import { rendererAnalytics } from '@/lib/renderer-analytics'
import { DurationChart } from '@/components/analytics/duration-chart'
import { AssetLoadingChart } from '@/components/analytics/asset-loading-chart'
import { MemoryChart } from '@/components/analytics/memory-chart'
import { SuccessRateChart } from '@/components/analytics/success-rate-chart'
import { DurationByMethodChart } from '@/components/analytics/duration-by-method-chart'
import { GeneratorUsageChart } from '@/components/analytics/generator-usage-chart'
import { ThroughputChart } from '@/components/analytics/throughput-chart'
import { QueueDepthChart } from '@/components/analytics/queue-depth-chart'
import { ApiResponseTimeChart } from '@/components/analytics/api-response-time-chart'
import { ApiStatusChart } from '@/components/analytics/api-status-chart'
import { AnalyticsFilters } from '@/components/analytics/filters'
import type { RenderAnalyticsRow, RendererApiMetricsRow } from '@fourthwall/shared'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: {
    server_url?: string
    source_type?: string
    print_method?: string
    from?: string
    to?: string
  }
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const [renderResult, apiResult] = await Promise.all([
    rendererAnalytics.renders({
      server_url: searchParams.server_url,
      source_type: searchParams.source_type,
      print_method: searchParams.print_method,
      from: searchParams.from,
      to: searchParams.to ? searchParams.to + 'T23:59:59' : undefined,
    }),
    rendererAnalytics.apiMetrics({
      from: searchParams.from,
      to: searchParams.to ? searchParams.to + 'T23:59:59' : undefined,
    }),
  ])

  // Charts expect ascending order (oldest first); renderer-server returns desc
  const rows = (([...renderResult.data] as unknown as RenderAnalyticsRow[])).reverse()
  const apiRows = (([...apiResult.data] as unknown as RendererApiMetricsRow[])).reverse()

  const fetchError = renderResult.error || apiResult.error

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
        <span className="text-sm text-muted-foreground">
          {rows.length} render records, {apiRows.length} API records
        </span>
      </div>

      <AnalyticsFilters />

      {fetchError && (
        <p className="text-red-500">Error fetching data: {fetchError}</p>
      )}

      {rows.length === 0 && apiRows.length === 0 && !fetchError ? (
        <p className="text-muted-foreground">No analytics data found. Run some renders first.</p>
      ) : (
        <>
          {rows.length > 0 && (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <DurationChart data={rows} />
                <AssetLoadingChart data={rows} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <MemoryChart data={rows} />
                <SuccessRateChart data={rows} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <DurationByMethodChart data={rows} />
                <GeneratorUsageChart data={rows} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <ThroughputChart data={rows} />
                <QueueDepthChart data={rows} />
              </div>
            </>
          )}

          {apiRows.length >= 10 && (
            <>
              <h3 className="text-xl font-semibold pt-4">API Metrics</h3>
              <div className="grid gap-6 lg:grid-cols-2">
                <ApiResponseTimeChart data={apiRows} />
                <ApiStatusChart data={apiRows} />
              </div>
            </>
          )}
          {apiRows.length > 0 && apiRows.length < 10 && (
            <p className="text-sm text-muted-foreground pt-4">
              API metrics: {apiRows.length} records (need 10+ to show charts)
            </p>
          )}
        </>
      )}
    </div>
  )
}
