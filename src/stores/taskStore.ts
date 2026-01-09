import { create } from 'zustand'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  writeBatch,
  UpdateData,
  DocumentData,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Task, TaskFormData } from '@/types'
import {
  startOfDay,
  endOfDay,
  isToday,
  isBefore,
  startOfWeek,
  subDays,
  format,
} from 'date-fns'

interface TaskState {
  tasks: Task[]
  loading: boolean
  error: string | null
  selectedTaskId: string | null

  // Actions
  setTasks: (tasks: Task[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSelectedTaskId: (id: string | null) => void

  // CRUD operations
  createTask: (userId: string, data: TaskFormData) => Promise<string>
  updateTask: (userId: string, taskId: string, data: Partial<TaskFormData>) => Promise<void>
  deleteTask: (userId: string, taskId: string) => Promise<void>
  toggleTaskStatus: (userId: string, taskId: string) => Promise<void>

  // Subscriptions
  subscribeToTasks: (userId: string) => () => void

  // Getters
  getTaskById: (id: string) => Task | undefined
  getTasksByProject: (projectId: string) => Task[]
  getTodayTasks: () => Task[]
  getOverdueTasks: () => Task[]
  getSubtasks: (parentId: string) => Task[]
  getTodayStats: () => { completed: number; total: number }
  getStreak: () => number
  getWeeklyActivity: () => { date: string; count: number }[]
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: true,
  error: null,
  selectedTaskId: null,

  setTasks: (tasks) => set({ tasks }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  createTask: async (userId, data) => {
    const tasksRef = collection(db, 'users', userId, 'tasks')
    const now = Timestamp.now()

    // Set default due date to today at 6 PM
    let dueDate: Timestamp | null = null
    if (data.dueDate) {
      dueDate = Timestamp.fromDate(data.dueDate)
    } else {
      const today = new Date()
      today.setHours(18, 0, 0, 0)
      dueDate = Timestamp.fromDate(today)
    }

    const newTask = {
      title: data.title,
      description: data.description || '',
      dueDate,
      priority: data.priority || 'medium',
      tags: data.tags || [],
      projectId: data.projectId || 'inbox',
      parentId: data.parentId || null,
      status: 'pending' as const,
      isRecurring: data.isRecurring || false,
      recurrence: data.recurrence || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      order: get().tasks.length,
    }

    const docRef = await addDoc(tasksRef, newTask)
    return docRef.id
  },

  updateTask: async (userId, taskId, data) => {
    const taskRef = doc(db, 'users', userId, 'tasks', taskId)
    const updates: UpdateData<DocumentData> = {
      updatedAt: Timestamp.now(),
    }

    if (data.title !== undefined) updates.title = data.title
    if (data.description !== undefined) updates.description = data.description
    if (data.priority !== undefined) updates.priority = data.priority
    if (data.tags !== undefined) updates.tags = data.tags
    if (data.projectId !== undefined) updates.projectId = data.projectId
    if (data.parentId !== undefined) updates.parentId = data.parentId
    if (data.isRecurring !== undefined) updates.isRecurring = data.isRecurring
    if (data.recurrence !== undefined) updates.recurrence = data.recurrence
    if (data.dueDate !== undefined) {
      updates.dueDate = data.dueDate ? Timestamp.fromDate(data.dueDate) : null
    }

    await updateDoc(taskRef, updates)
  },

  deleteTask: async (userId, taskId) => {
    const batch = writeBatch(db)

    // Delete the task
    const taskRef = doc(db, 'users', userId, 'tasks', taskId)
    batch.delete(taskRef)

    // Delete subtasks
    const subtasks = get().getSubtasks(taskId)
    for (const subtask of subtasks) {
      const subtaskRef = doc(db, 'users', userId, 'tasks', subtask.id)
      batch.delete(subtaskRef)
    }

    await batch.commit()
  },

  toggleTaskStatus: async (userId, taskId) => {
    const task = get().getTaskById(taskId)
    if (!task) return

    const taskRef = doc(db, 'users', userId, 'tasks', taskId)
    const newStatus = task.status === 'pending' ? 'completed' : 'pending'

    await updateDoc(taskRef, {
      status: newStatus,
      completedAt: newStatus === 'completed' ? Timestamp.now() : null,
      updatedAt: Timestamp.now(),
    })
  },

  subscribeToTasks: (userId) => {
    const tasksRef = collection(db, 'users', userId, 'tasks')
    const q = query(tasksRef, orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const tasks: Task[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Task[]

        set({ tasks, loading: false, error: null })
      },
      (error) => {
        console.error('Error fetching tasks:', error)
        set({ error: error.message, loading: false })
      }
    )

    return unsubscribe
  },

  getTaskById: (id) => {
    return get().tasks.find((t) => t.id === id)
  },

  getTasksByProject: (projectId) => {
    return get().tasks.filter(
      (t) => t.projectId === projectId && !t.parentId
    )
  },

  getTodayTasks: () => {
    return get().tasks.filter((task) => {
      if (!task.dueDate || task.parentId) return false
      const dueDate = task.dueDate.toDate()
      return isToday(dueDate)
    })
  },

  getOverdueTasks: () => {
    const now = new Date()
    return get().tasks.filter((task) => {
      if (!task.dueDate || task.status === 'completed' || task.parentId) return false
      const dueDate = task.dueDate.toDate()
      return isBefore(dueDate, startOfDay(now))
    })
  },

  getSubtasks: (parentId) => {
    return get().tasks.filter((t) => t.parentId === parentId)
  },

  getTodayStats: () => {
    const todayTasks = get().getTodayTasks()
    const completed = todayTasks.filter((t) => t.status === 'completed').length
    return { completed, total: todayTasks.length }
  },

  getStreak: () => {
    const tasks = get().tasks
    let streak = 0
    let currentDate = new Date()

    // Check each day going backwards
    while (true) {
      const dayStart = startOfDay(currentDate)
      const dayEnd = endOfDay(currentDate)

      const completedOnDay = tasks.some((task) => {
        if (!task.completedAt) return false
        const completedAt = task.completedAt.toDate()
        return completedAt >= dayStart && completedAt <= dayEnd
      })

      if (completedOnDay) {
        streak++
        currentDate = subDays(currentDate, 1)
      } else if (streak === 0 && isToday(currentDate)) {
        // If today has no completed tasks yet, check yesterday
        currentDate = subDays(currentDate, 1)
      } else {
        break
      }
    }

    return streak
  },

  getWeeklyActivity: () => {
    const tasks = get().tasks
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }) // Monday

    const activity: { date: string; count: number }[] = []

    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart)
      day.setDate(day.getDate() + i)
      const dayStart = startOfDay(day)
      const dayEnd = endOfDay(day)

      const count = tasks.filter((task) => {
        if (!task.completedAt) return false
        const completedAt = task.completedAt.toDate()
        return completedAt >= dayStart && completedAt <= dayEnd
      }).length

      activity.push({
        date: format(day, 'EEE'),
        count,
      })
    }

    return activity
  },
}))
