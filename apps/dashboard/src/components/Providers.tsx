'use client'

import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/contexts/AuthContext'
import { RendererConfigProvider } from '@/contexts/RendererConfigContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <AuthProvider>
        <RendererConfigProvider>
          {children}
        </RendererConfigProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
