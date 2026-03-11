'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Play, CheckCircle, XCircle, Plus, Minus, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImageEntry {
  url: string
  size: string
  region: string
  color: string
  style: string
  width: number
  height: number
}

interface JobListItem {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired'
  createdAt: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  imageCount?: number | null
  error?: string
  pollUrl: string
}

interface JobDetail {
  id: string
  status: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  result?: {
    images: ImageEntry[]
    metadata: {
      generatorCount: number
      imageCount: number
      durationMs: number
      completedAt: string
    }
  }
  error?: string
  pollUrl: string
}

interface ArtworkItem {
  region: string
  url: string
}

interface GeneratorEntry {
  id: string
  mode: 'fixture' | 'slug'
  fixtureInput: string
  slugInput: string
  generatorData: object | null
  generatorLabel: string
  sizesInput: string
  loading: boolean
  error: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`
  return `${Math.floor(secs / 86400)} d ago`
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
  if (status === 'failed' || status === 'expired') return <XCircle className="h-4 w-4 text-destructive shrink-0" />
  return <Loader2 className="h-4 w-4 animate-spin text-yellow-600 shrink-0" />
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge className="bg-green-600">Completed</Badge>
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>
  if (status === 'expired') return <Badge variant="destructive">Expired</Badge>
  if (status === 'processing') return <Badge className="bg-yellow-600">Processing</Badge>
  return <Badge variant="outline">Pending</Badge>
}

// ─── GeneratorBuilder ─────────────────────────────────────────────────────────

function GeneratorBuilder({
  entries,
  fixtureNames,
  onAdd,
  onRemove,
  onUpdate,
  onLoadFixture,
  onResolveSlug,
}: {
  entries: GeneratorEntry[]
  fixtureNames: string[]
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<GeneratorEntry>) => void
  onLoadFixture: (id: string) => void
  onResolveSlug: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Generators</label>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3 w-3 mr-1" /> Add Generator
        </Button>
      </div>

      {entries.map((entry, idx) => (
        <div key={entry.id} className="rounded-md border p-3 space-y-2 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Generator {idx + 1}</span>
            {entries.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => onRemove(entry.id)}
              >
                <Minus className="h-3 w-3 mr-1" /> Remove
              </Button>
            )}
          </div>

          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`mode-${entry.id}`}
                checked={entry.mode === 'fixture'}
                onChange={() => onUpdate(entry.id, { mode: 'fixture', generatorData: null, generatorLabel: '', error: null })}
              />
              Fixture
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`mode-${entry.id}`}
                checked={entry.mode === 'slug'}
                onChange={() => onUpdate(entry.id, { mode: 'slug', generatorData: null, generatorLabel: '', error: null })}
              />
              Product slug
            </label>
          </div>

          {entry.mode === 'fixture' && (
            <div className="flex gap-2 items-center">
              <select
                className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                value={entry.fixtureInput}
                onChange={(e) => onUpdate(entry.id, { fixtureInput: e.target.value, generatorData: null, generatorLabel: '', error: null })}
              >
                <option value="">Select fixture…</option>
                {fixtureNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!entry.fixtureInput || entry.loading}
                onClick={() => onLoadFixture(entry.id)}
              >
                {entry.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load'}
              </Button>
            </div>
          )}

          {entry.mode === 'slug' && (
            <div className="flex gap-2 items-center">
              <input
                className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                placeholder="e.g. premium-classic-tee"
                value={entry.slugInput}
                onChange={(e) => onUpdate(entry.id, { slugInput: e.target.value, generatorData: null, generatorLabel: '', error: null })}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!entry.slugInput.trim() || entry.loading}
                onClick={() => onResolveSlug(entry.id)}
              >
                {entry.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RefreshCw className="h-3 w-3 mr-1" />Resolve</>}
              </Button>
            </div>
          )}

          {entry.generatorData && (
            <p className="text-xs text-green-600 font-medium">
              ✓ Loaded: {entry.generatorLabel}
            </p>
          )}
          {entry.error && (
            <p className="text-xs text-destructive">{entry.error}</p>
          )}

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">
              Sizes (comma-separated)
            </label>
            <input
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              placeholder="S, M, L, XL"
              value={entry.sizesInput}
              onChange={(e) => onUpdate(entry.id, { sizesInput: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── JobRow ───────────────────────────────────────────────────────────────────

function JobRow({
  job,
  expanded,
  detail,
  onToggle,
}: {
  job: JobListItem
  expanded: boolean
  detail: JobDetail | null
  onToggle: () => void
}) {
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <StatusIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={job.status} />
            <span className="font-mono text-xs text-muted-foreground">{job.id.slice(0, 8)}…</span>
            {job.imageCount != null && job.imageCount > 0 && (
              <span className="text-xs text-muted-foreground">{job.imageCount} images</span>
            )}
            {job.durationMs != null && (
              <span className="text-xs text-muted-foreground">{(job.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          {job.error && (
            <p className="text-xs text-destructive mt-0.5 truncate">{job.error}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{timeAgo(job.createdAt)}</span>
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t px-3 py-3 bg-muted/10">
          {!detail && job.status !== 'failed' && job.status !== 'expired' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading detail…
            </div>
          )}
          {detail?.result?.images && detail.result.images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
              {detail.result.images.map((img, i) => (
                <div key={i} className="rounded border overflow-hidden">
                  <img
                    src={img.url}
                    alt={`${img.size} ${img.color} ${img.region}`}
                    className="w-full aspect-square object-contain bg-muted"
                    loading="lazy"
                  />
                  <div className="p-1.5 text-xs space-y-0.5">
                    <div className="flex gap-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{img.size}</Badge>
                      <Badge variant="outline" className="text-[10px]">{img.color}</Badge>
                      <Badge variant="outline" className="text-[10px]">{img.region}</Badge>
                    </div>
                    <div className="text-muted-foreground">{img.style} · {img.width}×{img.height}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {detail && (!detail.result || detail.result.images.length === 0) && job.status === 'completed' && (
            <p className="text-xs text-muted-foreground">No images in result.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobsPage() {
  // Form state
  const [entries, setEntries] = useState<GeneratorEntry[]>([
    {
      id: crypto.randomUUID(),
      mode: 'slug',
      fixtureInput: '',
      slugInput: 'as-colour-premium-oversized-faded-t-shirt-dtg',
      generatorData: null,
      generatorLabel: '',
      sizesInput: 'S, M, L, XL',
      loading: false,
      error: null,
    },
  ])
  const [fixtureNames, setFixtureNames] = useState<string[]>([])
  const [artworkItems, setArtworkItems] = useState<ArtworkItem[]>([{ region: 'front', url: 'https://camo.githubusercontent.com/5e45bc648dba68520ce949a53690af6bcef2880f84a1d46cbb1636649afd6d84/68747470733a2f2f796176757a63656c696b65722e6769746875622e696f2f73616d706c652d696d616765732f696d6167652d313032312e6a7067' }])
  const [colors, setColors] = useState('')
  const [views, setViews] = useState('')
  const [type, setType] = useState<'preview' | 'offer'>('preview')
  const [renderSize, setRenderSize] = useState('2048')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Job list state
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedDetails, setExpandedDetails] = useState<Record<string, JobDetail>>({})

  const jobsRef = useRef<JobListItem[]>([])

  // Keep ref in sync for interval callback
  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])

  // Load fixture names on mount
  useEffect(() => {
    fetch('/api/fixtures')
      .then((r) => r.json())
      .then((data: string[] | { error?: string }) => {
        if (Array.isArray(data)) setFixtureNames(data)
      })
      .catch(() => {})
  }, [])

  // ── Job list fetching ────────────────────────────────────────────────────

  const fetchList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/jobs')
      const data = await res.json()
      if (res.ok && Array.isArray(data.jobs)) {
        setJobs(data.jobs)
      }
    } catch {
      // ignore transient errors
    } finally {
      setListLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (res.ok) {
        setExpandedDetails((prev) => ({ ...prev, [id]: data }))
      }
    } catch {
      // ignore
    }
  }, [])

  // Initial list fetch
  useEffect(() => {
    fetchList()
  }, [fetchList])

  // Auto-refresh every 4s while active jobs exist
  useEffect(() => {
    const interval = setInterval(() => {
      const hasActive = jobsRef.current.some(
        (j) => j.status === 'pending' || j.status === 'processing',
      )
      if (hasActive) fetchList()
    }, 4000)
    return () => clearInterval(interval)
  }, [fetchList])

  // When expanded job becomes completed, fetch its detail
  useEffect(() => {
    if (!expandedId) return
    const job = jobs.find((j) => j.id === expandedId)
    if (job?.status === 'completed' && !expandedDetails[expandedId]) {
      fetchDetail(expandedId)
    }
  }, [expandedId, jobs, expandedDetails, fetchDetail])

  // ── Generator entry helpers ──────────────────────────────────────────────

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        mode: 'fixture',
        fixtureInput: '',
        slugInput: '',
        generatorData: null,
        generatorLabel: '',
        sizesInput: 'S, M, L, XL',
        loading: false,
        error: null,
      },
    ])
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  function updateEntry(id: string, patch: Partial<GeneratorEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const loadFixture = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id)
      if (!entry || !entry.fixtureInput) return
      updateEntry(id, { loading: true, error: null, generatorData: null, generatorLabel: '' })
      try {
        const res = await fetch(`/api/fixtures?name=${encodeURIComponent(entry.fixtureInput)}`)
        const data = await res.json()
        if (!res.ok) {
          updateEntry(id, { loading: false, error: data.error || `HTTP ${res.status}` })
          return
        }
        updateEntry(id, { loading: false, generatorData: data, generatorLabel: entry.fixtureInput })
      } catch (err) {
        updateEntry(id, { loading: false, error: (err as Error).message })
      }
    },
    [entries],
  )

  const resolveSlug = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id)
      if (!entry || !entry.slugInput.trim()) return
      updateEntry(id, { loading: true, error: null, generatorData: null, generatorLabel: '' })
      try {
        const res = await fetch(`/api/generators/resolve?productSlug=${encodeURIComponent(entry.slugInput.trim())}`)
        const data = await res.json()
        if (!res.ok) {
          updateEntry(id, { loading: false, error: data.error || `HTTP ${res.status}` })
          return
        }
        const generatorData = data.generatorData ?? data
        updateEntry(id, { loading: false, generatorData, generatorLabel: entry.slugInput.trim() })
      } catch (err) {
        updateEntry(id, { loading: false, error: (err as Error).message })
      }
    },
    [entries],
  )

  // ── Artwork helpers ──────────────────────────────────────────────────────

  function addArtworkItem() {
    setArtworkItems((prev) => [...prev, { region: 'front', url: '' }])
  }

  function removeArtworkItem(idx: number) {
    setArtworkItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateArtworkItem(idx: number, field: keyof ArtworkItem, value: string) {
    setArtworkItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    const unloaded = entries.filter((e) => !e.generatorData)
    if (unloaded.length > 0) {
      setSubmitError(`Generator ${entries.indexOf(unloaded[0]) + 1} has no generator data loaded. Click Load or Resolve first.`)
      return
    }
    const noSizes = entries.find((e) => !e.sizesInput.trim())
    if (noSizes) {
      setSubmitError(`Generator ${entries.indexOf(noSizes) + 1} has no sizes specified.`)
      return
    }

    const generators = entries.map((e) => ({
      generatorData: e.generatorData,
      sizes: e.sizesInput.split(',').map((s) => s.trim()).filter(Boolean),
    }))

    const body: Record<string, unknown> = {
      generators,
      images: artworkItems,
      type,
      renderSize: parseInt(renderSize, 10) || 2048,
    }
    if (colors.trim()) body.colors = colors.split(',').map((c) => c.trim()).filter(Boolean)
    if (views.trim()) body.views = views.split(',').map((v) => v.trim()).filter(Boolean)

    setSubmitting(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error || data.message || `HTTP ${res.status}`)
        return
      }

      const newJobId: string = data.id
      await fetchList()
      setExpandedId(newJobId)
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Toggle expand ────────────────────────────────────────────────────────

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      const job = jobs.find((j) => j.id === id)
      if (job?.status === 'completed' && !expandedDetails[id]) {
        fetchDetail(id)
      }
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Jobs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Submit async render jobs and track their status.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <Card>
          <CardHeader>
            <CardTitle>Submit Job</CardTitle>
            <CardDescription>
              Load generators from fixtures or product slugs, then provide artwork URLs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <GeneratorBuilder
                entries={entries}
                fixtureNames={fixtureNames}
                onAdd={addEntry}
                onRemove={removeEntry}
                onUpdate={updateEntry}
                onLoadFixture={loadFixture}
                onResolveSlug={resolveSlug}
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Artwork Images</label>
                  <Button type="button" size="sm" variant="outline" onClick={addArtworkItem}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {artworkItems.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
                        placeholder="region"
                        value={item.region}
                        onChange={(e) => updateArtworkItem(idx, 'region', e.target.value)}
                      />
                      <input
                        className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                        placeholder="https://cdn.example.com/artwork.png"
                        value={item.url}
                        onChange={(e) => updateArtworkItem(idx, 'url', e.target.value)}
                      />
                      {artworkItems.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeArtworkItem(idx)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Colors (comma-separated, optional)
                  </label>
                  <input
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    placeholder="black, white"
                    value={colors}
                    onChange={(e) => setColors(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Views (comma-separated, optional)
                  </label>
                  <input
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    placeholder="view-0, view-1"
                    value={views}
                    onChange={(e) => setViews(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    value={type}
                    onChange={(e) => setType(e.target.value as 'preview' | 'offer')}
                  >
                    <option value="preview">preview</option>
                    <option value="offer">offer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Render Size</label>
                  <input
                    type="number"
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    value={renderSize}
                    onChange={(e) => setRenderSize(e.target.value)}
                  />
                </div>
              </div>

              {submitError && (
                <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 p-2">
                  {submitError}
                </p>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" /> Submit Job</>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Job list ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Jobs</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchList}
                disabled={listLoading}
              >
                {listLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 && listLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {jobs.length === 0 && !listLoading && (
              <p className="text-sm text-muted-foreground">No jobs yet. Submit a job to get started.</p>
            )}
            <div className="space-y-2">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  expanded={expandedId === job.id}
                  detail={expandedDetails[job.id] ?? null}
                  onToggle={() => toggleExpand(job.id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
