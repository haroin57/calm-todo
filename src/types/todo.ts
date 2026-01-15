import type { RecurrencePattern } from '@/lib/parseNaturalLanguage'

export type Timeframe = 'today' | 'week' | 'month' | 'year'
export type ViewTimeframe = Timeframe | 'completed' | 'plan' | 'archived'

export type Priority = 1 | 2 | 3 | 4  // P1=最高, P4=最低

// コメント型 (DOMのComment型と衝突しないようにTodoCommentとする)
export interface TodoComment {
  id: string
  text: string
  createdAt: number
}

// ラベル定義型
export interface LabelDefinition {
  id: string
  name: string
  color: string  // HEX形式 (e.g., "#ff6b6b")
  order: number
}

// デフォルトラベルカラー
export const LABEL_COLORS = [
  '#ef4444', // 赤
  '#f97316', // オレンジ
  '#eab308', // 黄色
  '#22c55e', // 緑
  '#06b6d4', // シアン
  '#3b82f6', // 青
  '#8b5cf6', // 紫
  '#ec4899', // ピンク
  '#6b7280', // グレー
] as const

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

// 期日通知設定
export interface DueDateNotification {
  enabled: boolean          // 通知を有効化
  notifyBefore: number      // 期日の何分前に通知するか（分単位、0=期日時刻に通知）
  notifiedAt: number | null // 最後に通知した時刻
  followUpCount: number     // 追い通知の回数
}

export interface Todo {
  id: string
  text: string
  completed: boolean
  completedAt: number | null  // 完了した日時
  createdAt: number
  parentId: string | null
  priority: Priority
  timeframe: Timeframe  // 期間: 今日, 1週間, 1ヶ月
  dueDate: number | null  // 期日 (timestamp)
  dueDateNotification: DueDateNotification | null  // 期日通知設定
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

