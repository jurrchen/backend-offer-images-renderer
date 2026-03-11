'use client'

import { useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export function useAuthFetch() {
  const { getIdToken } = useAuth()

  const authFetch = useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const token = await getIdToken()
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      return fetch(url, { ...init, headers })
    },
    [getIdToken],
  )

  return authFetch
}
