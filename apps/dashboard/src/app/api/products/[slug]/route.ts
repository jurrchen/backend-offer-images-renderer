import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

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

  try {
    const res = await fetch(`${baseUrl}/api/v2/product-catalog/product/${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Product detail API failed (${res.status}): ${text}` },
        { status: res.status },
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    )
  }
}
