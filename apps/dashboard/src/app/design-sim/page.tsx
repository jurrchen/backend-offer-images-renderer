'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { ProductPicker } from '@/components/orchestrator/ProductPicker'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { useRendererConfig } from '@/contexts/RendererConfigContext'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import type { CatalogProduct } from '@/types/product-catalog'

const EditorPreview = dynamic(
  () => import('@/components/design-sim/EditorPreview').then((m) => ({ default: m.EditorPreview })),
  { ssr: false, loading: () => <div className="flex items-center justify-center w-[512px] h-[512px] text-sm text-muted-foreground">Loading editor...</div> },
)

interface CustomizationState {
  version: '4'
  value: Record<string, StateItem[]>
}

interface StateItem {
  regionId: string
  records: Array<{ active: boolean; value: unknown }>
}

export default function DesignSimPage() {
  const authFetch = useAuthFetch()
  const { rendererUrl } = useRendererConfig()

  // Step 1: product + generator
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null)
  const [generatorData, setGeneratorData] = useState<any>(null)
  const [generatorLoading, setGeneratorLoading] = useState(false)
  const [generatorError, setGeneratorError] = useState<string | null>(null)

  // Step 2: design config
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [imageHref, setImageHref] = useState('')
  const [imageWidth, setImageWidth] = useState(3000)
  const [imageHeight, setImageHeight] = useState(3000)
  const [scaleMode, setScaleMode] = useState<'contain' | 'cover' | 'natural'>('contain')
  const [sizesInput, setSizesInput] = useState('S,M,L,XL,2XL')

  // Step 3: results
  const [designState, setDesignState] = useState<CustomizationState | null>(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [designLoading, setDesignLoading] = useState(false)
  const [designError, setDesignError] = useState<string | null>(null)

  async function handleProductSelect(product: CatalogProduct) {
    setSelectedProduct(product)
    setGeneratorData(null)
    setDesignState(null)
    setGeneratorError(null)
    setGeneratorLoading(true)

    try {
      const res = await authFetch(
        `/api/generators/resolve?rendererUrl=${encodeURIComponent(rendererUrl)}&productSlug=${encodeURIComponent(product.slug)}`,
      )
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `Generator resolve failed (${res.status})`)
      }

      setGeneratorData(data.generatorData)

      // Auto-select default region
      const regions: any[] = data.generatorData.regions ?? []
      const defaultRegion =
        regions.find((r: any) => r.id === 'default') ??
        regions.find((r: any) => r.id === 'front') ??
        regions[0]
      setSelectedRegionId(defaultRegion?.id ?? '')
    } catch (err) {
      setGeneratorError((err as Error).message)
    } finally {
      setGeneratorLoading(false)
    }
  }

  async function generateState() {
    if (!generatorData || !selectedRegionId || !imageHref) return

    setDesignLoading(true)
    setDesignError(null)
    setDesignState(null)

    try {
      const sizes = sizesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const body = {
        serverUrl: rendererUrl,
        items: [
          {
            generatorData,
            regionId: selectedRegionId,
            images: [{ href: imageHref, width: imageWidth, height: imageHeight }],
            sizes,
          },
        ],
        outputConfig: { scaleMode },
      }

      const res = await authFetch('/api/designer', {
        method: 'POST',
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || data.detail || `Design request failed (${res.status})`)
      }

      setDesignState(data as CustomizationState)
      const firstSize = Object.keys(data.value ?? {})[0] ?? ''
      setSelectedSize(firstSize)
    } catch (err) {
      setDesignError((err as Error).message)
    } finally {
      setDesignLoading(false)
    }
  }

  const regions: any[] = generatorData?.regions ?? []
  const selectedRegion = regions.find((r: any) => r.id === selectedRegionId)
  const sizes = designState ? Object.keys(designState.value) : []
  const selectedStateItems = designState?.value[selectedSize] ?? []
  const xastState = selectedStateItems[0]?.records[0]?.value

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Design Simulation</h2>
        <p className="text-muted-foreground">
          Test end-to-end design state generation and live editor preview
        </p>
      </div>

      {/* Card 1: Setup */}
      <Card>
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>Select product, configure region and image</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Product Picker */}
          <div>
            <label className="mb-2 block text-sm font-medium">Product</label>
            <ProductPicker onSelect={handleProductSelect} selectedProductId={selectedProduct?.id} />
          </div>

          {generatorLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Resolving generator...
            </div>
          )}

          {generatorError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {generatorError}
            </div>
          )}

          {generatorData && (
            <>
              {/* Region Selector */}
              <div>
                <label className="mb-1 block text-sm font-medium">Region</label>
                <Select
                  value={selectedRegionId}
                  onChange={(e) => setSelectedRegionId(e.target.value)}
                  options={regions.map((r: any) => ({
                    value: r.id,
                    label: `${r.id}${r.name && r.name !== r.id ? ` (${r.name})` : ''} — ${r.dimensions?.pixelsWidth ?? r.pixelsWidth ?? '?'}×${r.dimensions?.pixelsHeight ?? r.pixelsHeight ?? '?'}px`,
                  }))}
                />
              </div>

              {/* Image URL */}
              <div>
                <label className="mb-1 block text-sm font-medium">Image URL</label>
                <Input
                  value={imageHref}
                  onChange={(e) => setImageHref(e.target.value)}
                  placeholder="https://example.com/artwork.png"
                />
              </div>

              {/* Image dimensions */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Width (px)</label>
                  <Input
                    type="number"
                    value={imageWidth}
                    onChange={(e) => setImageWidth(Number(e.target.value))}
                    min={1}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Height (px)</label>
                  <Input
                    type="number"
                    value={imageHeight}
                    onChange={(e) => setImageHeight(Number(e.target.value))}
                    min={1}
                  />
                </div>
              </div>

              {/* Scale Mode + Sizes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Scale Mode</label>
                  <Select
                    value={scaleMode}
                    onChange={(e) => setScaleMode(e.target.value as 'contain' | 'cover' | 'natural')}
                    options={[
                      { value: 'contain', label: 'Contain' },
                      { value: 'cover', label: 'Cover' },
                      { value: 'natural', label: 'Natural' },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Sizes</label>
                  <Input
                    value={sizesInput}
                    onChange={(e) => setSizesInput(e.target.value)}
                    placeholder="S,M,L,XL,2XL"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">Comma-separated</p>
                </div>
              </div>

              {/* Generate button */}
              <Button
                onClick={generateState}
                disabled={designLoading || !imageHref || !selectedRegionId}
              >
                {designLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : (
                  'Generate State'
                )}
              </Button>

              {designError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                  {designError}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 2: State JSON */}
      {designState && (
        <Card>
          <CardHeader>
            <CardTitle>State JSON</CardTitle>
            <CardDescription>
              CustomizationState v4 — {sizes.length} size{sizes.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Size tabs */}
            <div className="flex flex-wrap gap-2">
              {sizes.map((size) => (
                <Button
                  key={size}
                  variant={selectedSize === size ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSize(size)}
                >
                  {size}
                </Button>
              ))}
            </div>

            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-xs">
              {JSON.stringify(designState.value[selectedSize], null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Card 3: Editor Preview */}
      {designState && selectedRegion && (
        <Card>
          <CardHeader>
            <CardTitle>Editor Preview</CardTitle>
            <CardDescription>
              Live ProductEditor instance for size <strong>{selectedSize}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Same size tabs */}
            <div className="mb-4 flex flex-wrap gap-2">
              {sizes.map((size) => (
                <Button
                  key={size}
                  variant={selectedSize === size ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSize(size)}
                >
                  {size}
                </Button>
              ))}
            </div>

            <div className="flex justify-center rounded-md border p-4">
              <EditorPreview
                key={selectedSize}
                xastState={xastState}
                region={selectedRegion}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
