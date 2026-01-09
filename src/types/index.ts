import { Timestamp } from 'firebase/firestore'

// Priority levels
export type Priority = 'high' | 'medium' | 'low'

// Task status
export type TaskStatus = 'pending' | 'completed'

// Recurrence patterns
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'custom'

export interface Recurrence {
  frequency: RecurrenceFrequency
  interval: number // e.g., every 2 days/weeks/months
  daysOfWeek?: number[] // 0-6, Sunday = 0
  dayOfMonth?: number
  endDate?: Timestamp
}

// Task interface
export interface Task {
  id: string
  title: string
  description: string
  dueDate: Timestamp | null
  priority: Priority
  tags: string[]
  projectId: string
  parentId: string | null
  status: TaskStatus
  isRecurring: boolean
  recurrence: Recurrence | null
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt: Timestamp | null
  order: number
}

// Task form data (for creating/editing)
export interface TaskFormData {
  title: string
  description?: string
  dueDate?: Date | null
  priority?: Priority
  tags?: string[]
  projectId?: string
  parentId?: string | null
  isRecurring?: boolean
  recurrence?: Recurrence | null
}

// Project interface
export interface Project {
  id: string
  name: string
  color: string
  order: number
  isArchived: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

// Project form data
export interface ProjectFormData {
  name: string
  color?: string
}

// User settings
export interface UserSettings {
  notifications: NotificationSettings
  aiDecomposition: AISettings
  appearance: AppearanceSettings
}

export interface NotificationSettings {
  enabled: boolean
  reminderTime: '15min' | '30min' | '1hour' | '1day'
  morningDigest: boolean
  morningDigestTime: string // HH:mm format
  sound: boolean
}

export interface AISettings {
  autoSuggest: boolean
  granularity: 'coarse' | 'medium' | 'fine'
  showEffort: boolean
  language: 'ja' | 'en'
}

export interface AppearanceSettings {
  theme: 'dark' // Only dark mode for now
  compactMode: boolean
}

// AI Decomposition types
export type TaskCategory =
  | 'research'
  | 'setup'
  | 'implementation'
  | 'testing'
  | 'review'
  | 'documentation'

export type EffortEstimate =
  | '15 min'
  | '30 min'
  | '1 hour'
  | '1-2 hours'
  | '2-3 hours'
  | 'half day'

export interface Subtask {
  title: string
  category: TaskCategory
  effort: EffortEstimate
}

export interface DecomposeResult {
  subtasks: Subtask[]
  reasoning: string
}

// Filter types
export interface TaskFilters {
  status: 'all' | 'pending' | 'completed'
  priority: Priority | 'all'
  dueDate: 'all' | 'today' | 'week' | 'overdue' | 'none'
  projectId: string | 'all'
  tags: string[]
  search: string
}

export type SortField = 'dueDate' | 'priority' | 'createdAt' | 'title'
export type SortOrder = 'asc' | 'desc'

export interface TaskSort {
  field: SortField
  order: SortOrder
}
