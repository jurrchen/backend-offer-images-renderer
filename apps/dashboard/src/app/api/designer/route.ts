import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const { serverUrl, ...designBody } = await request.json()
  const apiKey = process.env.RENDERER_SERVER_API_KEY

  if (!serverUrl) {
    return NextResponse.json(
      { error: 'serverUrl is required' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${serverUrl}/api/v1/design`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(designBody),
    })

    const text = await res.text()

    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      if (key.startsWith('x-')) {
        responseHeaders[key] = value
      }
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Designer returned ${res.status}`, detail: text },
        { status: res.status, headers: responseHeaders },
      )
    }

    const data = JSON.parse(text)
    return NextResponse.json({ ...data, _headers: responseHeaders })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    )
  }
}
