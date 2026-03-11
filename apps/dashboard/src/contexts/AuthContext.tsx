'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
  type Auth,
} from 'firebase/auth'
import { getFirebaseAuth, keycloakProvider } from '@/lib/firebase/config'

interface AuthContextValue {
  user: User | null
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  logOut: () => Promise<void>
  getIdToken: () => Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const authRef = useRef<Auth | null>(null)

  useEffect(() => {
    // Initialize Firebase auth only on client side
    const auth = getFirebaseAuth()
    authRef.current = auth

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const signIn = useCallback(async () => {
    setError(null)
    const auth = authRef.current
    if (!auth) return
    try {
      const result = await signInWithPopup(auth, keycloakProvider)
      const email = result.user.email ?? ''
      if (!email.endsWith('@fourthwall.com')) {
        await signOut(auth)
        setError('Only @fourthwall.com accounts are allowed')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const logOut = useCallback(async () => {
    const auth = authRef.current
    if (!auth) return
    await signOut(auth)
  }, [])

  const getIdToken = useCallback(async () => {
    const auth = authRef.current
    if (!auth?.currentUser) {
      throw new Error('Not authenticated')
    }
    return auth.currentUser.getIdToken()
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, logOut, getIdToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
