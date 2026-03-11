export interface RendererBatchResponse {
  results: Array<{
    image: string
    color: string
    view: string
    region: string
  }>
  count: number
  duration: number
}

export interface RendererBatchRequest {
  generatorData?: any
  productSlug?: string
  images: Array<{ data: string; region?: string }>
  colors?: string[]
  views?: string[]
  renderSize?: number
  testRunId?: string
}

export async function renderBatch(
  serverUrl: string,
  apiKey: string,
  body: RendererBatchRequest
): Promise<{ response: RendererBatchResponse; headers: Record<string, string> }> {
  const res = await fetch(`${serverUrl}/api/v1/render/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Render failed (${res.status}): ${text}`)
  }

  const response: RendererBatchResponse = await res.json()

  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    if (key.startsWith('x-')) {
      headers[key] = value
    }
  })

  return { response, headers }
}
