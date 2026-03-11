import { rendererAnalytics } from '@/lib/renderer-analytics'
import { ErrorTimelineChart } from '@/components/errors/error-timeline-chart'
import { ErrorCategoryChart } from '@/components/errors/error-category-chart'
import { ErrorTable } from '@/components/errors/error-table'
import type { ErrorAnalyticsRow } from '@fourthwall/shared'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: {
    service?: string
    error_category?: string
    from?: string
    to?: string
  }
}

export default async function ErrorsPage({ searchParams }: Props) {
  const { data, error } = await rendererAnalytics.errors({
    service: searchParams.service,
    error_category: searchParams.error_category,
    from: searchParams.from,
    to: searchParams.to ? searchParams.to + 'T23:59:59' : undefined,
  })

  const rows = data as unknown as ErrorAnalyticsRow[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Errors</h2>
        <span className="text-sm text-muted-foreground">{rows.length} records</span>
      </div>

      {error && (
        <p className="text-red-500">Error fetching data: {error}</p>
      )}

      {rows.length === 0 && !error ? (
        <p className="text-muted-foreground">No error data found. This is a good thing!</p>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <ErrorTimelineChart data={rows} />
            <ErrorCategoryChart data={rows} />
          </div>
          <ErrorTable data={rows} />
        </>
      )}
    </div>
  )
}
