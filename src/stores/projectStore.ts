import { create } from 'zustand'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Project, ProjectFormData } from '@/types'

// Default project colors
const PROJECT_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
]

interface ProjectState {
  projects: Project[]
  loading: boolean
  error: string | null
  currentUserId: string | null

  // Actions
  setProjects: (projects: Project[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setCurrentUserId: (userId: string | null) => void

  // CRUD operations
  createProject: (data: ProjectFormData) => Promise<string>
  updateProject: (projectId: string, data: Partial<ProjectFormData>) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  archiveProject: (projectId: string) => Promise<void>

  // Subscriptions
  subscribeToProjects: (userId: string) => () => void

  // Getters
  getProjectById: (id: string) => Project | undefined
  getRandomColor: () => string
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: true,
  error: null,
  currentUserId: null,

  setProjects: (projects) => set({ projects }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setCurrentUserId: (userId) => set({ currentUserId: userId }),

  createProject: async (data) => {
    const userId = get().currentUserId
    if (!userId) throw new Error('User not authenticated')

    const projectsRef = collection(db, 'users', userId, 'projects')
    const now = Timestamp.now()

    const newProject = {
      name: data.name,
      color: data.color || get().getRandomColor(),
      order: get().projects.length,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }

    const docRef = await addDoc(projectsRef, newProject)
    return docRef.id
  },

  updateProject: async (projectId, data) => {
    const userId = get().currentUserId
    if (!userId) throw new Error('User not authenticated')

    const projectRef = doc(db, 'users', userId, 'projects', projectId)
    await updateDoc(projectRef, {
      ...data,
      updatedAt: Timestamp.now(),
    })
  },

  deleteProject: async (projectId) => {
    const userId = get().currentUserId
    if (!userId) throw new Error('User not authenticated')

    const projectRef = doc(db, 'users', userId, 'projects', projectId)
    await deleteDoc(projectRef)
  },

  archiveProject: async (projectId) => {
    const userId = get().currentUserId
    if (!userId) throw new Error('User not authenticated')

    const projectRef = doc(db, 'users', userId, 'projects', projectId)
    await updateDoc(projectRef, {
      isArchived: true,
      updatedAt: Timestamp.now(),
    })
  },

  subscribeToProjects: (userId) => {
    set({ currentUserId: userId })
    const projectsRef = collection(db, 'users', userId, 'projects')
    const q = query(projectsRef, orderBy('order', 'asc'))

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const projects: Project[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Project[]

        set({ projects, loading: false, error: null })
      },
      (error) => {
        console.error('Error fetching projects:', error)
        set({ error: error.message, loading: false })
      }
    )

    return unsubscribe
  },

  getProjectById: (id) => {
    return get().projects.find((p) => p.id === id)
  },

  getRandomColor: () => {
    const usedColors = get().projects.map((p) => p.color)
    const availableColors = PROJECT_COLORS.filter((c) => !usedColors.includes(c))
    if (availableColors.length === 0) {
      return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]
    }
    return availableColors[Math.floor(Math.random() * availableColors.length)]
  },
}))
