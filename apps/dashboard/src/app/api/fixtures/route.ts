import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rendererUrl =
    request.nextUrl.searchParams.get('rendererUrl') ??
    process.env.RENDERER_SERVER_URL
  const name = request.nextUrl.searchParams.get('name')

  if (!rendererUrl) {
    return NextResponse.json(
      { error: 'rendererUrl query param is required' },
      { status: 400 },
    )
  }

  try {
    const url = name
      ? `${rendererUrl}/api/v1/fixtures/${name}`
      : `${rendererUrl}/api/v1/fixtures`

    const res = await fetch(url)
    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    )
  }
}
