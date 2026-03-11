'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

export function Login() {
  const { signIn, error } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Renderer Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your Fourthwall account
          </p>
        </div>

        <Button onClick={signIn} size="lg" className="w-full">
          Sign in with Fourthwall
        </Button>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  )
}
