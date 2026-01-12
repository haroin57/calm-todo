import type { RecurrencePattern } from '@/lib/parseNaturalLanguage'

export type Timeframe = 'today' | 'week' | 'month'
export type ViewTimeframe = Timeframe | 'completed' | 'plan' | 'archived'

export type Priority = 1 | 2 | 3 | 4  // P1=最高, P4=最低

// コメント型 (DOMのComment型と衝突しないようにTodoCommentとする)
export interface TodoComment {
  id: string
  text: string
  createdAt: number
}

// プロジェクト型
export interface Project {
  id: string
  name: string
  color: string
  order: number
  parentId: string | null  // サブプロジェクト用
  isFavorite: boolean      // お気に入り
  isArchived: boolean      // アーカイブ済み
}

// アクティビティ履歴型
export interface ActivityLog {
  id: string
  type: 'task_created' | 'task_completed' | 'task_deleted' | 'project_created' | 'task_updated'
  taskId?: string
  taskText?: string
  projectId?: string
  projectName?: string
  timestamp: number
}

// カルマ（ゲーミフィケーション）型
export interface KarmaStats {
  totalPoints: number
  level: number
  streak: number
  longestStreak: number
  tasksCompleted: number
  tasksCompletedToday: number
  lastCompletedDate: string | null
}

export interface Todo {
  id: string
  text: string
  completed: boolean
  completedAt: number | null  // 完了した日時
  createdAt: number
  parentId: string | null
  priority: Priority
  reminder: number | null  // timestamp for one-time reminder
  reminderSent: boolean
  weeklyReminder: {
    days: number[]  // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
    time: string    // "HH:MM" format (legacy, single time)
    times: string[] // "HH:MM" format array (multiple times)
    lastSent: { [time: string]: string } | null  // last sent date per time "YYYY-MM-DD"
  } | null
  followUpCount: number  // 追い通知の回数
  lastNotifiedAt: number | null  // 最後に通知した時刻
  timeframe: Timeframe  // 期間: 今日, 1週間, 1ヶ月
  dueDate: number | null  // 期日 (timestamp)
  dueDateNotified: boolean  // 期日通知済みフラグ
  labels: string[]  // ラベル/タグ
  recurrence: RecurrencePattern | null  // 繰り返しパターン
  description: string  // タスクの説明/ノート
  sectionId: string | null  // セクションID
  order: number  // 表示順序
  estimatedMinutes: number | null  // 所要時間（分）
  comments: TodoComment[]  // コメント
  projectId: string | null  // プロジェクトID
  karmaAwarded: boolean  // カルマ獲得済みフラグ（無限増殖防止）
  archived: boolean  // アーカイブ済みフラグ
  archivedAt: number | null  // アーカイブ日時
}

// セクション型
export interface Section {
  id: string
  name: string
  order: number
  collapsed: boolean
}

// カスタムフィルター型
export interface CustomFilter {
  id: string
  name: string
  query: {
    priority?: Priority
    timeframe?: Timeframe
    labels?: string[]
    completed?: boolean
    hasRecurrence?: boolean
    overdue?: boolean
  }
}

// 期間に基づいた自動リマインダー設定
export interface AutoReminderConfig {
  times: string[]  // リマインダー時刻の配列 "HH:MM"
  days: number[]   // 曜日の配列 (0=日, 1=月, ..., 6=土)
}
