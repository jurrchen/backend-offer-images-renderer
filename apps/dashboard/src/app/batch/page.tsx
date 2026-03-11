'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRendererConfig } from '@/contexts/RendererConfigContext'
import { useBatchBySlugRunner, type SlugRunState } from '@/hooks/useBatchBySlugRunner'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ZoomIn,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Upload,
  Square,
  Image as ImageIcon,
} from 'lucide-react'

// ─── Lightbox ────────────────────────────────────────────────────

interface LightboxImage {
  src: string
  label: string
  sublabel?: string
}

function Lightbox({
  images,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  images: LightboxImage[]
  index: number | null
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  useEffect(() => {
    if (index === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, onClose, onPrev, onNext])

  if (index === null) return null
  const img = images[index]
  if (!img) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {index > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          onClick={(e) => { e.stopPropagation(); onPrev() }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          onClick={(e) => { e.stopPropagation(); onNext() }}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      <button
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={img.src}
          alt={img.label}
          className="max-h-[80vh] max-w-[90vw] object-contain rounded-lg"
        />
        <div className="text-center text-sm text-white">
          <div className="font-medium">{img.label}</div>
          {img.sublabel && <div className="text-white/60">{img.sublabel}</div>}
          <div className="text-white/40 mt-1">{index + 1} / {images.length}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusBadge(status: SlugRunState['status']) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Pending</Badge>
    case 'running':
      return <Badge variant="warning"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Running</Badge>
    case 'done':
      return <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" />Done</Badge>
    case 'failed':
      return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Failed</Badge>
  }
}

// ─── Slug Row ────────────────────────────────────────────────────

function SlugRow({ run, onImageClick }: { run: SlugRunState; onImageClick: (images: LightboxImage[], startIndex: number) => void }) {
  const [expanded, setExpanded] = useState(false)

  const images: LightboxImage[] = (run.results ?? []).map((r) => ({
    src: `data:image/png;base64,${r.image}`,
    label: `${r.color} / ${r.view}`,
    sublabel: r.region,
  }))

  return (
    <>
      <tr className="border-b transition-colors hover:bg-muted/50">
        <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{run.index + 1}</td>
        <td className="px-4 py-3">
          <code className="text-sm font-mono">{run.slug}</code>
        </td>
        <td className="px-4 py-3">{statusBadge(run.status)}</td>
        <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
          {run.durationMs != null ? formatMs(run.durationMs) : '-'}
        </td>
        <td className="px-4 py-3 text-sm text-center">
          {run.imageCount != null ? run.imageCount : '-'}
        </td>
        <td className="px-4 py-3">
          {(run.results && run.results.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </td>
      </tr>
      {run.error && (
        <tr className="border-b">
          <td colSpan={6} className="px-4 py-2">
            <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all">{run.error}</p>
          </td>
        </tr>
      )}
      {expanded && run.results && run.results.length > 0 && (
        <tr className="border-b bg-muted/30">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {run.results.map((img, i) => (
                <div
                  key={i}
                  className="group relative aspect-square overflow-hidden rounded-lg border bg-muted cursor-pointer"
                  onClick={() => onImageClick(images, i)}
                >
                  <img
                    src={`data:image/png;base64,${img.image}`}
                    alt={`${img.color} ${img.view}`}
                    className="h-full w-full object-contain"
                  />
                  <div className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <div>{img.color} / {img.view}</div>
                    <div className="text-white/70">{img.region}</div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════
// Main component
// ═════════════════════════════════════════════════════════════════

export default function BatchRenderPage() {
  const { rendererUrl, setRendererUrl } = useRendererConfig()
  const { runs, summary, isRunning, start, reset, abort } = useBatchBySlugRunner()

  // Input state
  const [slugsText, setSlugsText] = useState('')
  const [parallelism, setParallelism] = useState(3)
  const [artworkData, setArtworkData] = useState<string | null>(null)
  const [artworkName, setArtworkName] = useState<string | null>(null)
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lightbox state — managed directly to avoid stale closure issues
  const [lbImages, setLbImages] = useState<LightboxImage[]>([])
  const [lbIndex, setLbIndex] = useState<number | null>(null)

  const handleImageClick = useCallback((images: LightboxImage[], startIndex: number) => {
    setLbImages(images)
    setLbIndex(startIndex)
  }, [])

  // File upload
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const preview = URL.createObjectURL(file)
    setArtworkPreview(preview)
    setArtworkName(file.name)

    const reader = new FileReader()
    reader.onload = () => {
      setArtworkData(reader.result as string)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  const clearArtwork = useCallback(() => {
    if (artworkPreview) URL.revokeObjectURL(artworkPreview)
    setArtworkData(null)
    setArtworkName(null)
    setArtworkPreview(null)
  }, [artworkPreview])

  // Parse slugs
  const slugs = slugsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const canStart = slugs.length > 0 && artworkData !== null && !isRunning

  const handleStart = () => {
    if (!artworkData) return
    start(slugs, artworkData, parallelism, rendererUrl)
  }

  const handleReset = () => {
    reset()
  }

  // Progress bar
  const progressPercent =
    summary.total > 0
      ? Math.round(((summary.completed + summary.failed) / summary.total) * 100)
      : 0

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Batch Render</h2>
      <p className="text-muted-foreground">
        Render multiple product slugs in parallel with a single artwork image. Each slug auto-resolves
        its generator, colors, views, and regions.
      </p>

      {/* Server Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Server Configuration</CardTitle>
          <CardDescription>Renderer server URL for batch requests</CardDescription>
        </CardHeader>
        <CardContent>
          <div>
            <label className="text-sm font-medium">Renderer Server</label>
            <Input
              value={rendererUrl}
              onChange={(e) => setRendererUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>
        </CardContent>
      </Card>

      {/* Input */}
      <Card>
        <CardHeader>
          <CardTitle>Batch Input</CardTitle>
          <CardDescription>Enter product slugs (one per line) and upload artwork</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Slugs textarea */}
          <div>
            <label className="text-sm font-medium">Product Slugs</label>
            <textarea
              value={slugsText}
              onChange={(e) => setSlugsText(e.target.value)}
              placeholder={
                'Enter one slug per line, e.g.:\nstanley-stella-organic-cotton-t-shirt-dtg\nstanley-stella-unisex-hoodie-dtg\ngildan-adult-hoodie-embroidery'
              }
              rows={6}
              className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
              disabled={isRunning}
            />
            {slugs.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {slugs.length} slug{slugs.length !== 1 ? 's' : ''} entered
              </p>
            )}
          </div>

          {/* Artwork upload */}
          <div>
            <label className="text-sm font-medium">Artwork Image</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />

            {artworkData ? (
              <div className="mt-2 flex items-center gap-3 rounded-lg border p-3">
                <img
                  src={artworkPreview!}
                  alt={artworkName!}
                  className="h-16 w-16 shrink-0 rounded border bg-muted object-contain"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium truncate">{artworkName}</p>
                  <p className="text-xs text-muted-foreground">
                    This image will be used for all slugs
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={clearArtwork} disabled={isRunning}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRunning}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Artwork
              </Button>
            )}
          </div>

          {/* Parallelism */}
          <div className="max-w-xs">
            <label className="text-sm font-medium">Parallelism</label>
            <Input
              type="number"
              min={1}
              max={20}
              value={parallelism}
              onChange={(e) => setParallelism(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              disabled={isRunning}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              Number of concurrent requests (1-20)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Run / Reset / Abort buttons */}
      <div className="flex items-center gap-3">
        <Button size="lg" onClick={handleStart} disabled={!canStart}>
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Rendering {summary.running} of {summary.total}...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Render {slugs.length} Slug{slugs.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
        {isRunning && (
          <Button variant="outline" size="lg" onClick={abort}>
            <Square className="mr-2 h-4 w-4" />
            Abort
          </Button>
        )}
        {runs.length > 0 && !isRunning && (
          <Button variant="outline" size="lg" onClick={handleReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        )}
      </div>

      {/* Live progress */}
      {runs.length > 0 && (
        <>
          {/* Progress bar */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    Progress: {summary.completed + summary.failed} / {summary.total}
                  </span>
                  <span className="font-mono text-muted-foreground">{progressPercent}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full transition-all duration-300 ${
                      summary.failed > 0 && !isRunning
                        ? 'bg-yellow-500'
                        : isRunning
                          ? 'bg-blue-500'
                          : 'bg-green-500'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {/* Stat chips */}
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                    {summary.completed} completed
                  </span>
                  {summary.failed > 0 && (
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                      {summary.failed} failed
                    </span>
                  )}
                  {summary.running > 0 && (
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                      {summary.running} running
                    </span>
                  )}
                  {summary.pending > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {summary.pending} pending
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results table */}
          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Slug</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium text-center">Images</th>
                      <th className="px-4 py-2 font-medium w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <SlugRow
                        key={run.index}
                        run={run}
                        onImageClick={handleImageClick}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Summary card */}
          {!isRunning && (summary.completed > 0 || summary.failed > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Summary
                  <Badge variant={summary.failed > 0 ? 'warning' : 'success'}>
                    {summary.failed > 0
                      ? `${summary.completed}/${summary.total} succeeded`
                      : 'All succeeded'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{summary.total}</p>
                    <p className="text-sm text-muted-foreground">Total</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{summary.completed}</p>
                    <p className="text-sm text-muted-foreground">Succeeded</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-red-600">{summary.failed}</p>
                    <p className="text-sm text-muted-foreground">Failed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold flex items-center justify-center gap-1">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      {summary.totalImages}
                    </p>
                    <p className="text-sm text-muted-foreground">Images</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold font-mono">{formatMs(summary.wallClockMs)}</p>
                    <p className="text-sm text-muted-foreground">Wall clock</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-mono">
                      <span className="text-green-600">{formatMs(summary.minResponseMs)}</span>
                      {' / '}
                      <span className="font-bold">{formatMs(summary.avgResponseMs)}</span>
                      {' / '}
                      <span className="text-red-600">{formatMs(summary.maxResponseMs)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">min / avg / max</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Lightbox
        images={lbImages}
        index={lbIndex}
        onClose={() => setLbIndex(null)}
        onPrev={() => setLbIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
        onNext={() => setLbIndex((i) => (i !== null && i < lbImages.length - 1 ? i + 1 : i))}
      />
    </div>
  )
}
