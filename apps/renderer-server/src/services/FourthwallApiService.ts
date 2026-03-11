import { LRUCache } from 'lru-cache'
import { logger, rootCtx } from '../logger/index.js'

/**
 * Generator data structure from Fourthwall API
 */
export interface GeneratorData {
  id: string
  productId: string
  name?: string
  printMethod?: string
  regions?: Array<{
    id: string
    name?: string
    width?: number
    height?: number
  }>
  views?: Array<{
    id: string
    name?: string
  }>
  colors?: Array<{
    name: string
    hex?: string
  }>
  [key: string]: unknown
}

/**
 * Product data structure from Fourthwall API
 */
export interface ProductData {
  id: string
  slug: string
  name?: string
  variants?: Array<{
    id: string
    generatorId?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

/**
 * Product type presets for querying
 */
export type ProductType = 'bestsellers' | 'staff-picked'

/**
 * Service for fetching data from Fourthwall API
 * Includes caching to reduce API calls
 */
export class FourthwallApiService {
  private cache: LRUCache<string, unknown>
  private baseUrl: string

  constructor(options?: { baseUrl?: string; cacheMaxSize?: number; cacheTtlMs?: number }) {
    this.baseUrl = options?.baseUrl ?? 'https://api.fourthwall.com'
    this.cache = new LRUCache({
      max: options?.cacheMaxSize ?? 500,
      ttl: options?.cacheTtlMs ?? 5 * 60 * 1000, // 5 minutes default
    })
  }

  /**
   * Fetch generator data by ID
   * Endpoint: GET /api/generators/{generatorId}
   */
  async getGenerator(generatorId: string): Promise<GeneratorData> {
    const cacheKey = `generator:${generatorId}`
    const cached = this.cache.get(cacheKey) as GeneratorData | undefined
    if (cached) {
      logger.debug(rootCtx, 'Generator cache hit', { generatorId })
      return cached
    }

    logger.info(rootCtx, 'Fetching generator from API', { generatorId })
    const response = await fetch(`${this.baseUrl}/api/generators/${generatorId}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch generator ${generatorId}: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as GeneratorData
    this.cache.set(cacheKey, data)
    return data
  }

  /**
   * Fetch product by slug
   * Endpoint: GET /api/products/slug/{slug}
   */
  async getProductBySlug(slug: string): Promise<ProductData> {
    const cacheKey = `product:slug:${slug}`
    const cached = this.cache.get(cacheKey) as ProductData | undefined
    if (cached) {
      logger.debug(rootCtx, 'Product cache hit', { slug })
      return cached
    }

    logger.info(rootCtx, 'Fetching product by slug', { slug })
    const response = await fetch(`${this.baseUrl}/api/products/slug/${slug}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch product ${slug}: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as ProductData
    this.cache.set(cacheKey, data)
    return data
  }

  /**
   * Fetch products by type preset
   * Endpoint: GET /api/v2/product-catalog
   */
  async getProductsByType(type: ProductType): Promise<ProductData[]> {
    const cacheKey = `products:type:${type}`
    const cached = this.cache.get(cacheKey) as ProductData[] | undefined
    if (cached) {
      logger.debug(rootCtx, 'Products type cache hit', { type })
      return cached
    }

    logger.info(rootCtx, 'Fetching products by type', { type })

    // Map product type to query params
    const typeParams: Record<ProductType, string> = {
      'bestsellers': 'sort=bestselling&limit=10',
      'staff-picked': 'filter=staff-picked&limit=10',
    }

    const response = await fetch(`${this.baseUrl}/api/v2/product-catalog?${typeParams[type]}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch products by type ${type}: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const products = (data.products ?? data.items ?? data) as ProductData[]
    this.cache.set(cacheKey, products)
    return products
  }

  /**
   * Search products by query
   * Endpoint: GET /api/v2/product-catalog/search
   */
  async searchProducts(query: string): Promise<ProductData[]> {
    const cacheKey = `products:search:${query}`
    const cached = this.cache.get(cacheKey) as ProductData[] | undefined
    if (cached) {
      logger.debug(rootCtx, 'Product search cache hit', { query })
      return cached
    }

    logger.info(rootCtx, 'Searching products', { query })
    const response = await fetch(`${this.baseUrl}/api/v2/product-catalog/search?q=${encodeURIComponent(query)}&limit=10`)

    if (!response.ok) {
      throw new Error(`Failed to search products for "${query}": ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const products = (data.products ?? data.items ?? data) as ProductData[]
    this.cache.set(cacheKey, products)
    return products
  }

  /**
   * Extract the first generatorId from a product's variants
   */
  extractGeneratorId(product: ProductData): string | null {
    if (!product.variants || product.variants.length === 0) {
      return null
    }

    for (const variant of product.variants) {
      if (variant.generatorId) {
        return variant.generatorId
      }
    }

    return null
  }

  /**
   * Resolve generator data from various sources
   * Returns the resolved generator data and metadata about how it was resolved
   */
  async resolveGenerator(params: {
    generatorId?: string
    generatorData?: GeneratorData
    productSlug?: string
    productType?: ProductType
    productQuery?: string
  }): Promise<{
    generatorData: GeneratorData
    generatorId: string
    source: 'provided' | 'fetched' | 'slug-lookup' | 'type-lookup' | 'search'
    fetchMs: number
    productResolved?: string
  }> {
    const startTime = Date.now()

    // Priority 1: generatorData provided directly
    if (params.generatorData) {
      return {
        generatorData: params.generatorData,
        generatorId: params.generatorData.id,
        source: 'provided',
        fetchMs: Date.now() - startTime,
      }
    }

    // Priority 2: productSlug - fetch product, get generator
    if (params.productSlug) {
      const product = await this.getProductBySlug(params.productSlug)
      const resolvedGeneratorId = this.extractGeneratorId(product)
      if (!resolvedGeneratorId) {
        throw new Error(`Product "${params.productSlug}" has no generator configured`)
      }
      const generatorData = await this.getGenerator(resolvedGeneratorId)
      return {
        generatorData,
        generatorId: resolvedGeneratorId,
        source: 'slug-lookup',
        fetchMs: Date.now() - startTime,
        productResolved: params.productSlug,
      }
    }

    // Priority 3: productType - query products, get first match's generator
    if (params.productType) {
      const products = await this.getProductsByType(params.productType)
      if (products.length === 0) {
        throw new Error(`No products found for type: ${params.productType}`)
      }
      const product = products[0]
      const resolvedGeneratorId = this.extractGeneratorId(product)
      if (!resolvedGeneratorId) {
        throw new Error(`Product "${product.slug}" has no generator configured`)
      }
      const generatorData = await this.getGenerator(resolvedGeneratorId)
      return {
        generatorData,
        generatorId: resolvedGeneratorId,
        source: 'type-lookup',
        fetchMs: Date.now() - startTime,
        productResolved: product.slug,
      }
    }

    // Priority 4: productQuery - search products, get first match's generator
    if (params.productQuery) {
      const products = await this.searchProducts(params.productQuery)
      if (products.length === 0) {
        throw new Error(`No products found for query: ${params.productQuery}`)
      }
      const product = products[0]
      const resolvedGeneratorId = this.extractGeneratorId(product)
      if (!resolvedGeneratorId) {
        throw new Error(`Product "${product.slug}" has no generator configured`)
      }
      const generatorData = await this.getGenerator(resolvedGeneratorId)
      return {
        generatorData,
        generatorId: resolvedGeneratorId,
        source: 'search',
        fetchMs: Date.now() - startTime,
        productResolved: product.slug,
      }
    }

    // Priority 5: Fallback - fetch generator by ID only
    if (!params.generatorId) {
      throw new Error('No generator resolution method provided')
    }
    const generatorData = await this.getGenerator(params.generatorId)
    return {
      generatorData,
      generatorId: params.generatorId,
      source: 'fetched',
      fetchMs: Date.now() - startTime,
    }
  }

  /**
   * Validate that requested regions exist in the generator
   */
  validateRegions(generatorData: GeneratorData, requestedRegions: string[]): void {
    if (!generatorData.regions || generatorData.regions.length === 0) {
      // No regions defined - skip validation
      return
    }

    const validRegionIds = new Set(generatorData.regions.map(r => r.id))
    const invalidRegions = requestedRegions.filter(r => !validRegionIds.has(r))

    if (invalidRegions.length > 0) {
      const availableRegions = generatorData.regions.map(r => r.id).join(', ')
      throw new Error(
        `Invalid region(s): ${invalidRegions.join(', ')}. ` +
        `Available regions for generator ${generatorData.id}: ${availableRegions}`
      )
    }
  }

  /**
   * Get all available views from generator
   */
  getAvailableViews(generatorData: GeneratorData): string[] {
    if (!generatorData.views || generatorData.views.length === 0) {
      return ['Front'] // Default fallback
    }
    return generatorData.views.map(v => v.id || v.name || 'Front').filter(Boolean) as string[]
  }

  /**
   * Get the default region for a generator
   * Priority: "default" > "front" > "back" > first available
   */
  getDefaultRegion(generatorData: GeneratorData): string {
    if (!generatorData.regions || generatorData.regions.length === 0) {
      return 'front' // Default fallback
    }

    const regionIds = generatorData.regions.map(r => r.id.toLowerCase())
    const regions = generatorData.regions

    // Priority 1: "default"
    const defaultIdx = regionIds.findIndex(id => id === 'default')
    if (defaultIdx !== -1) {
      return regions[defaultIdx].id
    }

    // Priority 2: "front"
    const frontIdx = regionIds.findIndex(id => id === 'front')
    if (frontIdx !== -1) {
      return regions[frontIdx].id
    }

    // Priority 3: "back"
    const backIdx = regionIds.findIndex(id => id === 'back')
    if (backIdx !== -1) {
      return regions[backIdx].id
    }

    // Priority 4: first available
    return regions[0].id
  }

  /**
   * Calculate brightness of a hex color (0-255)
   * Uses perceived brightness formula
   */
  private getColorBrightness(hex: string): number {
    // Remove # if present
    const cleanHex = hex.replace('#', '')
    const r = parseInt(cleanHex.substring(0, 2), 16)
    const g = parseInt(cleanHex.substring(2, 4), 16)
    const b = parseInt(cleanHex.substring(4, 6), 16)
    // Perceived brightness formula
    return (r * 299 + g * 587 + b * 114) / 1000
  }

  /**
   * Check if a color is considered "light" based on its hex value
   */
  private isLightColor(hex: string): boolean {
    return this.getColorBrightness(hex) > 128
  }

  /**
   * Auto-select colors: one light and one dark (if available)
   * Returns representative colors for product preview
   */
  getAutoColors(generatorData: GeneratorData): string[] {
    if (!generatorData.colors || generatorData.colors.length === 0) {
      return ['White'] // Default fallback
    }

    const colors = generatorData.colors

    // If only one color, return it
    if (colors.length === 1) {
      return [colors[0].name]
    }

    // Separate into light and dark colors
    const lightColors: typeof colors = []
    const darkColors: typeof colors = []

    for (const color of colors) {
      if (color.hex) {
        if (this.isLightColor(color.hex)) {
          lightColors.push(color)
        } else {
          darkColors.push(color)
        }
      } else {
        // No hex - guess based on name
        const nameLower = color.name.toLowerCase()
        if (nameLower.includes('white') || nameLower.includes('light') || nameLower.includes('cream') || nameLower.includes('yellow')) {
          lightColors.push(color)
        } else {
          darkColors.push(color)
        }
      }
    }

    const result: string[] = []

    // Pick one light color (prefer white)
    if (lightColors.length > 0) {
      const white = lightColors.find(c => c.name.toLowerCase().includes('white'))
      result.push(white?.name ?? lightColors[0].name)
    }

    // Pick one dark color (prefer black)
    if (darkColors.length > 0) {
      const black = darkColors.find(c => c.name.toLowerCase().includes('black'))
      result.push(black?.name ?? darkColors[0].name)
    }

    // If we somehow got no colors, just return the first available
    if (result.length === 0) {
      result.push(colors[0].name)
    }

    return result
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear()
  }
}

// Singleton instance for convenience
export const fourthwallApi = new FourthwallApiService()
