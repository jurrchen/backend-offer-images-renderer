import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const rendererUrl = process.env.RENDERER_SERVER_URL
  const apiKey = process.env.RENDERER_SERVER_API_KEY

  if (!rendererUrl) {
    return NextResponse.json({ error: 'RENDERER_SERVER_URL not configured' }, { status: 503 })
  }

  const params = request.nextUrl.searchParams
  const url = `${rendererUrl}/api/v1/analytics/renders?${params.toString()}`

  try {
    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })

    if (!res.ok) {
      const body = await res.text()
      return NextResponse.json({ error: body }, { status: res.status })
    }

    return NextResponse.json(await res.json())
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
