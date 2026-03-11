import { rendererAnalytics } from '@/lib/renderer-analytics'
import { StatCard } from '@/components/overview/stat-card'
import { AutoRefresh } from '@/components/auto-refresh'
import { Timer, CheckCircle, Hash, HardDrive, Layers, Workflow, XCircle, Clock } from 'lucide-react'
import { formatMs, formatMb } from '@/lib/utils/formatters'
import type { RenderAnalyticsRow } from '@fourthwall/shared'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const { data } = await rendererAnalytics.renders({ limit: '500' })
  const renderRows = data as unknown as RenderAnalyticsRow[]

  const totalRenders = renderRows.length
  const renderSuccessRate =
    totalRenders > 0
      ? renderRows.filter((r) => r.status === 'success').length / totalRenders
      : 0
  const avgDuration =
    totalRenders > 0
      ? renderRows.reduce((sum, r) => sum + r.duration_ms, 0) / totalRenders
      : 0
  const avgMemory =
    totalRenders > 0
      ? renderRows.reduce((sum, r) => sum + (r.memory_rss_mb ?? 0), 0) / totalRenders
      : 0
  const peakQueueDepth = renderRows.reduce((max, r) => Math.max(max, r.queue_depth ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <AutoRefresh intervalMs={30000} />
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Renderer</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <StatCard
            title="Avg Render Time"
            value={formatMs(avgDuration)}
            description="Across recent renders"
            icon={Timer}
          />
          <StatCard
            title="Render Success Rate"
            value={`${(renderSuccessRate * 100).toFixed(1)}%`}
            description={`${totalRenders} total renders`}
            icon={CheckCircle}
          />
          <StatCard
            title="Total Renders"
            value={totalRenders.toString()}
            description="Last 500 recorded"
            icon={Hash}
          />
          <StatCard
            title="Avg Memory (RSS)"
            value={formatMb(avgMemory)}
            description="During renders"
            icon={HardDrive}
          />
          <StatCard
            title="Peak Queue Depth"
            value={peakQueueDepth.toString()}
            description="Max queued jobs"
            icon={Layers}
          />
        </div>
      </div>
    </div>
  )
}
