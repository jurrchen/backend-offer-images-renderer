'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Login } from './Login'
import { Sidebar } from '@/components/layout/sidebar'
import { RendererDebugPanel } from '@/components/layout/RendererDebugPanel'
import { Loader2 } from 'lucide-react'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 pl-64">
        <div className="container mx-auto p-6">{children}</div>
      </main>
      <RendererDebugPanel />
    </div>
  )
}
