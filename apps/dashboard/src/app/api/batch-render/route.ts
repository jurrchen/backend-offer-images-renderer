import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const { slug, imageData, rendererUrl } = await request.json()

  if (!slug || !imageData || !rendererUrl) {
    return NextResponse.json(
      { error: 'slug, imageData, and rendererUrl are required' },
      { status: 400 },
    )
  }

  const apiKey = process.env.RENDERER_SERVER_API_KEY
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  try {
    const res = await fetch(`${rendererUrl}/api/v1/render/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        productSlug: slug,
        images: [{ data: imageData }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Render failed (${res.status}): ${text}` },
        { status: res.status },
      )
    }

    const data = await res.json()

    const xHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      if (key.startsWith('x-')) xHeaders[key] = value
    })

    return NextResponse.json({
      results: data.results,
      count: data.count,
      duration: data.duration,
      headers: xHeaders,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    )
  }
}
