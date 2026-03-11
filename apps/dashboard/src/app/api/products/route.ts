import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query') || ''
  const productionMethod = request.nextUrl.searchParams.get('productionMethod') || ''
  const page = request.nextUrl.searchParams.get('page') || '0'
  const size = request.nextUrl.searchParams.get('size') || '20'

  const baseUrl = process.env.FW_API_BASE_URL
  const token = request.headers.get('authorization')?.replace('Bearer ', '')

  if (!baseUrl) {
    return NextResponse.json(
      { error: 'FW_API_BASE_URL must be configured' },
      { status: 500 },
    )
  }

  if (!token) {
    return NextResponse.json(
      { error: 'Authorization header required' },
      { status: 401 },
    )
  }

  const params = new URLSearchParams()
  if (query) params.set('omnisearch', query)
  if (productionMethod) params.set('productionMethod', productionMethod)
  params.set('page', page)
  params.set('size', size)

  try {
    const res = await fetch(`${baseUrl}/api/v2/product-catalog?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Catalog API failed (${res.status}): ${text}` },
        { status: res.status },
      )
    }

    const data = await res.json()

    // Filter to DESIGNER_V3_READY only (API doesn't support this filter natively)
    const allProducts: Array<Record<string, unknown>> = data.products || []
    const filtered = allProducts.filter(
      (p) => p.customizationType === 'DESIGNER_V3_READY',
    )

    return NextResponse.json({
      page: data.page ?? parseInt(page),
      size: data.size ?? parseInt(size),
      totalElements: filtered.length,
      totalPages: 1,
      products: filtered,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    )
  }
}
