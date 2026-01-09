import { useEffect } from 'react'
import { initAuthListener } from '@/stores/authStore'

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  useEffect(() => {
    // Initialize Firebase auth state listener
    const unsubscribe = initAuthListener()

    // Cleanup on unmount
    return () => unsubscribe()
  }, [])

  return <>{children}</>
}
