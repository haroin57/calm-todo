import { create } from 'zustand'
import {
  User,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  signInWithGoogle: async () => {
    try {
      set({ loading: true, error: null })
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign in'
      set({ error: message })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  signOut: async () => {
    try {
      set({ loading: true, error: null })
      await firebaseSignOut(auth)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign out'
      set({ error: message })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))

// Initialize auth state listener
export function initAuthListener() {
  const { setUser, setLoading } = useAuthStore.getState()

  return onAuthStateChanged(auth, (user) => {
    setUser(user)
    setLoading(false)
  })
}
