'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { CatalogProduct, CatalogPage } from '@/types/product-catalog'
import { PRODUCTION_METHODS } from '@/types/product-catalog'

interface ProductPickerProps {
  onSelect: (product: CatalogProduct) => void
  selectedProductId?: string
}

export function ProductPicker({ onSelect, selectedProductId }: ProductPickerProps) {
  const authFetch = useAuthFetch()
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CatalogPage | null>(null)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const fetchProducts = useCallback(async (q: string, m: string, p: number) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(p), size: '20' })
      if (q) params.set('query', q)
      if (m) params.set('productionMethod', m)

      const res = await authFetch(`/api/products?${params}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Failed (${res.status})`)
      }
      const data: CatalogPage = await res.json()
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  // Debounced search on query/method change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      fetchProducts(query, method, 0)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, method, fetchProducts])

  // Immediate fetch on page change
  useEffect(() => {
    if (page > 0) fetchProducts(query, method, page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const products = result?.products ?? []
  const totalPages = result?.totalPages ?? 0

  return (
    <div className="space-y-3">
      {/* Search + filter bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or ID..."
            className="pl-9"
          />
        </div>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
        >
          <option value="">All Methods</option>
          {PRODUCTION_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading products...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Product list */}
      {!loading && products.length > 0 && (
        <div className="divide-y divide-border rounded-md border max-h-64 overflow-y-auto">
          {products.map((product) => {
            const isSelected = product.id === selectedProductId
            return (
              <button
                key={product.id}
                onClick={() => onSelect(product)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                  isSelected ? 'bg-accent text-accent-foreground' : ''
                }`}
              >
                <span className="flex-1 truncate font-medium">{product.name}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {product.productionMethod}
                </Badge>
              </button>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && products.length === 0 && result && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No DESIGNER_V3 products found
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
