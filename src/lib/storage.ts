import type {
  Todo,
  Section,
  Project,
  CustomFilter,
  ActivityLog,
  KarmaStats,
  Priority,
} from '@/types/todo'

// Storage keys
export const STORAGE_KEY = 'calm-todo-items'
export const COLLAPSED_KEY = 'calm-todo-collapsed'
export const INTRO_SEEN_KEY = 'calm-todo-intro-seen'
export const CUSTOM_FILTERS_KEY = 'calm-todo-custom-filters'
export const SECTIONS_KEY = 'calm-todo-sections'
export const VIEW_MODE_KEY = 'calm-todo-view-mode'
export const PROJECTS_KEY = 'calm-todo-projects'
export const ACTIVITY_LOG_KEY = 'calm-todo-activity'
export const KARMA_KEY = 'calm-todo-karma'

// Custom Filters
export function loadCustomFilters(): CustomFilter[] {
  try {
    const saved = localStorage.getItem(CUSTOM_FILTERS_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

export function saveCustomFilters(filters: CustomFilter[]) {
  localStorage.setItem(CUSTOM_FILTERS_KEY, JSON.stringify(filters))
}

// Sections
export function loadSections(): Section[] {
  try {
    const saved = localStorage.getItem(SECTIONS_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

export function saveSections(sections: Section[]) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
}

// Projects
export function loadProjects(): Project[] {
  try {
    const saved = localStorage.getItem(PROJECTS_KEY)
    if (!saved) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return JSON.parse(saved).map((p: any) => ({
      ...p,
      parentId: p.parentId ?? null,
      isFavorite: p.isFavorite ?? false,
      isArchived: p.isArchived ?? false,
    }))
  } catch {
    return []
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
}

// Activity Log
export function loadActivityLog(): ActivityLog[] {
  try {
    const saved = localStorage.getItem(ACTIVITY_LOG_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

export function saveActivityLog(logs: ActivityLog[]) {
  // 最新500件のみ保持
  const trimmed = logs.slice(-500)
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(trimmed))
}

// Karma
export function loadKarma(): KarmaStats {
  try {
    const saved = localStorage.getItem(KARMA_KEY)
    if (saved) return JSON.parse(saved)
  } catch {
    // ignore
  }
  return {
    totalPoints: 0,
    level: 1,
    streak: 0,
    longestStreak: 0,
    tasksCompleted: 0,
    tasksCompletedToday: 0,
    lastCompletedDate: null
  }
}

export function saveKarma(karma: KarmaStats) {
  localStorage.setItem(KARMA_KEY, JSON.stringify(karma))
}

// Karma level calculation
export function calculateLevel(points: number): number {
  if (points < 100) return 1
  if (points < 300) return 2
  if (points < 600) return 3
  if (points < 1000) return 4
  if (points < 1500) return 5
  if (points < 2100) return 6
  if (points < 2800) return 7
  if (points < 3600) return 8
  if (points < 4500) return 9
  return 10
}

// Level name
export function getLevelName(level: number): string {
  const names = ['', '初心者', '見習い', '実践者', '熟練者', '達人', 'マスター', 'グランドマスター', '伝説', '神話', '超越者']
  return names[level] || '超越者'
}

// View Mode
export function loadViewMode(): 'list' | 'board' | 'upcoming' {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY)
    return (saved as 'list' | 'board' | 'upcoming') || 'list'
  } catch {
    return 'list'
  }
}

export function saveViewMode(mode: 'list' | 'board' | 'upcoming') {
  localStorage.setItem(VIEW_MODE_KEY, mode)
}

// Todos
export function loadTodos(): Todo[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    // localStorageが空または[]の場合、後でファイルから復元を試みる
    const parsed = saved ? JSON.parse(saved) : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return parsed.map((t: any) => {
      // weeklyReminderのマイグレーション（旧形式から新形式へ）
      let weeklyReminder = t.weeklyReminder
      if (weeklyReminder) {
        // timesがない場合はtimeから生成
        if (!weeklyReminder.times) {
          weeklyReminder = { ...weeklyReminder, times: weeklyReminder.time ? [weeklyReminder.time] : [] }
        }
        // lastSentがstring形式の場合はオブジェクト形式に変換
        if (typeof weeklyReminder.lastSent === 'string') {
          const oldLastSent = weeklyReminder.lastSent
          weeklyReminder = { ...weeklyReminder, lastSent: weeklyReminder.times.reduce((acc: Record<string, string>, time: string) => ({ ...acc, [time]: oldLastSent }), {}) }
        }
      }
      // グループからラベルへのマイグレーション
      let labels = t.labels ?? []
      if (t.group && t.group !== 'default' && !labels.includes(t.group)) {
        labels = [...labels, t.group]
      }
      // 優先度のマイグレーション (high/medium/low → 1/2/3/4)
      let priority: Priority = 4
      if (typeof t.priority === 'number' && t.priority >= 1 && t.priority <= 4) {
        priority = t.priority as Priority
      } else if (t.priority === 'high') {
        priority = 1
      } else if (t.priority === 'medium') {
        priority = 2
      } else if (t.priority === 'low') {
        priority = 3
      }
      // 期日のマイグレーション（未設定の場合は今日の日付を設定）
      let dueDate = t.dueDate
      if (!dueDate && !t.completed) {
        const today = new Date()
        today.setHours(23, 59, 59, 999)
        dueDate = today.getTime()
      }
      return {
        id: t.id,
        text: t.text,
        completed: t.completed,
        createdAt: t.createdAt,
        parentId: t.parentId ?? null,
        priority,
        reminder: t.reminder ?? null,
        reminderSent: t.reminderSent ?? false,
        weeklyReminder,
        followUpCount: t.followUpCount ?? 0,
        lastNotifiedAt: t.lastNotifiedAt ?? null,
        timeframe: t.timeframe ?? 'today',
        dueDate,
        dueDateNotified: t.dueDateNotified ?? false,
        labels,
        recurrence: t.recurrence ?? null,
        description: t.description ?? '',
        sectionId: t.sectionId ?? null,
        order: t.order ?? 0,
        estimatedMinutes: t.estimatedMinutes ?? null,
        comments: t.comments ?? [],
        projectId: t.projectId ?? null,
        karmaAwarded: t.karmaAwarded ?? t.completed,  // 既存の完了済みタスクはkarmaAwarded=true
        archived: t.archived ?? false,
        archivedAt: t.archivedAt ?? null,
      }
    })
  } catch {
    return []
  }
}

export function saveTodos(todos: Todo[]) {
  const json = JSON.stringify(todos)
  localStorage.setItem(STORAGE_KEY, json)

  // 空のデータではファイルバックアップしない（データ消失防止）
  if (todos.length === 0) return

  // ファイルにも自動バックアップ（非同期、エラーは無視）
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('save_backup', { content: json }).catch(() => {
      // バックアップ失敗は無視（localStorageには保存済み）
    })
  }).catch(() => {})
}

// ファイルからTodoを復元（localStorageが空の場合に使用）
export async function restoreTodosFromBackup(): Promise<Todo[] | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const content = await invoke<string>('load_backup')
    if (!content) return null

    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed) || parsed.length === 0) return null

    console.log('[Storage] ファイルバックアップから復元:', parsed.length, '件')

    // localStorageにも保存（次回起動時用）
    localStorage.setItem(STORAGE_KEY, content)

    // マイグレーション処理を適用して返す
    return loadTodos()
  } catch (error) {
    console.log('[Storage] バックアップ復元失敗:', error)
    return null
  }
}

// Collapsed state
export function loadCollapsed(): Set<string> {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY)
    return new Set(saved ? JSON.parse(saved) : [])
  } catch {
    return new Set()
  }
}

export function saveCollapsed(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
}
