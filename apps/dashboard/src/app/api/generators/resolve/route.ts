import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rendererUrl =
    request.nextUrl.searchParams.get('rendererUrl') ??
    process.env.RENDERER_SERVER_URL
  const productSlug = request.nextUrl.searchParams.get('productSlug')

  if (!rendererUrl || !productSlug) {
    return NextResponse.json(
      { error: 'rendererUrl and productSlug are required' },
      { status: 400 },
    )
  }

  const apiKey = process.env.RENDERER_SERVER_API_KEY

  try {
    const params = new URLSearchParams({ productSlug })
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const res = await fetch(
      `${rendererUrl}/api/v1/generators/resolve?${params}`,
      { headers, cache: 'no-store' },
    )

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Generator resolve failed (${res.status}): ${text}` },
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
