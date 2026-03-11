import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const RENDERER_URL = process.env.RENDERER_SERVER_URL || 'http://localhost:3000'
const API_KEY = process.env.RENDERER_SERVER_API_KEY

function authHeaders(): Record<string, string> {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetch(`${RENDERER_URL}/api/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const limit = request.nextUrl.searchParams.get('limit') || '50'

  if (id) {
    try {
      const res = await fetch(`${RENDERER_URL}/api/v1/jobs/${id}`, { headers: authHeaders() })
      const data = await res.json()
      return NextResponse.json(data, { status: res.status })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 })
    }
  }

  // List path
  try {
    const res = await fetch(`${RENDERER_URL}/api/v1/jobs?limit=${limit}`, { headers: authHeaders() })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
