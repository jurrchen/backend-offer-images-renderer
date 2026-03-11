'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

const STORAGE_KEY = 'renderer-debug-url'
const DEFAULT_URL = process.env.NEXT_PUBLIC_DEFAULT_SERVER_URL || 'http://localhost:3000'

interface RendererConfigContextValue {
  rendererUrl: string
  setRendererUrl: (url: string) => void
}

const RendererConfigContext = createContext<RendererConfigContextValue | null>(null)

export function RendererConfigProvider({ children }: { children: ReactNode }) {
  const [rendererUrl, setRendererUrlState] = useState(DEFAULT_URL)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) setRendererUrlState(stored)
    setHydrated(true)
  }, [])

  const setRendererUrl = (url: string) => {
    setRendererUrlState(url)
    if (hydrated) {
      localStorage.setItem(STORAGE_KEY, url)
    }
  }

  // Persist on subsequent changes after hydration
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(STORAGE_KEY, rendererUrl)
    }
  }, [rendererUrl, hydrated])

  return (
    <RendererConfigContext.Provider value={{ rendererUrl, setRendererUrl }}>
      {children}
    </RendererConfigContext.Provider>
  )
}

export function useRendererConfig() {
  const ctx = useContext(RendererConfigContext)
  if (!ctx) {
    throw new Error('useRendererConfig must be used within a RendererConfigProvider')
  }
  return ctx
}
