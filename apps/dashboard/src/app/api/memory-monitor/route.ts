import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rendererUrl = request.nextUrl.searchParams.get('rendererUrl')

  if (!rendererUrl) {
    return NextResponse.json(
      { error: 'rendererUrl query parameter is required' },
      { status: 400 },
    )
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const res = await fetch(`${rendererUrl}/api/v1/health/memory`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return NextResponse.json(
        { error: `Memory endpoint failed (${res.status})` },
        { status: res.status },
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    const msg = (error as Error).message
    return NextResponse.json(
      { error: `Failed to reach renderer-server: ${msg}` },
      { status: 502 },
    )
  }
}
