/**
 * Shared helper for fetching analytics data from renderer-server.
 * Used by Next.js server components (pages) as a drop-in replacement
 * for Supabase direct queries.
 */

const BASE_URL = process.env.RENDERER_SERVER_URL ?? 'http://localhost:3000'
const API_KEY = process.env.RENDERER_SERVER_API_KEY

function headers(): HeadersInit {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<{ data: T[]; error: string | null }> {
  const url = new URL(`${BASE_URL}/api/v1/analytics/${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }

  try {
    const res = await fetch(url.toString(), { headers: headers(), cache: 'no-store' })
    if (!res.ok) {
      const text = await res.text()
      return { data: [], error: `Renderer API error ${res.status}: ${text}` }
    }
    return { data: await res.json() as T[], error: null }
  } catch (err) {
    return { data: [], error: (err as Error).message }
  }
}

export const rendererAnalytics = {
  renders: (params?: Record<string, string | undefined>) =>
    get<Record<string, unknown>>('renders', { limit: '500', ...params }),

  errors: (params?: Record<string, string | undefined>) =>
    get<Record<string, unknown>>('errors', { limit: '500', ...params }),

  apiMetrics: (params?: Record<string, string | undefined>) =>
    get<Record<string, unknown>>('api-metrics', { limit: '500', ...params }),

  workers: (params?: Record<string, string | undefined>) =>
    get<Record<string, unknown>>('workers', { limit: '500', ...params }),

  cache: (params?: Record<string, string | undefined>) =>
    get<Record<string, unknown>>('cache', { limit: '500', ...params }),

  testRuns: (params?: Record<string, string | undefined>) =>
    get<Record<string, unknown>>('test-runs', { limit: '500', ...params }),
}
