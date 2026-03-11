'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Upload, Download, Copy, CheckCircle, Database } from 'lucide-react'

interface RegionOption {
  id: string
  label: string
}

interface DesignResult {
  regionId: string
  regionDimensions: { pixelsWidth: number; pixelsHeight: number }
  artworks: Array<{
    assetId: string
    originalWidth: number
    originalHeight: number
    scaledWidth: number
    scaledHeight: number
    x: number
    y: number
    fitScale: number
  }>
  xastState: unknown
  previewImage: string
  outputConfig: Record<string, unknown>
  duration: number
}

export default function DesignerPage() {
  // Server config
  const [serverUrl, setServerUrl] = useState('http://localhost:3000')
  const [rendererUrl, setRendererUrl] = useState('http://localhost:3000')
  const [shopId, setShopId] = useState('')
  const authFetch = useAuthFetch()

  // Fixtures
  const [fixtureNames, setFixtureNames] = useState<string[]>([])
  const [fixturesLoading, setFixturesLoading] = useState(false)
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null)

  // Input state
  const [generatorJson, setGeneratorJson] = useState('')
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [selectedRegion, setSelectedRegion] = useState('')
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null)
  const [artworkData, setArtworkData] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const generatorFileRef = useRef<HTMLInputElement>(null)

  // Output config
  const [scaleMode, setScaleMode] = useState('contain')
  const [imageFormat, setImageFormat] = useState('png')
  const [backgroundColor, setBackgroundColor] = useState('transparent')

  // Result
  const [result, setResult] = useState<DesignResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function parseGeneratorRegions(json: string) {
    try {
      const data = JSON.parse(json)
      const regs = data.regions || []
      const options: RegionOption[] = regs.map((r: any, i: number) => ({
        id: r.id || r.name || `region-${i}`,
        label: `${r.id || r.name || `Region ${i}`} (${r.dimensions?.pixelsWidth ?? r.pixelsWidth ?? '?'}x${r.dimensions?.pixelsHeight ?? r.pixelsHeight ?? '?'})`,
      }))
      setRegions(options)
      if (options.length > 0 && !selectedRegion) {
        setSelectedRegion(options[0].id)
      }
      setError(null)
    } catch {
      setRegions([])
      setError('Invalid generator JSON')
    }
  }

  function handleGeneratorChange(value: string) {
    setGeneratorJson(value)
    if (value.trim()) {
      parseGeneratorRegions(value)
    } else {
      setRegions([])
    }
  }

  function handleGeneratorFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setGeneratorJson(text)
      parseGeneratorRegions(text)
    }
    reader.readAsText(file)
  }

  function handleArtworkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUri = reader.result as string
      setArtworkPreview(dataUri)
      setArtworkData(dataUri)
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!generatorJson || !selectedRegion || !artworkData) {
      setError('Please provide generator JSON, select a region, and upload artwork')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const generatorData = JSON.parse(generatorJson)

      const requestBody: Record<string, unknown> = {
        serverUrl,
        generatorData,
        regionId: selectedRegion,
        images: [{ data: artworkData }],
        outputConfig: {
          scaleMode,
          imageFormat,
          backgroundColor: backgroundColor || 'transparent',
        },
      }
      if (shopId.trim()) {
        requestBody.shopId = shopId.trim()
      }

      const res = await authFetch('/api/designer', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || data.detail || `Server returned ${res.status}`)
      }

      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function copyXast() {
    if (!result?.xastState) return
    await navigator.clipboard.writeText(JSON.stringify(result.xastState, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function loadFixtureList() {
    setFixturesLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/fixtures?rendererUrl=${encodeURIComponent(rendererUrl)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load fixtures')
      setFixtureNames(data)
    } catch (err) {
      setError((err as Error).message)
      setFixtureNames([])
    } finally {
      setFixturesLoading(false)
    }
  }

  async function loadFixture(name: string) {
    setSelectedFixture(name)
    setError(null)
    try {
      const res = await fetch(`/api/fixtures?rendererUrl=${encodeURIComponent(rendererUrl)}&name=${encodeURIComponent(name)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to load fixture ${name}`)
      const json = JSON.stringify(data, null, 2)
      setGeneratorJson(json)
      parseGeneratorRegions(json)
    } catch (err) {
      setError((err as Error).message)
      setSelectedFixture(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Designer</h2>
        <p className="text-muted-foreground">
          Center artwork in a region and generate XAST V4 state
        </p>
      </div>

      {/* Server Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Server Configuration</CardTitle>
          <CardDescription>Connect to a renderer server instance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Renderer Server URL</label>
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Fixtures Server URL</label>
              <Input
                value={rendererUrl}
                onChange={(e) => setRendererUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">Used to load fixtures</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Shop ID</label>
              <Input
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                placeholder="Optional — for CDN uploads"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">Required for artwork CDN upload</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Design Input */}
      <Card>
        <CardHeader>
          <CardTitle>Design Input</CardTitle>
          <CardDescription>Provide generator data, select region, and upload artwork</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Fixture Selector */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm font-medium">Load from Fixture</label>
              <Button
                variant="outline"
                size="sm"
                onClick={loadFixtureList}
                disabled={fixturesLoading}
              >
                {fixturesLoading ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Database className="mr-1 h-3 w-3" />
                )}
                {fixtureNames.length > 0 ? 'Refresh' : 'Load Fixtures'}
              </Button>
            </div>
            {fixtureNames.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fixtureNames.map((name) => (
                  <Button
                    key={name}
                    variant={selectedFixture === name ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => loadFixture(name)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Generator JSON */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium">
                Generator JSON
                {selectedFixture && (
                  <Badge variant="secondary" className="ml-2">{selectedFixture}</Badge>
                )}
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => generatorFileRef.current?.click()}
              >
                <Upload className="mr-1 h-3 w-3" /> Load File
              </Button>
              <input
                ref={generatorFileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleGeneratorFileUpload}
              />
            </div>
            <textarea
              className="h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={generatorJson}
              onChange={(e) => handleGeneratorChange(e.target.value)}
              placeholder='Paste generator JSON here, load a file, or select a fixture above...'
            />
          </div>

          {/* Region Selector */}
          {regions.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium">Region</label>
              <Select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                options={regions.map((r) => ({ value: r.id, label: r.label }))}
              />
            </div>
          )}

          {/* Artwork Upload */}
          <div>
            <label className="mb-1 block text-sm font-medium">Artwork Image</label>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1 h-4 w-4" /> Upload Artwork
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleArtworkUpload}
              />
              {artworkPreview && (
                <img
                  src={artworkPreview}
                  alt="Artwork preview"
                  className="h-16 w-16 rounded border object-contain"
                />
              )}
            </div>
          </div>

          {/* Output Config */}
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Output Configuration</summary>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs">Scale Mode</label>
                <Select
                  value={scaleMode}
                  onChange={(e) => setScaleMode(e.target.value)}
                  options={[
                    { value: 'contain', label: 'Contain' },
                    { value: 'cover', label: 'Cover' },
                    { value: 'natural', label: 'Natural' },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Format</label>
                <Select
                  value={imageFormat}
                  onChange={(e) => setImageFormat(e.target.value)}
                  options={[
                    { value: 'png', label: 'PNG' },
                    { value: 'jpeg', label: 'JPEG' },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Background</label>
                <Input
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder="transparent"
                />
              </div>
            </div>
          </details>

          {/* Submit */}
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
              </>
            ) : (
              'Generate Design'
            )}
          </Button>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Preview
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {result.duration}ms
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center rounded-md border bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjBmMGYwIi8+PHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMGYwZjAiLz48L3N2Zz4=')] p-4">
              <img
                src={result.previewImage}
                alt="Design preview"
                className="max-h-[600px] object-contain"
              />
            </div>
            <div className="flex gap-2">
              <a
                href={result.previewImage}
                download={`design-preview.${imageFormat}`}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <Download className="h-4 w-4" /> Download
              </a>
            </div>

            {/* Centering Metadata */}
            <div>
              <h4 className="mb-2 text-sm font-medium">Centering Details</h4>
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-1.5 text-left font-medium">Property</th>
                      {result.artworks.map((a, i) => (
                        <th key={i} className="px-3 py-1.5 text-left font-medium">
                          Image {i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    <tr className="border-b">
                      <td className="px-3 py-1">Original Size</td>
                      {result.artworks.map((a, i) => (
                        <td key={i} className="px-3 py-1">
                          {a.originalWidth} x {a.originalHeight}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="px-3 py-1">Scaled Size</td>
                      {result.artworks.map((a, i) => (
                        <td key={i} className="px-3 py-1">
                          {Math.round(a.scaledWidth)} x {Math.round(a.scaledHeight)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="px-3 py-1">Fit Scale</td>
                      {result.artworks.map((a, i) => (
                        <td key={i} className="px-3 py-1">{a.fitScale.toFixed(4)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-1">Offset (x, y)</td>
                      {result.artworks.map((a, i) => (
                        <td key={i} className="px-3 py-1">
                          {Math.round(a.x)}, {Math.round(a.y)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Region: {result.regionDimensions.pixelsWidth} x {result.regionDimensions.pixelsHeight} px
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* XAST State */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              XAST State (V4)
              <Button variant="outline" size="sm" className="ml-auto" onClick={copyXast}>
                {copied ? (
                  <>
                    <CheckCircle className="mr-1 h-3 w-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3 w-3" /> Copy
                  </>
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[500px] overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-xs">
              {JSON.stringify(result.xastState, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
