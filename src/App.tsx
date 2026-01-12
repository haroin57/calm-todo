import { useState, useEffect, useRef } from 'react'
import { KanaeReminderSettings } from './components/settings/KanaeReminderSettings'
import { decomposeTask, getKanaeConfig, startReminderService, stopReminderService, type ReminderTask, type Subtask, type NotificationResult } from './services/reminder'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { parseNaturalLanguage, getNextRecurrenceDate, formatRecurrence } from './lib/parseNaturalLanguage'
import { generatePlan, type PlanTask, type PlanResult } from './services/plan'
import { searchWithTavily, formatSearchResultsForPrompt, getTavilyApiKey } from './lib/tavily'
import { getApiKey as getOpenAiApiKey } from './lib/openai'
import { getClaudeApiKey } from './lib/claude'
import { getGeminiApiKey } from './lib/gemini'

// AIのAPIキーが少なくとも1つ設定されているかチェック
const hasAnyAiApiKey = (): boolean => {
  return !!(getOpenAiApiKey() || getClaudeApiKey() || getGeminiApiKey())
}

// Types
import type {
  Todo,
  TodoComment,
  Section,
  Project,
  CustomFilter,
  ActivityLog,
  KarmaStats,
  Priority,
  Timeframe,
  ViewTimeframe,
} from '@/types/todo'

// Storage utilities
import {
  INTRO_SEEN_KEY,
  loadCustomFilters,
  saveCustomFilters,
  loadSections,
  saveSections,
  loadProjects,
  saveProjects,
  loadActivityLog,
  saveActivityLog,
  loadKarma,
  saveKarma,
  calculateLevel,
  getLevelName,
  loadViewMode,
  saveViewMode,
  loadTodos,
  saveTodos,
  loadCollapsed,
  saveCollapsed,
} from '@/lib/storage'

// Utility functions
import {
  isTauri,
  showNotification,
  requestNotificationPermission,
  getAutoReminderConfig,
  saveBackup,
  loadBackup,
} from '@/lib/utils'

// イントロ用サンプル計画データ（3年でGoogle新卒内定を目指す例）
const INTRO_SAMPLE_PLAN: PlanResult = {
  currentState: "2026/1/12時点で、1日2〜4時間の継続学習時間を確保できる。Google新卒内定を3年後に目指しており、選考情報（体験談・落選談・難易度）を一部把握している。",
  goalState: "2029/1/12までにGoogle（想定：Google JapanのSWE/新卒枠）から新卒内定を獲得する。書類（CV/ES）→オンラインコーディングテスト→面接（技術面接複数回＋行動面接）を突破できる実力と実績を揃える。",
  gap: "①コーディングテスト/技術面接で安定して解けるアルゴリズム・データ構造の演習量と復習サイクル（目安：LeetCode/AtCoder合計300〜500問＋復習）②CS基礎（OS/ネットワーク/DB/計算量）③実務・開発実績（インターン、プロジェクト、OSS等）④行動面接（STARで語れるエピソード15〜20個）⑤応募書類（英語CV含む）と応募戦略（インターン経由/リファラル等）の整備。",
  feasibility: {
    verdict: "CHALLENGING",
    availableHours: 1638,
    requiredHours: 1900,
    calculation: "期限=3年後(2029/1/12)まで。平日稼働のみ・週末休み前提。稼働日=約3年×52週×5日=780日。1日平均3時間（2〜4hの中央値）×稼働率0.7（割り込み/体調/試験等）=2.1h/日。利用可能総時間=780×2.1=1638h。必要時間は、体験談ベースの演習量（LeetCode150+AtCoder100+AlgoExpert100=約350問）を'初見は2〜3倍かかる'前提で、(①アルゴ/DS演習・復習 900h) + (②CS基礎 250h) + (③開発実績/ポートフォリオ 350h) + (④面接対策(模擬/STAR) 150h) + (⑤応募準備/ネットワーキング 100h) + バッファ30%（約450h）≒合計1900hと見積もり。",
    adjustment: "達成確度を上げるには、(A)平日平均を3.5〜4hに寄せる、または(B)月1回だけ週末に半日(4h)確保、または(C)目標を『Google級（BigTech/外資SaaS含む）複数社内定→Google最優先』に広げて確率を上げる。最短で現実的なのは(A)+(C)。"
  },
  risks: [
    "スケジュールリスク: 学業/研究/アルバイト/サークル等で平日2〜4hが崩れ、復習が回らず演習が'解きっぱなし'になる。",
    "技術的リスク: アルゴリズムは解けても、面接での説明（思考の言語化）・バグ修正・計算量説明が弱く評価が伸びない。",
    "外部リスク: 新卒募集枠・採用人数・選考プロセスが年度で変動し、準備していた型が一部通用しない。",
    "競争リスク: 採用倍率が極めて高い（約0.2%という言及あり）ため、実力が十分でも運・タイミング・枠の影響で落ちる可能性が高い。",
    "精神コストリスク: 長期戦で不合格/停滞が続くと学習が止まる。短期の'詰め込み'に偏ると燃え尽きやすい。"
  ],
  costs: [
    "時間コスト: 3年間で平日780日×2〜4hの継続。演習（解く）だけでなく復習・記録・模擬面接に時間が必要。",
    "金銭コスト: LeetCode Premium数ヶ月課金の可能性、AlgoExpert/SystemsExpert、模擬面接（Exponent等の有料枠）、書籍（EPI/CCI等）で合計数万円〜十数万円規模になり得る。",
    "精神コスト: 毎日学習＋定期的な模擬面接の緊張、落選時のダメージ、周囲比較によるストレス。",
    "機会コスト: インターン/開発に時間を割くため、他活動（バイト/趣味/単位の余裕）を削る必要が出る。"
  ],
  summary: "3年を「基礎固め→実績作り→選考特化」の3フェーズに分け、アルゴ/DSをLeetCode・AtCoder中心に300〜500問規模で'復習込み'で回しつつ、インターン/プロジェクトでCVに書ける成果を作る。最後の6〜9ヶ月は、技術面接（45分×複数回）と行動面接（STAR 15〜20本）を模擬面接で仕上げ、応募・リファラル・インターン経由を含む複線で内定確率を最大化する。",
  estimatedDays: 780,
  tasks: [
    {
      title: "目標をSWE新卒に具体化し合格条件を定義する",
      description: "Googleの目標職種を『Google Japan SWE新卒（第一志望）』として明文化し、合格条件を数値化する（例：LeetCode合計300問/うちMedium200、AtCoder100、STARエピソード20本、模擬面接10回、CV1ページ完成）。",
      priority: "high",
      daysFromStart: 0,
      estimatedMinutes: 90
    },
    {
      title: "選考プロセスを体験談から逆算してチェックリスト化する",
      description: "体験談/記事から、選考ステップ・必要演習量・失敗点を抜き出してチェックリスト化する。",
      priority: "high",
      daysFromStart: 1,
      estimatedMinutes: 120
    },
    {
      title: "LeetCodeとAtCoderの学習環境を整備する",
      description: "LeetCodeとAtCoderにアカウント作成/整備し、使用言語を1つに固定。提出コードをGitHubに連携し、進捗記録用スプレッドシートを作る。",
      priority: "high",
      daysFromStart: 2,
      estimatedMinutes: 120
    },
    {
      title: "アルゴリズム学習の最初の2週間スプリントを作成する",
      description: "2週間で『配列/文字列・ハッシュ・二分探索・スタック/キュー』を回す計画を作る（平日10日×各日2問=20問＋復習2日）。",
      priority: "high",
      daysFromStart: 3,
      estimatedMinutes: 90
    },
    {
      title: "LeetCodeを2問解き、復習テンプレを確立する",
      description: "LeetCodeでEasy〜Mediumを2問解き、解法を『問題要約→方針→計算量→落とし穴→別解』で200〜400字にまとめる。",
      priority: "high",
      daysFromStart: 4,
      estimatedMinutes: 120
    }
  ],
  resources: [
    {
      name: "外資就活ドットコム（Google体験談）",
      type: "website",
      description: "Googleインターン経由の内定・英語が得意でなくても挑戦した事例。",
      cost: "無料（会員限定部分あり）"
    },
    {
      name: "LeetCode",
      type: "service",
      description: "アルゴリズム/データ構造の面接対策。タグ問題・頻出問題の演習に使う。",
      cost: "無料 / 有料（Premium）"
    },
    {
      name: "AtCoder",
      type: "service",
      description: "競技プログラミングで実装力と速度を鍛える。過去問演習に使う。",
      cost: "無料"
    },
    {
      name: "Pramp（模擬面接）",
      type: "service",
      description: "ペアで模擬面接を回し、説明力・緊張耐性を鍛える。",
      cost: "無料（枠制限あり）"
    }
  ],
  tips: [
    "演習は『解く→復習→数週間後に解き直す』までが1セット。復習日を最初からカレンダーに固定する。",
    "技術面接は'正解'だけでなく、思考の言語化・計算量・境界条件・バグ修正が評価対象。毎回、声に出して説明する練習を入れる。",
    "インターン経由が強いルートになり得る。3年計画なら、毎年『夏インターン応募』を必達イベントにする。",
    "STARエピソードは早めに作り、経験が増えるたびに差し替える。最終的に15〜20本を用意する。",
    "倍率が極端に高い前提で、Google一本足打法にしない。同時に複数社へ応募して確率を上げる。"
  ]
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>(loadCustomFilters)
  const [activeCustomFilter, setActiveCustomFilter] = useState<string | null>(null)
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [newFilterName, setNewFilterName] = useState('')
  const [newFilterPriority, setNewFilterPriority] = useState<Priority | null>(null)
  const [newFilterLabels, setNewFilterLabels] = useState<string[]>([])
  const [newFilterOverdue, setNewFilterOverdue] = useState(false)
  const [newFilterHasRecurrence, setNewFilterHasRecurrence] = useState(false)
  const [sections, setSections] = useState<Section[]>(loadSections)
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'upcoming'>(loadViewMode)
  const [showSectionModal, setShowSectionModal] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [editingDescription, setEditingDescription] = useState<string | null>(null)
  const [descriptionText, setDescriptionText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const kanaeSettingsSaveRef = useRef<(() => void) | null>(null)
  const [decomposing, setDecomposing] = useState<string | null>(null)
  const [decomposingTodo, setDecomposingTodo] = useState<Todo | null>(null)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(new Set())
  const [showDecomposeModal, setShowDecomposeModal] = useState(false)
  const [decomposeError, setDecomposeError] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null)
  const [currentTimeframe, setCurrentTimeframe] = useState<ViewTimeframe>('today')
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [reminderTodoId, setReminderTodoId] = useState<string | null>(null)
  const [reminderDateTime, setReminderDateTime] = useState('')
  const [reminderType, setReminderType] = useState<'once' | 'weekly'>('once')
  const [weeklyDays, setWeeklyDays] = useState<number[]>([])
  const [weeklyTime, setWeeklyTime] = useState('09:00')
  const [showDueDateModal, setShowDueDateModal] = useState(false)
  const [dueDateTodoId, setDueDateTodoId] = useState<string | null>(null)
  const [dueDateInput, setDueDateInput] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem(INTRO_SEEN_KEY))
  const [introStep, setIntroStep] = useState(0)
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null)
  const [showLabelModal, setShowLabelModal] = useState(false)
  const [labelTodoId, setLabelTodoId] = useState<string | null>(null)
  const [newLabelInput, setNewLabelInput] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeView, setActiveView] = useState<'inbox' | 'label' | 'filter' | 'project'>('inbox')
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  // プロジェクト関連
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#e07b39')
  // 所要時間関連
  const [showDurationModal, setShowDurationModal] = useState(false)
  const [durationTodoId, setDurationTodoId] = useState<string | null>(null)
  const [durationInput, setDurationInput] = useState('')
  // コメント関連
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [commentTodoId, setCommentTodoId] = useState<string | null>(null)
  const [newCommentText, setNewCommentText] = useState('')
  // アクティビティ履歴関連
  const [activityLog, setActivityLog] = useState<ActivityLog[]>(loadActivityLog)
  const [showActivityModal, setShowActivityModal] = useState(false)
  // カルマ関連
  const [karma, setKarma] = useState<KarmaStats>(loadKarma)
  const [showKarmaModal, setShowKarmaModal] = useState(false)
  // サブプロジェクト関連
  const [newProjectParentId, setNewProjectParentId] = useState<string | null>(null)
  // ドラッグ&ドロップ関連
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null)
  // 計画機能関連
  const [planGoal, setPlanGoal] = useState('')
  const [planResult, setPlanResult] = useState<PlanResult | null>(null)
  const [planTasks, setPlanTasks] = useState<PlanTask[]>([])
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [planError, setPlanError] = useState('')
  const [editingPlanTaskIndex, setEditingPlanTaskIndex] = useState<number | null>(null)
  const [editingPlanTaskTitle, setEditingPlanTaskTitle] = useState('')
  const [planLabel, setPlanLabel] = useState('')
  const [planProjectId, setPlanProjectId] = useState<string | null>(null)
  // 削除確認関連
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [confirmDeleteDisabled, setConfirmDeleteDisabled] = useState(() =>
    localStorage.getItem('calm-todo-skip-delete-confirm') === 'true'
  )
  // 複数選択モード
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<string>>(new Set())
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  // Undo用の履歴
  const [todosHistory, setTodosHistory] = useState<Todo[][]>([])
  // 履歴を保存しながらTodosを更新するラッパー関数
  const updateTodosWithHistory = (updater: (prev: Todo[]) => Todo[]) => {
    setTodosHistory(prev => [...prev.slice(-19), todos])
    setTodos(updater)
  }
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const todosRef = useRef<Todo[]>(todos)

  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  const getReminderTasks = (): ReminderTask[] => {
    return todosRef.current.map(todo => ({
      id: todo.id,
      title: todo.text,
      status: todo.completed ? 'completed' : 'pending',
      dueDate: todo.dueDate ?? null,
      // 追加フィールド（統合リマインダー用）
      parentId: todo.parentId,
      completed: todo.completed,
      reminder: todo.reminder,
      reminderSent: todo.reminderSent,
      weeklyReminder: todo.weeklyReminder,
      dueDateNotified: todo.dueDateNotified,
      followUpCount: todo.followUpCount,
      lastNotifiedAt: todo.lastNotifiedAt,
      timeframe: todo.timeframe,
    }))
  }

  // 通知後のタスク更新コールバック
  const handleNotificationUpdates = (results: NotificationResult[]) => {
    setTodos(prevTodos => {
      const updated = prevTodos.map(todo => {
        const result = results.find(r => r.taskId === todo.id)
        if (result) {
          // ReminderTaskからTodoへの安全なマッピング
          const { weeklyReminder, ...otherUpdates } = result.updates
          const todoUpdates: Partial<Todo> = {}
          // 共通フィールドのコピー
          if (otherUpdates.reminderSent !== undefined) todoUpdates.reminderSent = otherUpdates.reminderSent
          if (otherUpdates.dueDateNotified !== undefined) todoUpdates.dueDateNotified = otherUpdates.dueDateNotified
          if (otherUpdates.followUpCount !== undefined) todoUpdates.followUpCount = otherUpdates.followUpCount
          if (otherUpdates.lastNotifiedAt !== undefined) todoUpdates.lastNotifiedAt = otherUpdates.lastNotifiedAt
          // weeklyReminderは型を保証
          if (weeklyReminder !== undefined) {
            todoUpdates.weeklyReminder = weeklyReminder as Todo['weeklyReminder']
          }
          return { ...todo, ...todoUpdates }
        }
        return todo
      })
      saveTodos(updated)
      return updated
    })
  }

  const syncKanaeReminderService = () => {
    stopReminderService()
    const config = getKanaeConfig()
    if (config.enabled) {
      startReminderService(getReminderTasks, handleNotificationUpdates)
    }
  }

  useEffect(() => {
    syncKanaeReminderService()
    return () => stopReminderService()
  }, [])

  // Listen for tray quick-add event
  useEffect(() => {
    if (!isTauri()) return

    const unlisten = listen('tray-quick-add', () => {
      // Focus the input field when tray "add" is clicked
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // Listen for task-added event from quick-add window
  useEffect(() => {
    if (!isTauri()) return

    const unlisten = listen('task-added', () => {
      // Reload todos from localStorage
      setTodos(loadTodos())
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // Auto-restore from backup if localStorage is empty
  useEffect(() => {
    const autoRestore = async () => {
      const localTodos = loadTodos()
      if (localTodos.length === 0) {
        const backup = await loadBackup()
        if (backup && backup.todos && backup.todos.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const migrated = backup.todos.map((t: any) => {
            // グループからラベルへのマイグレーション
            let labels = t.labels ?? []
            if (t.group && t.group !== 'default' && !labels.includes(t.group)) {
              labels = [...labels, t.group]
            }
            // 優先度のマイグレーション
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
              weeklyReminder: t.weeklyReminder,
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
              karmaAwarded: t.karmaAwarded ?? t.completed,
              archived: t.archived ?? false,
              archivedAt: t.archivedAt ?? null
            }
          })
          setTodos(migrated)
          saveTodos(migrated)
          if (backup.collapsed) {
            const collapsedSet = new Set(backup.collapsed)
            setCollapsed(collapsedSet)
            saveCollapsed(collapsedSet)
          }
        }
      }
    }
    autoRestore()
  }, [])

  useEffect(() => { saveTodos(todos); saveBackup(todos, collapsed) }, [todos])
  useEffect(() => { saveCollapsed(collapsed); saveBackup(todos, collapsed) }, [collapsed])
  useEffect(() => { saveProjects(projects) }, [projects])

  // Debug: log exportResult changes
  useEffect(() => {
    console.log('exportResult changed:', exportResult)
  }, [exportResult])

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.todo-input')?.focus()
      }
      if (e.key === 'Escape') {
        setShowSettings(false)
        setShowDecomposeModal(false)
        setShowReminderModal(false)
        setShowDueDateModal(false)
        setShowLabelModal(false)
        setShowHelp(false)
        setShowCalendar(false)
        setSelectedCalendarDay(null)
        setEditingId(null)
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(true)
      }
      // Ctrl+Z で Undo
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        if (todosHistory.length > 0) {
          const previous = todosHistory[todosHistory.length - 1]
          setTodos(previous)
          setTodosHistory(prev => prev.slice(0, -1))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [todosHistory])

  // ファイルダイアログでバックアップを選択して復元
  const restoreFromBackupWithDialog = async () => {
    if (!isTauri()) return
    try {
      const content = await invoke<string>('load_backup_with_dialog')
      const backup = JSON.parse(content)
      if (backup && backup.todos && backup.todos.length > 0) {
        applyBackupData(backup)
      }
    } catch (e) {
      console.warn('Restore cancelled or failed:', e)
    }
  }

  // ファイルダイアログで場所を選んで手動バックアップ保存
  const saveBackupManual = async () => {
    if (!isTauri()) return
    try {
      const content = JSON.stringify({ todos, collapsed: [...collapsed], savedAt: new Date().toISOString() })
      await invoke('save_backup_with_dialog', { content })
    } catch (e) {
      console.warn('Backup save cancelled or failed:', e)
    }
  }

  // バックアップデータを適用する共通関数
  const applyBackupData = (backup: { todos: unknown[], collapsed?: string[] }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrated = backup.todos.map((t: any) => {
      // グループからラベルへのマイグレーション
      let labels = t.labels ?? []
      if (t.group && t.group !== 'default' && !labels.includes(t.group)) {
        labels = [...labels, t.group]
      }
      // 優先度のマイグレーション
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
        weeklyReminder: t.weeklyReminder,
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
        karmaAwarded: t.karmaAwarded ?? t.completed,
        archived: t.archived ?? false,
        archivedAt: t.archivedAt ?? null
      }
    })
    setTodos(migrated)
    if (backup.collapsed) {
      setCollapsed(new Set(backup.collapsed))
    }
  }


  const [isAddingTodo, setIsAddingTodo] = useState(false)

  const addTodo = async () => {
    const rawText = input.trim()
    if (!rawText || isAddingTodo) return

    setIsAddingTodo(true)
    setInput('') // 入力をすぐにクリア（UX向上）
    setDecomposeError('')
    // textareaの高さをリセット
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    try {
      // 自然言語パーサーで入力を解析（GPT APIを使用）
      const parsed = await parseNaturalLanguage(rawText)

      // 期日が必須
      if (!parsed.dueDate) {
        setDecomposeError('期日を指定してください（例：「明日」「来週月曜」「1/20」など）')
        setInput(rawText)
        setIsAddingTodo(false)
        return
      }

      // タイムフレームの決定（パースされたものか現在のものを使用、'completed'/'plan'/'archived'の場合は'today'にフォールバック）
      const effectiveTimeframe: Timeframe = (currentTimeframe === 'completed' || currentTimeframe === 'plan' || currentTimeframe === 'archived') ? 'today' : currentTimeframe
      const timeframe = parsed.dueDate ? parsed.timeframe : effectiveTimeframe
      const config = getAutoReminderConfig(timeframe)
      const weeklyReminder = { days: config.days, time: config.times[0] || '12:00', times: config.times, lastSent: null }

      updateTodosWithHistory(prev => [{
        id: crypto.randomUUID(),
        text: parsed.text,
        completed: false,
        createdAt: Date.now(),
        parentId: null,
        priority: parsed.priority,
        reminder: null,
        reminderSent: false,
        weeklyReminder,
        followUpCount: 0,
        lastNotifiedAt: null,
        timeframe,
        dueDate: parsed.dueDate,
        dueDateNotified: false,
        labels: parsed.labels,
        recurrence: parsed.recurrence,
        description: '',
        sectionId: null,
        order: prev.length,
        estimatedMinutes: parsed.estimatedMinutes,
        comments: [],
        projectId: selectedProjectId,
        karmaAwarded: false,
        archived: false,
        archivedAt: null,
      }, ...prev])
    } catch (error) {
      console.error('Failed to add todo:', error)
      // エラー時は元の入力を復元
      setInput(rawText)
    } finally {
      setIsAddingTodo(false)
    }
  }

  // アクティビティログ追加ヘルパー
  const addActivityLog = (log: Omit<ActivityLog, 'id' | 'timestamp'>) => {
    const newLog: ActivityLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }
    setActivityLog(prev => {
      const updated = [...prev, newLog]
      saveActivityLog(updated)
      return updated
    })
  }

  // カルマ更新ヘルパー（タスク完了時）
  const updateKarmaOnComplete = (taskPriority: Priority) => {
    setKarma(prev => {
      const today = new Date().toISOString().slice(0, 10)
      const isNewDay = prev.lastCompletedDate !== today
      const newStreak = isNewDay ? (prev.lastCompletedDate === new Date(Date.now() - 86400000).toISOString().slice(0, 10) ? prev.streak + 1 : 1) : prev.streak

      // 優先度に応じたポイント (P1=10, P2=7, P3=5, P4=3)
      const pointsMap: Record<Priority, number> = { 1: 10, 2: 7, 3: 5, 4: 3 }
      const basePoints = pointsMap[taskPriority]
      // ストリークボーナス
      const streakBonus = Math.min(newStreak, 7)
      const totalPointsEarned = basePoints + streakBonus

      const newTotalPoints = prev.totalPoints + totalPointsEarned
      const newLevel = calculateLevel(newTotalPoints)

      const updated: KarmaStats = {
        totalPoints: newTotalPoints,
        level: newLevel,
        streak: newStreak,
        longestStreak: Math.max(prev.longestStreak, newStreak),
        tasksCompleted: prev.tasksCompleted + 1,
        tasksCompletedToday: isNewDay ? 1 : prev.tasksCompletedToday + 1,
        lastCompletedDate: today
      }
      saveKarma(updated)
      return updated
    })
  }

  // カルマ更新ヘルパー（タスク完了取り消し時）
  const updateKarmaOnUncomplete = (taskPriority: Priority) => {
    setKarma(prev => {
      // 優先度に応じたポイント (P1=10, P2=7, P3=5, P4=3)
      const pointsMap: Record<Priority, number> = { 1: 10, 2: 7, 3: 5, 4: 3 }
      const basePoints = pointsMap[taskPriority]
      // ストリークボーナスは完了時と同じ計算（最大7）
      const streakBonus = Math.min(prev.streak, 7)
      const totalPointsToRemove = basePoints + streakBonus

      const newTotalPoints = Math.max(0, prev.totalPoints - totalPointsToRemove)
      const newLevel = calculateLevel(newTotalPoints)

      const updated: KarmaStats = {
        ...prev,
        totalPoints: newTotalPoints,
        level: newLevel,
        tasksCompleted: Math.max(0, prev.tasksCompleted - 1),
        tasksCompletedToday: Math.max(0, prev.tasksCompletedToday - 1)
      }
      saveKarma(updated)
      return updated
    })
  }

  const toggleTodo = (id: string) => {
    setTodosHistory(prevHistory => [...prevHistory.slice(-19), todos])
    setTodos(prev => {
      const target = prev.find(t => t.id === id)
      if (!target) return prev
      const newCompleted = !target.completed

      // カルマとアクティビティログの更新
      if (newCompleted) {
        // 完了時：ポイント付与
        updateKarmaOnComplete(target.priority)
        addActivityLog({
          type: 'task_completed',
          taskId: target.id,
          taskText: target.text
        })
      } else if (target.karmaAwarded) {
        // 完了取り消し時：ポイント減点（獲得済みの場合のみ）
        updateKarmaOnUncomplete(target.priority)
      }
      const getDescendantIds = (parentId: string): string[] => {
        const children = prev.filter(t => t.parentId === parentId)
        return children.flatMap(c => [c.id, ...getDescendantIds(c.id)])
      }
      const idsToToggle = new Set([id, ...getDescendantIds(id)])

      // まず対象タスクと子タスクを更新（完了/未完了に応じてkarmaAwardedを更新）
      let updated = prev.map(todo => idsToToggle.has(todo.id) ? { ...todo, completed: newCompleted, followUpCount: newCompleted ? 0 : todo.followUpCount, lastNotifiedAt: newCompleted ? null : todo.lastNotifiedAt, karmaAwarded: newCompleted } : todo)

      // 子タスクを完了した場合、親タスクのすべての子が完了したか確認
      if (newCompleted && target.parentId) {
        const checkAndCompleteParent = (parentId: string | null) => {
          if (!parentId) return
          const siblings = updated.filter(t => t.parentId === parentId)
          const allSiblingsCompleted = siblings.length > 0 && siblings.every(t => t.completed)
          if (allSiblingsCompleted) {
            updated = updated.map(t => t.id === parentId ? { ...t, completed: true, followUpCount: 0, lastNotifiedAt: null, karmaAwarded: true } : t)
            // 親の親も確認
            const parent = updated.find(t => t.id === parentId)
            if (parent?.parentId) {
              checkAndCompleteParent(parent.parentId)
            }
          }
        }
        checkAndCompleteParent(target.parentId)
      }

      // 繰り返しタスクを完了した場合、次回のタスクを自動生成
      if (newCompleted && target.recurrence && !target.parentId) {
        const nextDate = getNextRecurrenceDate(target.recurrence, new Date())
        const config = getAutoReminderConfig(target.timeframe)
        const weeklyReminder = { days: config.days, time: config.times[0] || '12:00', times: config.times, lastSent: null }

        const nextTodo: Todo = {
          id: crypto.randomUUID(),
          text: target.text,
          completed: false,
          createdAt: Date.now(),
          parentId: null,
          priority: target.priority,
          reminder: null,
          reminderSent: false,
          weeklyReminder,
          followUpCount: 0,
          lastNotifiedAt: null,
          timeframe: target.timeframe,
          dueDate: nextDate.getTime(),
          dueDateNotified: false,
          labels: target.labels,
          recurrence: target.recurrence,
          description: target.description,
          sectionId: target.sectionId,
          order: 0,
          estimatedMinutes: target.estimatedMinutes,
          comments: [],
          projectId: target.projectId,
          karmaAwarded: false,
          archived: false,
          archivedAt: null,
        }
        updated = [nextTodo, ...updated]
      }

      return updated
    })
  }

  // 削除リクエスト（確認モーダル表示または直接削除）
  const requestDeleteTodo = (id: string) => {
    if (confirmDeleteDisabled) {
      executeTodoDelete(id)
    } else {
      setDeleteTargetId(id)
      setShowDeleteConfirm(true)
    }
  }

  // 実際の削除処理
  const executeTodoDelete = (id: string) => {
    const target = todos.find(t => t.id === id)
    if (target) {
      addActivityLog({
        type: 'task_deleted',
        taskId: target.id,
        taskText: target.text
      })
    }
    const idsToDelete = new Set([id, ...getDescendantIds(id)])
    updateTodosWithHistory(prev => prev.filter(todo => !idsToDelete.has(todo.id)))
  }

  // 削除確認モーダルから確定
  const confirmTodoDelete = (skipNextTime: boolean) => {
    if (deleteTargetId) {
      if (skipNextTime) {
        localStorage.setItem('calm-todo-skip-delete-confirm', 'true')
        setConfirmDeleteDisabled(true)
      }
      executeTodoDelete(deleteTargetId)
      setShowDeleteConfirm(false)
      setDeleteTargetId(null)
    }
  }

  // 削除キャンセル
  const cancelTodoDelete = () => {
    setShowDeleteConfirm(false)
    setDeleteTargetId(null)
  }

  // 複数選択モードの切り替え
  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectedTodoIds(new Set())
    }
    setSelectionMode(!selectionMode)
  }

  // 子孫タスクのIDを取得
  const getDescendantIds = (parentId: string): string[] => {
    const children = todos.filter(t => t.parentId === parentId)
    return children.flatMap(c => [c.id, ...getDescendantIds(c.id)])
  }

  // 個別タスクの選択/解除（親タスクを選択すると子タスクも選択）
  const toggleTodoSelection = (id: string) => {
    setSelectedTodoIds(prev => {
      const next = new Set(prev)
      const descendantIds = getDescendantIds(id)

      if (next.has(id)) {
        // 選択解除時は自分と子孫すべてを解除
        next.delete(id)
        descendantIds.forEach(childId => next.delete(childId))
      } else {
        // 選択時は自分と子孫すべてを選択
        next.add(id)
        descendantIds.forEach(childId => next.add(childId))
      }
      return next
    })
  }

  // 表示中のすべてのタスクを選択（子タスクも含む）
  const selectAllVisibleTodos = () => {
    const visibleParentIds = buildTree(null)
      .filter(t => !isHidden(t) && t.parentId === null)
      .map(t => t.id)

    const allIds = new Set<string>()
    visibleParentIds.forEach(id => {
      allIds.add(id)
      getDescendantIds(id).forEach(childId => allIds.add(childId))
    })
    setSelectedTodoIds(allIds)
  }

  // すべての選択を解除
  const clearSelection = () => {
    setSelectedTodoIds(new Set())
  }

  // 選択したタスクを一括削除（確認ダイアログを表示）
  const requestDeleteSelectedTodos = () => {
    if (selectedTodoIds.size === 0) return
    if (confirmDeleteDisabled) {
      executeDeleteSelectedTodos()
    } else {
      setShowBulkDeleteConfirm(true)
    }
  }

  // 選択したタスクを実際に削除
  const executeDeleteSelectedTodos = () => {
    if (selectedTodoIds.size === 0) return

    const allIdsToDelete = new Set<string>()
    selectedTodoIds.forEach(id => {
      allIdsToDelete.add(id)
      getDescendantIds(id).forEach(childId => allIdsToDelete.add(childId))
    })

    // アクティビティログに記録
    selectedTodoIds.forEach(id => {
      const target = todos.find(t => t.id === id)
      if (target) {
        addActivityLog({
          type: 'task_deleted',
          taskId: target.id,
          taskText: target.text
        })
      }
    })

    updateTodosWithHistory(prev => prev.filter(todo => !allIdsToDelete.has(todo.id)))
    setSelectedTodoIds(new Set())
    setSelectionMode(false)
    setShowBulkDeleteConfirm(false)
  }

  // 一括削除キャンセル
  const cancelBulkDelete = () => {
    setShowBulkDeleteConfirm(false)
  }

  // 選択したタスクを一括完了/未完了切り替え
  const toggleSelectedTodosCompletion = () => {
    if (selectedTodoIds.size === 0) return

    const selectedTodos = todos.filter(t => selectedTodoIds.has(t.id))
    const allCompleted = selectedTodos.every(t => t.completed)
    const newCompleted = !allCompleted

    updateTodosWithHistory(prev => prev.map(todo =>
      selectedTodoIds.has(todo.id)
        ? { ...todo, completed: newCompleted, karmaAwarded: newCompleted }
        : todo
    ))
  }

  // 選択したタスクの優先度を一括変更
  const setSelectedTodosPriority = (priority: Priority) => {
    if (selectedTodoIds.size === 0) return

    updateTodosWithHistory(prev => prev.map(todo =>
      selectedTodoIds.has(todo.id)
        ? { ...todo, priority }
        : todo
    ))
  }

  const archiveCompleted = () => {
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.completed && !todo.archived
        ? { ...todo, archived: true, archivedAt: Date.now() }
        : todo
    ))
  }

  const cycleTimeframe = (id: string) => {
    const todo = todos.find(t => t.id === id)
    if (!todo) return
    const next: Timeframe = todo.timeframe === 'today' ? 'week' : todo.timeframe === 'week' ? 'month' : 'today'

    updateTodosWithHistory(prev => prev.map(t => {
      if (t.id !== id) return t
      const config = getAutoReminderConfig(next)
      const weeklyReminder = { days: config.days, time: config.times[0] || '12:00', times: config.times, lastSent: null }
      return { ...t, timeframe: next, reminder: null, reminderSent: false, weeklyReminder, followUpCount: 0, lastNotifiedAt: null }
    }))

    // ビューをインボックスに保ち、タイムフレームを更新
    if (activeView === 'inbox') {
      setCurrentTimeframe(next)
    }
  }

  const timeframeLabel = (tf: Timeframe) => tf === 'today' ? '今日' : tf === 'week' ? '週' : '月'

  const handleSaveSettings = () => {
    // 設定を保存（KanaeReminderSettingsが全てのAPIキーを管理）
    if (kanaeSettingsSaveRef.current) {
      kanaeSettingsSaveRef.current()
    }
    setShowSettings(false)
  }

  const buildDecomposeContext = (todo: Todo) => {
    if (!todo.projectId) return undefined

    const projectName = projects.find(p => p.id === todo.projectId)?.name ?? null
    const relatedCandidates = todos.filter(t =>
      t.projectId === todo.projectId &&
      t.id !== todo.id &&
      !t.archived
    )
    const activeRelated = relatedCandidates.filter(t => !t.completed)
    const source = activeRelated.length > 0 ? activeRelated : relatedCandidates
    const relatedTasks = source
      .sort((a, b) => a.order - b.order)
      .map(t => t.text.trim())
      .filter(Boolean)
      .filter((task, index, array) => array.indexOf(task) === index)
      .slice(0, 5)

    if (!projectName && relatedTasks.length === 0) return undefined
    return { projectName, relatedTasks }
  }

  const handleDecompose = async (todo: Todo) => {
    // 事前にAPIキーをチェック
    if (!hasAnyAiApiKey()) {
      window.alert('AI APIキーが設定されていません。\n設定画面でOpenAI、Claude、Geminiのいずれかのキーを入力してください。')
      return
    }

    setDecomposingTodo(todo)
    setDecomposing(todo.id)
    setDecomposeError('')
    try {
      const context = buildDecomposeContext(todo)
      const result = await decomposeTask(todo.text, context)

      // APIエラーがある場合は明示的にエラー表示
      if (result.error) {
        window.alert(`${result.error.message}\n${result.error.hint}`)
        return
      }

      if (result.subtasks.length === 0) {
        setDecomposeError('タスクを分解できませんでした。別のタスクで試してみてください。')
        return
      }

      setSubtasks(result.subtasks)
      setSelectedSubtasks(new Set(result.subtasks.map((_, i) => i)))
      setShowDecomposeModal(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error'
      // APIキー未設定エラーは明示的なアラートで表示
      if (message.includes('APIキーが設定されていません')) {
        window.alert(message)
      } else {
        setDecomposeError(message)
      }
    } finally { setDecomposing(null) }
  }

  const toggleSubtask = (index: number) => {
    setSelectedSubtasks(prev => {
      const next = new Set(prev)
      if (next.has(index)) { next.delete(index) } else { next.add(index) }
      return next
    })
  }

  const toggleAllSubtasks = () => {
    console.log('[toggleAllSubtasks] called, current:', selectedSubtasks.size, 'total:', subtasks.length)
    if (selectedSubtasks.size === subtasks.length) {
      console.log('[toggleAllSubtasks] deselecting all')
      setSelectedSubtasks(new Set())
    } else {
      console.log('[toggleAllSubtasks] selecting all')
      setSelectedSubtasks(new Set(subtasks.map((_, i) => i)))
    }
  }

  const updateSubtaskTitle = (index: number, newTitle: string) => {
    setSubtasks(prev => prev.map((st, i) => i === index ? { ...st, title: newTitle } : st))
  }

  const updateSubtaskPriority = (index: number) => {
    setSubtasks(prev => prev.map((st, i) => {
      if (i !== index) return st
      const next = st.priority === 'high' ? 'medium' : st.priority === 'medium' ? 'low' : 'high'
      return { ...st, priority: next }
    }))
  }

  const addSelectedSubtasks = () => {
    const selected = subtasks.filter((_, i) => selectedSubtasks.has(i))
    if (selected.length === 0) return
    const parentId = decomposingTodo?.id ?? null
    const parentTimeframe = decomposingTodo?.timeframe ?? 'today'
    const autoReminder = getAutoReminderConfig(parentTimeframe)
    const mapPriority = (p: string | undefined): Priority => {
      if (p === 'high') return 1
      if (p === 'medium') return 2
      if (p === 'low') return 3
      return 4
    }
    const newTodos: Todo[] = selected.map(st => ({
      id: crypto.randomUUID(),
      text: st.title,
      completed: false,
      createdAt: Date.now(),
      parentId,
      priority: mapPriority(st.priority),
      reminder: null,
      reminderSent: false,
      weeklyReminder: { days: autoReminder.days, time: autoReminder.times[0], times: autoReminder.times, lastSent: null },
      followUpCount: 0,
      lastNotifiedAt: null,
      timeframe: parentTimeframe,
      dueDate: null,
      dueDateNotified: false,
      labels: [],
      recurrence: null,
      description: '',
      sectionId: null,
      order: 0,
      estimatedMinutes: st.estimatedMinutes ?? null,
      comments: [],
      projectId: decomposingTodo?.projectId ?? null,
      karmaAwarded: false,
      archived: false,
      archivedAt: null,
    }))
    updateTodosWithHistory(prev => {
      const parentIndex = prev.findIndex(t => t.id === parentId)
      if (parentIndex >= 0) {
        const before = prev.slice(0, parentIndex + 1)
        const after = prev.slice(parentIndex + 1)
        return [...before, ...newTodos, ...after]
      } else {
        return [...newTodos, ...prev]
      }
    })
    setShowDecomposeModal(false)
    setSubtasks([])
    setSelectedSubtasks(new Set())
  }

  const cyclePriority = (id: string) => {
    updateTodosWithHistory(prev => prev.map(todo => {
      if (todo.id !== id) return todo
      const next: Priority = todo.priority === 4 ? 1 : (todo.priority + 1) as Priority
      return { ...todo, priority: next }
    }))
  }

  const priorityLabel = (p: Priority) => `P${p}`
  const priorityColor = (p: Priority) => p === 1 ? 'p1' : p === 2 ? 'p2' : p === 3 ? 'p3' : 'p4'

  // サブタスク用（openai.tsのhigh/medium/low形式）
  const subtaskPriorityLabel = (p: string | undefined) => {
    if (p === 'high') return 'P1'
    if (p === 'medium') return 'P2'
    if (p === 'low') return 'P3'
    return 'P4'
  }
  const subtaskPriorityColor = (p: string | undefined) => {
    if (p === 'high') return 'p1'
    if (p === 'medium') return 'p2'
    if (p === 'low') return 'p3'
    return 'p4'
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const saveEdit = () => {
    if (!editingId || !editText.trim()) return
    updateTodosWithHistory(prev => prev.map(todo => todo.id === editingId ? { ...todo, text: editText.trim() } : todo))
    setEditingId(null)
    setEditText('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const toggleCollapse = (todoId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(todoId)) { next.delete(todoId) } else { next.add(todoId) }
      return next
    })
  }

  const hasChildren = (todoId: string) => todos.some(t => t.parentId === todoId)

  const getDepth = (todo: Todo): number => {
    if (!todo.parentId) return 0
    const parent = todos.find(t => t.id === todo.parentId)
    return parent ? 1 + getDepth(parent) : 0
  }

  const isHidden = (todo: Todo): boolean => {
    if (!todo.parentId) return false
    if (collapsed.has(todo.parentId)) return true
    const parent = todos.find(t => t.id === todo.parentId)
    return parent ? isHidden(parent) : false
  }

  const buildTree = (parentId: string | null): Todo[] => {
    const children = displayTodos.filter(t => t.parentId === parentId)
    return children.flatMap(child => [child, ...buildTree(child.id)])
  }

  // 全ラベルを収集
  const allLabels = [...new Set(todos.flatMap(t => t.labels || []))].sort()

  const filteredTodos = todos.filter(todo => {
    // アーカイブタブの場合はアーカイブ済みのみ表示
    if (currentTimeframe === 'archived') {
      return todo.archived === true
    }

    // アーカイブ済みは通常のタブでは非表示
    if (todo.archived) return false

    // activeViewに基づくフィルタリング
    if (activeView === 'inbox' || activeView === 'label') {
      // 「完了」タブの場合は完了済みタスクのみ
      if (currentTimeframe === 'completed') {
        if (!todo.completed) return false
      } else if (currentTimeframe !== 'plan') {
        // 通常の期間タブ: currentTimeframeでフィルター
        if (todo.parentId === null && todo.timeframe !== currentTimeframe) return false
        if (todo.parentId !== null) {
          const parent = todos.find(t => t.id === todo.parentId)
          if (parent && parent.timeframe !== currentTimeframe) return false
        }
      }
      // ラベルビューの場合は追加でラベルフィルター
      if (activeView === 'label' && selectedLabel && (!todo.labels || !todo.labels.includes(selectedLabel))) return false
    } else if (activeView === 'project') {
      // プロジェクトビュー: 選択されたプロジェクトのタスクのみ
      if (selectedProjectId && todo.projectId !== selectedProjectId) return false
    }

    // 追加のラベルフィルター（カスタムフィルター等用）
    if (labelFilter && activeView !== 'label' && (!todo.labels || !todo.labels.includes(labelFilter))) return false
    // 完了/未完了フィルター（「完了」タブ以外で適用）
    if (currentTimeframe !== 'completed') {
      if (filter === 'active') return !todo.completed
      if (filter === 'completed') return todo.completed
    }
    return true
  })

  const completedCount = todos.filter(t => t.completed && !t.archived).length

  // カスタムフィルター関連の関数
  const addCustomFilter = () => {
    const name = newFilterName.trim()
    if (!name) return

    const newFilter: CustomFilter = {
      id: crypto.randomUUID(),
      name,
      query: {
        ...(newFilterPriority !== null && { priority: newFilterPriority }),
        ...(newFilterLabels.length > 0 && { labels: newFilterLabels }),
        ...(newFilterOverdue && { overdue: true }),
        ...(newFilterHasRecurrence && { hasRecurrence: true }),
      }
    }

    const updated = [...customFilters, newFilter]
    setCustomFilters(updated)
    saveCustomFilters(updated)
    setShowFilterModal(false)
    setNewFilterName('')
    setNewFilterPriority(null)
    setNewFilterLabels([])
    setNewFilterOverdue(false)
    setNewFilterHasRecurrence(false)
  }

  const deleteCustomFilter = (id: string) => {
    const updated = customFilters.filter(f => f.id !== id)
    setCustomFilters(updated)
    saveCustomFilters(updated)
    if (activeCustomFilter === id) {
      setActiveCustomFilter(null)
    }
  }

  const applyCustomFilter = (filter: CustomFilter | null) => {
    if (filter) {
      setActiveCustomFilter(filter.id)
      // ラベルフィルターをリセット
      if (filter.query.labels && filter.query.labels.length > 0) {
        setLabelFilter(filter.query.labels[0])
      } else {
        setLabelFilter(null)
      }
    } else {
      setActiveCustomFilter(null)
      setLabelFilter(null)
    }
  }

  const getFilteredByCustomFilter = (todoList: Todo[]) => {
    const activeFilter = customFilters.find(f => f.id === activeCustomFilter)
    if (!activeFilter) return todoList

    return todoList.filter(todo => {
      const { query } = activeFilter
      if (query.priority && todo.priority !== query.priority) return false
      if (query.labels && query.labels.length > 0 && (!todo.labels || !query.labels.some(l => todo.labels.includes(l)))) return false
      if (query.overdue && (!todo.dueDate || todo.dueDate > Date.now() || todo.completed)) return false
      if (query.hasRecurrence && !todo.recurrence) return false
      if (query.completed !== undefined && todo.completed !== query.completed) return false
      return true
    })
  }

  // カスタムフィルターを適用した結果
  const displayTodos = activeCustomFilter ? getFilteredByCustomFilter(filteredTodos) : filteredTodos

  // セクション関連の関数
  const addSection = () => {
    const name = newSectionName.trim()
    if (!name) return

    const newSection: Section = {
      id: crypto.randomUUID(),
      name,
      order: sections.length,
      collapsed: false,
    }

    const updated = [...sections, newSection]
    setSections(updated)
    saveSections(updated)
    setShowSectionModal(false)
    setNewSectionName('')
  }

  // ビューモード変更
  const changeViewMode = (mode: 'list' | 'board' | 'upcoming') => {
    setViewMode(mode)
    saveViewMode(mode)
  }

  // タスク説明の編集
  const startEditDescription = (todo: Todo) => {
    setEditingDescription(todo.id)
    setDescriptionText(todo.description)
  }

  const saveDescription = () => {
    if (editingDescription) {
      updateTodosWithHistory(prev => prev.map(t => t.id === editingDescription ? { ...t, description: descriptionText } : t))
      setEditingDescription(null)
      setDescriptionText('')
    }
  }

  const cancelEditDescription = () => {
    setEditingDescription(null)
    setDescriptionText('')
  }

  // ラベル編集関連の関数
  const openLabelModal = (todoId: string) => {
    setLabelTodoId(todoId)
    setNewLabelInput('')
    setShowLabelModal(true)
  }

  const closeLabelModal = () => {
    setShowLabelModal(false)
    setLabelTodoId(null)
    setNewLabelInput('')
  }

  const addLabelToTodo = () => {
    const label = newLabelInput.trim().replace(/^#/, '') // #があれば削除
    if (!label || !labelTodoId) return
    updateTodosWithHistory(prev => prev.map(t => {
      if (t.id !== labelTodoId) return t
      if (t.labels.includes(label)) return t // 重複は追加しない
      return { ...t, labels: [...t.labels, label] }
    }))
    setNewLabelInput('')
  }

  const removeLabelFromTodo = (todoId: string, label: string) => {
    updateTodosWithHistory(prev => prev.map(t => {
      if (t.id !== todoId) return t
      return { ...t, labels: t.labels.filter(l => l !== label) }
    }))
  }

  // プロジェクト関連の関数
  const addProject = () => {
    const name = newProjectName.trim()
    if (!name) return
    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      color: newProjectColor,
      order: projects.length,
      parentId: newProjectParentId,
      isFavorite: false,
      isArchived: false,
    }
    setProjects(prev => [...prev, newProject])
    addActivityLog({
      type: 'project_created',
      projectId: newProject.id,
      projectName: newProject.name
    })
    setShowProjectModal(false)
    setNewProjectName('')
    setNewProjectColor('#e07b39')
    setNewProjectParentId(null)
  }

  // お気に入りトグル
  const toggleProjectFavorite = (id: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p))
  }

  // プロジェクトアーカイブトグル（将来使用）
  const _toggleProjectArchive = (id: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, isArchived: !p.isArchived } : p))
  }
  void _toggleProjectArchive

  // サブプロジェクト取得
  const getSubProjects = (parentId: string | null): Project[] => {
    return projects.filter(p => p.parentId === parentId && !p.isArchived).sort((a, b) => a.order - b.order)
  }

  // お気に入りプロジェクト取得
  const getFavoriteProjects = (): Project[] => {
    return projects.filter(p => p.isFavorite && !p.isArchived)
  }

  const deleteProject = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id))
    // プロジェクトに属するタスクのprojectIdをnullに
    updateTodosWithHistory(prev => prev.map(t => t.projectId === id ? { ...t, projectId: null } : t))
    if (selectedProjectId === id) {
      setSelectedProjectId(null)
      setActiveView('inbox')
    }
  }

  const _setTodoProject = (todoId: string, projectId: string | null) => {
    updateTodosWithHistory(prev => prev.map(t => t.id === todoId ? { ...t, projectId } : t))
  }
  // 将来的にタスクのプロジェクト割り当てに使用
  void _setTodoProject

  // ドラッグ&ドロップ関連
  const handleDragStart = (todoId: string) => {
    setDraggedTodoId(todoId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (targetTodoId: string) => {
    if (!draggedTodoId || draggedTodoId === targetTodoId) {
      setDraggedTodoId(null)
      return
    }
    updateTodosWithHistory(prev => {
      const draggedIndex = prev.findIndex(t => t.id === draggedTodoId)
      const targetIndex = prev.findIndex(t => t.id === targetTodoId)
      if (draggedIndex === -1 || targetIndex === -1) return prev
      const updated = [...prev]
      const [dragged] = updated.splice(draggedIndex, 1)
      updated.splice(targetIndex, 0, dragged)
      // orderを更新
      return updated.map((t, i) => ({ ...t, order: i }))
    })
    setDraggedTodoId(null)
  }

  const handleDragEnd = () => {
    setDraggedTodoId(null)
  }

  // 所要時間関連の関数
  const openDurationModal = (todoId: string) => {
    const todo = todos.find(t => t.id === todoId)
    setDurationInput(todo?.estimatedMinutes?.toString() || '')
    setDurationTodoId(todoId)
    setShowDurationModal(true)
  }

  const setDuration = () => {
    if (!durationTodoId) return
    const minutes = parseInt(durationInput, 10)
    updateTodosWithHistory(prev => prev.map(t =>
      t.id === durationTodoId ? { ...t, estimatedMinutes: isNaN(minutes) ? null : minutes } : t
    ))
    setShowDurationModal(false)
    setDurationTodoId(null)
    setDurationInput('')
  }

  const clearDuration = (todoId: string) => {
    updateTodosWithHistory(prev => prev.map(t => t.id === todoId ? { ...t, estimatedMinutes: null } : t))
    setShowDurationModal(false)
    setDurationTodoId(null)
  }

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`
  }

  // コメント関連の関数
  const openCommentModal = (todoId: string) => {
    setCommentTodoId(todoId)
    setNewCommentText('')
    setShowCommentModal(true)
  }

  const addComment = () => {
    const text = newCommentText.trim()
    if (!text || !commentTodoId) return
    const newComment: TodoComment = {
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
    }
    updateTodosWithHistory(prev => prev.map(t =>
      t.id === commentTodoId ? { ...t, comments: [...t.comments, newComment] } : t
    ))
    setNewCommentText('')
  }

  const deleteComment = (todoId: string, commentId: string) => {
    updateTodosWithHistory(prev => prev.map(t =>
      t.id === todoId ? { ...t, comments: t.comments.filter(c => c.id !== commentId) } : t
    ))
  }


  // Today's date reference
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const openReminderModal = (todoId: string) => {
    const todo = todos.find(t => t.id === todoId)
    if (todo?.weeklyReminder) {
      setReminderType('weekly')
      setWeeklyDays(todo.weeklyReminder.days)
      setWeeklyTime(todo.weeklyReminder.time)
      setReminderDateTime('')
    } else if (todo?.reminder) {
      setReminderType('once')
      const date = new Date(todo.reminder)
      setReminderDateTime(date.toISOString().slice(0, 16))
      setWeeklyDays([])
      setWeeklyTime('09:00')
    } else {
      setReminderType('once')
      // 期日がある場合は12時間前をデフォルトに
      if (todo?.dueDate) {
        const defaultReminder = new Date(todo.dueDate - 12 * 60 * 60 * 1000)
        setReminderDateTime(defaultReminder.toISOString().slice(0, 16))
      } else {
        const now = new Date()
        now.setHours(now.getHours() + 1, 0, 0, 0)
        setReminderDateTime(now.toISOString().slice(0, 16))
      }
      setWeeklyDays([])
      setWeeklyTime('09:00')
    }
    setReminderTodoId(todoId)
    setShowReminderModal(true)
  }

  const setReminder = () => {
    if (!reminderTodoId) return
    if (reminderType === 'once') {
      if (!reminderDateTime) return
      const timestamp = new Date(reminderDateTime).getTime()
      updateTodosWithHistory(prev => prev.map(todo =>
        todo.id === reminderTodoId ? { ...todo, reminder: timestamp, reminderSent: false, weeklyReminder: null } : todo
      ))
    } else {
      if (weeklyDays.length === 0) return
      updateTodosWithHistory(prev => prev.map(todo =>
        todo.id === reminderTodoId ? { ...todo, reminder: null, reminderSent: false, weeklyReminder: { days: weeklyDays, time: weeklyTime, times: [weeklyTime], lastSent: null } } : todo
      ))
    }
    setShowReminderModal(false)
    setReminderTodoId(null)
    setReminderDateTime('')
    setWeeklyDays([])
    setWeeklyTime('09:00')
  }

  const clearReminder = (todoId: string) => {
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.id === todoId ? { ...todo, reminder: null, reminderSent: false, weeklyReminder: null } : todo
    ))
    setShowReminderModal(false)
    setReminderTodoId(null)
    setWeeklyDays([])
    setWeeklyTime('09:00')
  }

  const toggleWeeklyDay = (day: number) => {
    setWeeklyDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort())
  }

  const dayNames = ['日', '月', '火', '水', '木', '金', '土']

  const formatReminder = (timestamp: number) => {
    const date = new Date(timestamp)
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${month}/${day} ${hours}:${minutes}`
  }

  const formatWeeklyReminder = (weekly: { days: number[], time: string }) => {
    const daysStr = weekly.days.map(d => dayNames[d]).join('')
    return `毎${daysStr} ${weekly.time}`
  }

  const openDueDateModal = (todoId: string) => {
    const todo = todos.find(t => t.id === todoId)
    if (todo?.dueDate) {
      const date = new Date(todo.dueDate)
      // Format as datetime-local value (YYYY-MM-DDTHH:MM)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      setDueDateInput(`${year}-${month}-${day}T${hours}:${minutes}`)
    } else {
      // Default to tomorrow at 18:00
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(18, 0, 0, 0)
      const year = tomorrow.getFullYear()
      const month = String(tomorrow.getMonth() + 1).padStart(2, '0')
      const day = String(tomorrow.getDate()).padStart(2, '0')
      setDueDateInput(`${year}-${month}-${day}T18:00`)
    }
    setDueDateTodoId(todoId)
    setShowDueDateModal(true)
  }

  const setDueDate = () => {
    if (!dueDateTodoId || !dueDateInput) return
    const timestamp = new Date(dueDateInput).getTime()
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.id === dueDateTodoId ? { ...todo, dueDate: timestamp, dueDateNotified: false } : todo
    ))
    setShowDueDateModal(false)
    setDueDateTodoId(null)
    setDueDateInput('')
  }

  const clearDueDate = (todoId: string) => {
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.id === todoId ? { ...todo, dueDate: null, dueDateNotified: false } : todo
    ))
    setShowDueDateModal(false)
    setDueDateTodoId(null)
    setDueDateInput('')
  }

  const formatDueDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${month}/${day} ${hours}:${minutes}`
  }

  const isDueDateOverdue = (timestamp: number) => {
    return Date.now() > timestamp
  }

  // Calendar helper functions
  const getCalendarDays = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startOffset = firstDay.getDay()
    const daysInMonth = lastDay.getDate()

    const days: (Date | null)[] = []
    for (let i = 0; i < startOffset; i++) days.push(null)
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i))
    return days
  }

  const getTasksForDay = (date: Date) => {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    return todos.filter(t => t.dueDate && t.dueDate >= dayStart && t.dueDate < dayEnd)
  }

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
  }

  // Generate ICS content for a single task
  const generateICS = (todo: Todo) => {
    if (!todo.dueDate) return null
    const date = new Date(todo.dueDate)
    const formatICSDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const endDate = new Date(date.getTime() + 60 * 60 * 1000) // 1 hour duration

    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calm Todo//EN
BEGIN:VEVENT
UID:${todo.id}@calmtodo
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(date)}
DTEND:${formatICSDate(endDate)}
SUMMARY:${todo.text}
DESCRIPTION:Calm Todoからのタスク
STATUS:${todo.completed ? 'COMPLETED' : 'CONFIRMED'}
END:VEVENT
END:VCALENDAR`
  }

  // Export all tasks with due dates to ICS
  const exportAllToICS = () => {
    const tasksWithDueDate = todos.filter(t => t.dueDate)
    if (tasksWithDueDate.length === 0) return

    const formatICSDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const events = tasksWithDueDate.map(todo => {
      const date = new Date(todo.dueDate!)
      const endDate = new Date(date.getTime() + 60 * 60 * 1000)
      return `BEGIN:VEVENT
UID:${todo.id}@calmtodo
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(date)}
DTEND:${formatICSDate(endDate)}
SUMMARY:${todo.text}
DESCRIPTION:Calm Todoからのタスク
STATUS:${todo.completed ? 'COMPLETED' : 'CONFIRMED'}
END:VEVENT`
    }).join('\n')

    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calm Todo//EN
${events}
END:VCALENDAR`

    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `calm-todo-${new Date().toISOString().slice(0, 10)}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Export to ICS and open Google Calendar import page
  const exportToGoogleCalendar = () => {
    const tasksWithDueDate = todos.filter(t => t.dueDate)
    if (tasksWithDueDate.length === 0) return

    // If 5 or fewer tasks, open each directly in Google Calendar
    if (tasksWithDueDate.length <= 5) {
      tasksWithDueDate.forEach((todo, i) => {
        const url = getGoogleCalendarURL(todo)
        if (url) {
          setTimeout(() => window.open(url, '_blank'), i * 300)
        }
      })
      return
    }

    // For more tasks, export ICS and open Google Calendar import settings
    exportAllToICS()
    setTimeout(() => {
      window.open('https://calendar.google.com/calendar/u/0/r/settings/export', '_blank')
    }, 500)
  }

  // Download single task as ICS
  const downloadTaskICS = (todo: Todo) => {
    const ics = generateICS(todo)
    if (!ics) return
    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `task-${todo.id.slice(0, 8)}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Generate Google Calendar URL
  const getGoogleCalendarURL = (todo: Todo) => {
    if (!todo.dueDate) return null
    const date = new Date(todo.dueDate)
    const endDate = new Date(date.getTime() + 60 * 60 * 1000)
    const formatGoogleDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: todo.text,
      dates: `${formatGoogleDate(date)}/${formatGoogleDate(endDate)}`,
      details: 'Calm Todoからのタスク'
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  const completeIntro = () => {
    localStorage.setItem(INTRO_SEEN_KEY, 'true')
    setShowIntro(false)
    setIntroStep(0)
    // イントロ終了時にサンプル計画をクリア
    setCurrentTimeframe('today')
    setPlanGoal('')
    setPlanResult(null)
    setPlanTasks([])
    setShowSettings(false)
  }

  // イントロサンプル表示用の状態を保持する参照
  const introSamplePlanRef = useRef<PlanResult | null>(null)
  const introPrevTimeframeRef = useRef<ViewTimeframe>('today')

  // Highlight target element during intro
  useEffect(() => {
    if (!showIntro) return
    const step = introSteps[introStep]

    let el: Element | null = null
    let btnEls: Element[] = []

    // Execute action if defined
    if (step?.action === 'openSettings') {
      setShowSettings(true)
    } else if (step?.action === 'closeSettings') {
      setShowSettings(false)
    } else if (step?.action === 'showPlanSample') {
      // 計画タブに切り替えてサンプルを表示
      introPrevTimeframeRef.current = currentTimeframe
      introSamplePlanRef.current = planResult
      setCurrentTimeframe('plan')
      setPlanGoal('2027年度の新卒採用でGoogleに内定する')
      setPlanResult(INTRO_SAMPLE_PLAN)
      setPlanTasks(INTRO_SAMPLE_PLAN.tasks)
      setShowSettings(false)
    } else if (step?.action === 'closePlanSample') {
      // サンプルをクリアして元に戻す
      setCurrentTimeframe(introPrevTimeframeRef.current)
      setPlanGoal('')
      setPlanResult(introSamplePlanRef.current)
      setPlanTasks(introSamplePlanRef.current?.tasks || [])
    } else if (step?.action === 'scrollToAiSettings') {
      // 設定を開いてAI設定セクションにスクロール
      setCurrentTimeframe(introPrevTimeframeRef.current)
      setPlanGoal('')
      setPlanResult(introSamplePlanRef.current)
      setPlanTasks(introSamplePlanRef.current?.tasks || [])
      setShowSettings(true)
    }

    // Delay to allow modal/view to render
    const delay = step?.action === 'openSettings' || step?.action === 'scrollToAiSettings' ? 200 : step?.action === 'showPlanSample' ? 100 : 0
    const timeout = setTimeout(() => {
      if (step?.target) {
        el = document.querySelector(step.target)
        if (el) {
          el.classList.add('intro-highlight')
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }

      // Highlight specific buttons
      if (step?.btnTarget) {
        btnEls = Array.from(document.querySelectorAll(step.btnTarget))
        btnEls.forEach(btn => btn.classList.add('intro-highlight-btn'))
      }

      // AI設定セクションへのスクロール
      if (step?.action === 'scrollToAiSettings') {
        const aiSection = document.querySelector('.api-keys-top')
        if (aiSection) {
          aiSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }, delay)

    return () => {
      clearTimeout(timeout)
      if (el) {
        el.classList.remove('intro-highlight')
      }
      btnEls.forEach(btn => btn.classList.remove('intro-highlight-btn'))
    }
  }, [showIntro, introStep])

  const introSteps: Array<{
    title: string
    content: string
    icon: string
    target: string | null
    btnTarget: string | null
    action?: 'openSettings' | 'closeSettings' | 'showPlanSample' | 'closePlanSample' | 'scrollToAiSettings'
  }> = [
    {
      title: 'Calm Todoへようこそ！',
      content: '<hl>完全オフライン</hl>で動作するタスク管理アプリです。\nアカウント不要、データはローカルに安全に保存されます。',
      icon: '👋',
      target: null,
      btnTarget: null
    },
    {
      title: 'タスクを追加',
      content: '入力欄に<hl>自然な文章</hl>でタスクを追加できます。\n\n例：<hl>明日 買い物 #仕事 P1</hl>\n→ 期日・ラベル・優先度を自動認識します。',
      icon: '✏️',
      target: '.quick-add',
      btnTarget: null,
      action: 'closePlanSample'
    },
    {
      title: '期間で整理',
      content: 'タスクは<hl>今日・1週間・1ヶ月・計画</hl>の4つで管理。\n<hl>「計画」タブ</hl>では目標を入力するとAIが計画を自動生成します。',
      icon: '📅',
      target: '.timeframe-tabs',
      btnTarget: null
    },
    {
      title: 'AI計画生成',
      content: '下に表示されているのは<hl>実際の生成例</hl>です。\n\n（スクロールして見てみてね）\n\n<hl>現在地点・到達目標・ギャップ分析</hl>、\n達成可能性、リスク・コスト、タスクリストを自動生成します。\n\n<hl>Tavily APIキー</hl>（無料）を設定すると、\nウェブ検索で精度の高い計画を生成できます。',
      icon: '🎯',
      target: '.plan-analysis',
      btnTarget: null,
      action: 'showPlanSample'
    },
    {
      title: 'AI設定',
      content: '設定で<hl>APIキー</hl>を登録すると、以下の機能が使えます：\n\n• タスク分解（✨ボタン）\n• 計画生成（計画タブ）\n• 専属リマインダー\n\n対応：<hl>OpenAI / Claude / Gemini</hl>',
      icon: '⚙️',
      target: '.api-keys-top',
      btnTarget: null,
      action: 'scrollToAiSettings'
    },
    {
      title: '専属リマインダー',
      content: 'AIキャラクターがリマインドしてくれます。\n\n<hl>「人格」タブ</hl>でプリセットを選択、\nまたはカスタム人格を作成できます。',
      icon: '💬',
      target: '.settings-modal',
      btnTarget: null,
      action: 'openSettings'
    },
    {
      title: 'さあ、始めましょう！',
      content: '詳しい使い方は左下の<hl>【?】ヘルプ</hl>で確認できます。\n\n<hl>【n】キー</hl>でタスク追加、<hl>【?】キー</hl>でヘルプ表示。\n\n<hl>注意：</hl>通知機能を使うには<hl>スタートアップに登録</hl>してアプリを常駐させてください。',
      icon: '🚀',
      target: '.help-btn',
      btnTarget: '.help-btn',
      action: 'closeSettings'
    }
  ]

  const viewTitle = activeView === 'inbox' ? 'タスク' :
    activeView === 'label' && selectedLabel ? `#${selectedLabel}` :
    activeView === 'project' && selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name || 'プロジェクト' :
    'タスク'

  return (
    <div className={'app-container' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
      {/* サイドバー */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? '展開' : '折りたたむ'}>
            {sidebarCollapsed ? '→' : '←'}
          </button>
          {!sidebarCollapsed && <h1 className="app-logo">Calm Todo</h1>}
        </div>

        {!sidebarCollapsed && (
          <>
            {/* ナビゲーション（固定） */}
            <nav className="sidebar-nav">
              <button className={'nav-item' + (activeView === 'inbox' ? ' active' : '')} onClick={() => { setActiveView('inbox'); setSelectedLabel(null); setLabelFilter(null); }}>
                <span className="nav-icon">📥</span>
                <span className="nav-label">タスク</span>
                <span className="nav-count">{todos.filter(t => t.parentId === null && !t.completed).length}</span>
              </button>
            </nav>

            {/* スクロール可能エリア */}
            <div className="sidebar-content">
            {/* お気に入りセクション */}
            {getFavoriteProjects().length > 0 && (
              <div className="sidebar-section">
                <div className="section-header">
                  <span className="section-title">⭐ お気に入り</span>
                </div>
                <div className="project-list">
                  {getFavoriteProjects().map(project => (
                    <div key={project.id} className={'project-item' + (activeView === 'project' && selectedProjectId === project.id ? ' active' : '')}>
                      <button className="project-item-btn" onClick={() => { setActiveView('project'); setSelectedProjectId(project.id); }}>
                        <span className="project-dot" style={{ backgroundColor: project.color }}></span>
                        <span className="project-name">{project.name}</span>
                        <span className="project-count">{todos.filter(t => t.projectId === project.id && !t.completed).length}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* カルマセクション */}
            <div className="sidebar-section karma-section">
              <button className="karma-display" onClick={() => setShowKarmaModal(true)}>
                <span className="karma-level">Lv.{karma.level}</span>
                <span className="karma-title">{getLevelName(karma.level)}</span>
                <span className="karma-points">{karma.totalPoints}pt</span>
                {karma.streak > 0 && <span className="karma-streak">🔥{karma.streak}</span>}
              </button>
            </div>

            <div className="sidebar-section">
              <div className="section-header">
                <span className="section-title">プロジェクト</span>
                <button className="section-add" onClick={() => setShowProjectModal(true)} title="プロジェクト追加">+</button>
              </div>
              <div className="project-list">
                {/* ルートプロジェクト（parentId === null）のみ表示、アーカイブ除く */}
                {getSubProjects(null).map(project => (
                  <div key={project.id}>
                    <div className={'project-item' + (activeView === 'project' && selectedProjectId === project.id ? ' active' : '')}>
                      <button className="project-item-btn" onClick={() => { setActiveView('project'); setSelectedProjectId(project.id); }}>
                        <span className="project-dot" style={{ backgroundColor: project.color }}></span>
                        <span className="project-name">{project.name}</span>
                        <span className="project-count">{todos.filter(t => t.projectId === project.id && !t.completed).length}</span>
                      </button>
                      <button className="project-fav" onClick={(e) => { e.stopPropagation(); toggleProjectFavorite(project.id); }} title={project.isFavorite ? 'お気に入り解除' : 'お気に入り'}>{project.isFavorite ? '★' : '☆'}</button>
                      <button className="project-sub-add" onClick={(e) => { e.stopPropagation(); setNewProjectParentId(project.id); setShowProjectModal(true); }} title="サブプロジェクト追加">+</button>
                      <button className="project-delete" onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }} title="削除">×</button>
                    </div>
                    {/* サブプロジェクト */}
                    {getSubProjects(project.id).map(subProject => (
                      <div key={subProject.id} className={'project-item sub-project' + (activeView === 'project' && selectedProjectId === subProject.id ? ' active' : '')}>
                        <button className="project-item-btn" onClick={() => { setActiveView('project'); setSelectedProjectId(subProject.id); }}>
                          <span className="project-indent">└</span>
                          <span className="project-dot" style={{ backgroundColor: subProject.color }}></span>
                          <span className="project-name">{subProject.name}</span>
                          <span className="project-count">{todos.filter(t => t.projectId === subProject.id && !t.completed).length}</span>
                        </button>
                        <button className="project-fav" onClick={(e) => { e.stopPropagation(); toggleProjectFavorite(subProject.id); }} title={subProject.isFavorite ? 'お気に入り解除' : 'お気に入り'}>{subProject.isFavorite ? '★' : '☆'}</button>
                        <button className="project-delete" onClick={(e) => { e.stopPropagation(); deleteProject(subProject.id); }} title="削除">×</button>
                      </div>
                    ))}
                  </div>
                ))}
                {projects.filter(p => !p.isArchived).length === 0 && (
                  <div className="empty-projects">プロジェクトなし</div>
                )}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="section-header">
                <span className="section-title">ラベル</span>
              </div>
              <div className="label-list">
                {allLabels.map(label => (
                  <button key={label} className={'label-item' + (activeView === 'label' && selectedLabel === label ? ' active' : '')} onClick={() => {
                    if (activeView === 'label' && selectedLabel === label) {
                      setActiveView('inbox')
                      setSelectedLabel(null)
                      setLabelFilter(null)
                    } else {
                      setActiveView('label')
                      setSelectedLabel(label)
                      setLabelFilter(label)
                    }
                  }}>
                    <span className="label-dot"></span>
                    <span className="label-name">{label}</span>
                    <span className="label-count">{todos.filter(t => t.labels.includes(label) && !t.completed && !t.archived).length}</span>
                  </button>
                ))}
                {allLabels.length === 0 && (
                  <div className="empty-labels">ラベルなし</div>
                )}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="section-header">
                <span className="section-title">フィルター</span>
                <button className="section-add" onClick={() => setShowFilterModal(true)} title="フィルター追加">+</button>
              </div>
              <div className="filter-list">
                {customFilters.map(cf => (
                  <div key={cf.id} className={'filter-item' + (activeCustomFilter === cf.id ? ' active' : '')}>
                    <button className="filter-item-btn" onClick={() => applyCustomFilter(cf)}>
                      <span className="filter-icon">⚡</span>
                      <span className="filter-name">{cf.name}</span>
                    </button>
                    <button className="filter-delete" onClick={(e) => { e.stopPropagation(); deleteCustomFilter(cf.id); }} title="削除">×</button>
                  </div>
                ))}
              </div>
            </div>

            </div>
            <div className="sidebar-footer">
              <button className="sidebar-btn" onClick={() => setShowCalendar(true)} title="カレンダー">
                <span className="nav-icon">🗓️</span>
                <span className="nav-label">カレンダー</span>
              </button>
              <button className="sidebar-btn" onClick={() => setShowActivityModal(true)} title="アクティビティ">
                <span className="nav-icon">📊</span>
                <span className="nav-label">履歴</span>
              </button>
              <button className="sidebar-btn" onClick={() => setShowSettings(true)} title="設定">
                <span className="nav-icon">⚙️</span>
                <span className="nav-label">設定</span>
              </button>
              <button className="sidebar-btn" onClick={() => setShowHelp(true)} title="ヘルプ">
                <span className="nav-icon">❓</span>
                <span className="nav-label">ヘルプ</span>
              </button>
            </div>
          </>
        )}
      </aside>

      {/* メインコンテンツ */}
      <main className="main-content">
        <header className="content-header">
          <div className="header-top">
            <h2 className="view-title">{viewTitle}</h2>
            <div className="header-actions">
              <div className="view-mode-switcher">
                <button className={'view-mode-btn' + (viewMode === 'list' ? ' active' : '')} onClick={() => changeViewMode('list')} title="リスト">
                  <span className="view-icon">☰</span>
                </button>
                <button className={'view-mode-btn' + (viewMode === 'board' ? ' active' : '')} onClick={() => changeViewMode('board')} title="ボード">
                  <span className="view-icon">▦</span>
                </button>
              </div>
              <div className="filter-toggle">
                <button className={'toggle-btn' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>すべて</button>
                <button className={'toggle-btn' + (filter === 'active' ? ' active' : '')} onClick={() => setFilter('active')}>未完了</button>
                <button className={'toggle-btn' + (filter === 'completed' ? ' active' : '')} onClick={() => setFilter('completed')}>完了</button>
              </div>
            </div>
          </div>
          {/* 期間タブ: インボックスまたはラベルビューで表示 */}
          {(activeView === 'inbox' || activeView === 'label') && (
            <div className="timeframe-tabs">
              <button className={'timeframe-tab' + (currentTimeframe === 'today' ? ' active' : '')} onClick={() => setCurrentTimeframe('today')}>
                今日
              </button>
              <button className={'timeframe-tab' + (currentTimeframe === 'week' ? ' active' : '')} onClick={() => setCurrentTimeframe('week')}>
                1週間
              </button>
              <button className={'timeframe-tab' + (currentTimeframe === 'month' ? ' active' : '')} onClick={() => setCurrentTimeframe('month')}>
                1ヶ月
              </button>
              <button className={'timeframe-tab completed-tab' + (currentTimeframe === 'completed' ? ' active' : '')} onClick={() => setCurrentTimeframe('completed')}>
                完了
              </button>
              <div className="plan-tab-separator" />
              <button className={'timeframe-tab plan-tab' + (currentTimeframe === 'plan' ? ' active' : '')} onClick={() => setCurrentTimeframe('plan')}>
                計画
              </button>
              {todos.some(t => t.archived) && (
                <button className={'timeframe-tab archived-tab' + (currentTimeframe === 'archived' ? ' active' : '')} onClick={() => setCurrentTimeframe('archived')}>
                  アーカイブ
                </button>
              )}
            </div>
          )}
        </header>

        {/* クイック追加（計画タブ以外で表示） */}
        {currentTimeframe !== 'plan' && (
          <div className="quick-add">
            <button className="quick-add-icon">+</button>
            <textarea
              ref={inputRef}
              className={'quick-add-input' + (isAddingTodo ? ' loading' : '') + (decomposeError ? ' has-error' : '')}
              placeholder={isAddingTodo ? '追加中...' : 'タスクを追加 (例: 明日 買い物 #仕事 P1) Ctrl+Enterで送信'}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                if (decomposeError) setDecomposeError('')
                // 高さを自動調整
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.ctrlKey && !isAddingTodo) {
                  e.preventDefault()
                  addTodo()
                }
              }}
              disabled={isAddingTodo}
              rows={1}
            />
            {decomposeError && <span className="quick-add-error">{decomposeError}</span>}
            {input.trim() && !decomposeError && (
              <button className="quick-add-submit" onClick={addTodo} disabled={isAddingTodo}>
                追加
              </button>
            )}
          </div>
        )}

        {/* 計画ビュー */}
        {currentTimeframe === 'plan' && (
          <div className="plan-view">
            <div className="plan-input-section">
              <h3>目標を入力</h3>
              <p className="plan-description">達成したい目標を自由に書いてください。AIが具体的なタスクとスケジュールを提案します。</p>
              <p className="plan-description">※達成したい日を自然言語で明示してください（例: 2025年6月30日/来月末/3ヶ月後）。未指定の場合は生成できません。</p>
              <div className="plan-input-wrapper">
                <textarea
                  className="plan-goal-input"
                  placeholder="例：2025年6月30日までにTOEIC 800点を取る、来月末までにポートフォリオサイトを作る、3ヶ月後までに引越しの準備をする（Ctrl+Enterで生成）"
                  value={planGoal}
                  onChange={e => {
                    setPlanGoal(e.target.value)
                    setPlanError('')
                    // 高さを自動調整
                    e.target.style.height = 'auto'
                    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
                  }}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && e.ctrlKey && !isGeneratingPlan) {
                      e.preventDefault()
                      // 事前にAPIキーをチェック
                      if (!hasAnyAiApiKey()) {
                        window.alert('AI APIキーが設定されていません。\n設定画面でOpenAI、Claude、Geminiのいずれかのキーを入力してください。')
                        return
                      }
                      const trimmedGoal = planGoal.trim()
                      if (!trimmedGoal) {
                        setPlanError('目標を入力してください')
                        return
                      }
                      setIsGeneratingPlan(true)
                      setPlanError('')
                      try {
                        let webContext: string | undefined
                        console.log('[計画生成] Tavilyキー確認中...')
                        if (getTavilyApiKey()) {
                          console.log('[計画生成] Web検索を実行:', trimmedGoal)
                          const searchResult = await searchWithTavily(trimmedGoal)
                          if (searchResult) {
                            console.log('[計画生成] 検索結果をプロンプトに追加')
                            webContext = formatSearchResultsForPrompt(searchResult)
                          } else {
                            console.log('[計画生成] 検索結果なし')
                          }
                        } else {
                          console.log('[計画生成] Tavilyキーなし、Web検索スキップ')
                        }
                        console.log('[計画生成] AI計画生成開始', webContext ? '(Web情報あり)' : '(Web情報なし)')
                        const result = await generatePlan(trimmedGoal, webContext)
                        setPlanResult(result)
                        setPlanTasks(result.tasks)
                      } catch (err) {
                        const message = err instanceof Error ? err.message : '計画の生成に失敗しました'
                        if (message.includes('APIキーが設定されていません')) {
                          window.alert(message)
                        } else {
                          setPlanError(message)
                        }
                      } finally {
                        setIsGeneratingPlan(false)
                      }
                    }
                  }}
                  rows={3}
                />
                <button
                  className="plan-generate-btn"
                  onClick={async () => {
                    // 事前にAPIキーをチェック
                    if (!hasAnyAiApiKey()) {
                      window.alert('AI APIキーが設定されていません。\n設定画面でOpenAI、Claude、Geminiのいずれかのキーを入力してください。')
                      return
                    }
                    const trimmedGoal = planGoal.trim()
                    if (!trimmedGoal) {
                      setPlanError('目標を入力してください')
                      return
                    }
                    setIsGeneratingPlan(true)
                    setPlanError('')
                    try {
                      let webContext: string | undefined
                      console.log('[計画生成] Tavilyキー確認中...')
                      if (getTavilyApiKey()) {
                        console.log('[計画生成] Web検索を実行:', trimmedGoal)
                        const searchResult = await searchWithTavily(trimmedGoal)
                        if (searchResult) {
                          console.log('[計画生成] 検索結果をプロンプトに追加')
                          webContext = formatSearchResultsForPrompt(searchResult)
                        } else {
                          console.log('[計画生成] 検索結果なし')
                        }
                      } else {
                        console.log('[計画生成] Tavilyキーなし、Web検索スキップ')
                      }
                      console.log('[計画生成] AI計画生成開始', webContext ? '(Web情報あり)' : '(Web情報なし)')
                      const result = await generatePlan(trimmedGoal, webContext)
                      setPlanResult(result)
                      setPlanTasks(result.tasks)
                    } catch (err) {
                      const message = err instanceof Error ? err.message : '計画の生成に失敗しました'
                      if (message.includes('APIキーが設定されていません')) {
                        window.alert(message)
                      } else {
                        setPlanError(message)
                      }
                    } finally {
                      setIsGeneratingPlan(false)
                    }
                  }}
                  disabled={isGeneratingPlan || !planGoal.trim()}
                >
                  {isGeneratingPlan ? (getTavilyApiKey() ? '検索・生成中...' : '生成中...') : '計画を生成'}
                </button>
              </div>
              {planError && <p className="plan-error">{planError}</p>}
            </div>

            {isGeneratingPlan && (
              <div className="plan-loading">
                <div className="plan-loading-spinner"></div>
                <p>AIが計画を生成しています...</p>
                <p className="plan-loading-hint">目標を分析してタスクとスケジュールを作成中です</p>
              </div>
            )}

            {!isGeneratingPlan && planResult && (
              <div className="plan-result-section">
                {/* 現在地点・目標・ギャップ分析 */}
                {(planResult.currentState || planResult.goalState || planResult.gap) && (
                  <div className="plan-analysis">
                    {planResult.currentState && (
                      <div className="plan-analysis-item">
                        <h4>現在地点</h4>
                        <p>{planResult.currentState}</p>
                      </div>
                    )}
                    {planResult.goalState && (
                      <div className="plan-analysis-item">
                        <h4>到達目標</h4>
                        <p>{planResult.goalState}</p>
                      </div>
                    )}
                    {planResult.gap && (
                      <div className="plan-analysis-item">
                        <h4>ギャップ分析</h4>
                        <p>{planResult.gap}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 達成可能性チェック */}
                {planResult.feasibility && (
                  <div className={'plan-feasibility verdict-' + planResult.feasibility.verdict.toLowerCase()}>
                    <h4>
                      達成可能性:
                      <span className="feasibility-verdict">
                        {planResult.feasibility.verdict === 'FEASIBLE' ? '達成可能' :
                         planResult.feasibility.verdict === 'CHALLENGING' ? '困難だが可能' : '現実的に不可能'}
                      </span>
                    </h4>
                    <div className="feasibility-details">
                      <div className="feasibility-hours">
                        <span>利用可能時間: <strong>{planResult.feasibility.availableHours}時間</strong></span>
                        <span>必要時間: <strong>{planResult.feasibility.requiredHours}時間</strong></span>
                      </div>
                      <p className="feasibility-calculation">{planResult.feasibility.calculation}</p>
                      {planResult.feasibility.adjustment && (
                        <p className="feasibility-adjustment">調整案: {planResult.feasibility.adjustment}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="plan-summary">
                  <h3>計画概要</h3>
                  <p>{planResult.summary}</p>
                  <div className="plan-duration-row">
                    <span className="plan-duration">推定所要日数: <strong>{planResult.estimatedDays}日</strong></span>
                  </div>
                </div>

                {/* リスク・コスト */}
                {(planResult.risks && planResult.risks.length > 0) || (planResult.costs && planResult.costs.length > 0) ? (
                  <div className="plan-risks-costs">
                    {planResult.risks && planResult.risks.length > 0 && (
                      <div className="plan-risks">
                        <h4>想定リスク</h4>
                        <ul>
                          {planResult.risks.map((risk, i) => (
                            <li key={i}>{risk}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {planResult.costs && planResult.costs.length > 0 && (
                      <div className="plan-costs">
                        <h4>必要コスト</h4>
                        <ul>
                          {planResult.costs.map((cost, i) => (
                            <li key={i}>{cost}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* 推奨リソース */}
                {planResult.resources && planResult.resources.length > 0 && (
                  <div className="plan-resources">
                    <h4>推奨リソース</h4>
                    <div className="plan-resources-list">
                      {planResult.resources.map((resource, i) => (
                        <div key={i} className={'plan-resource-item resource-type-' + resource.type}>
                          <div className="resource-header">
                            <span className="resource-type-badge">
                              {resource.type === 'book' ? '書籍' :
                               resource.type === 'website' ? 'Web' :
                               resource.type === 'tool' ? 'ツール' :
                               resource.type === 'service' ? 'サービス' : 'コミュニティ'}
                            </span>
                            <span className="resource-name">{resource.name}</span>
                            <span className="resource-cost">{resource.cost}</span>
                          </div>
                          <p className="resource-description">{resource.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {planResult.tips && planResult.tips.length > 0 && (
                  <div className="plan-tips">
                    <h4>達成のヒント</h4>
                    <ul>
                      {planResult.tips.map((tip, i) => (
                        <li key={i}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="plan-tasks-section">
                  <div className="plan-tasks-header">
                    <h3>おすすめタスク</h3>
                    <div className="plan-tasks-actions">
                      <button
                        className="plan-select-all-btn"
                        onClick={() => setPlanTasks(planTasks.map(t => ({ ...t, selected: true })))}
                      >
                        全て選択
                      </button>
                      <button
                        className="plan-deselect-all-btn"
                        onClick={() => setPlanTasks(planTasks.map(t => ({ ...t, selected: false })))}
                      >
                        全て解除
                      </button>
                    </div>
                  </div>

                  <ul className="plan-task-list">
                    {planTasks.map((task, index) => {
                      const dueDate = new Date()
                      dueDate.setDate(dueDate.getDate() + task.daysFromStart)

                      return (
                        <li key={index} className={'plan-task-item' + (task.selected ? ' selected' : '')}>
                          <div className="plan-task-checkbox">
                            <input
                              type="checkbox"
                              checked={task.selected}
                              onChange={e => {
                                const newTasks = [...planTasks]
                                newTasks[index] = { ...task, selected: e.target.checked }
                                setPlanTasks(newTasks)
                              }}
                            />
                          </div>
                          <div className="plan-task-content">
                            {editingPlanTaskIndex === index ? (
                              <input
                                type="text"
                                className="plan-task-edit-input"
                                value={editingPlanTaskTitle}
                                onChange={e => setEditingPlanTaskTitle(e.target.value)}
                                onBlur={() => {
                                  if (editingPlanTaskTitle.trim()) {
                                    const newTasks = [...planTasks]
                                    newTasks[index] = { ...task, title: editingPlanTaskTitle.trim() }
                                    setPlanTasks(newTasks)
                                  }
                                  setEditingPlanTaskIndex(null)
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    if (editingPlanTaskTitle.trim()) {
                                      const newTasks = [...planTasks]
                                      newTasks[index] = { ...task, title: editingPlanTaskTitle.trim() }
                                      setPlanTasks(newTasks)
                                    }
                                    setEditingPlanTaskIndex(null)
                                  } else if (e.key === 'Escape') {
                                    setEditingPlanTaskIndex(null)
                                  }
                                }}
                                autoFocus
                              />
                            ) : (
                              <span
                                className="plan-task-title"
                                onClick={() => {
                                  setEditingPlanTaskIndex(index)
                                  setEditingPlanTaskTitle(task.title)
                                }}
                              >
                                {task.title}
                              </span>
                            )}
                            <span className="plan-task-description">{task.description}</span>
                          </div>
                          <div className="plan-task-meta">
                            <span className={'plan-task-priority priority-' + task.priority}>
                              {task.priority === 'high' ? 'P1' : task.priority === 'medium' ? 'P2' : 'P3'}
                            </span>
                            <span className="plan-task-due">
                              {dueDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                            </span>
                            {task.estimatedMinutes && (
                              <span className="plan-task-duration">{task.estimatedMinutes}分</span>
                            )}
                          </div>
                          <button
                            className="plan-task-delete-btn"
                            onClick={() => setPlanTasks(planTasks.filter((_, i) => i !== index))}
                          >
                            ×
                          </button>
                        </li>
                      )
                    })}
                  </ul>

                  <div className="plan-add-tasks-section">
                    <div className="plan-options-row">
                      <div className="plan-label-input-wrapper">
                        <label className="plan-label-label">共通ラベル <span className="required">*</span></label>
                        <div className={'plan-label-input-row' + (!planLabel.trim() ? ' required-field' : '')}>
                          <span className="plan-label-prefix">#</span>
                          <input
                            type="text"
                            className="plan-label-input"
                            placeholder="例: TOEIC勉強（必須）"
                            value={planLabel}
                            onChange={e => { setPlanLabel(e.target.value.replace(/^#/, '')); setPlanError('') }}
                          />
                        </div>
                      </div>
                      <div className="plan-project-select-wrapper">
                        <label className="plan-label-label">プロジェクト <span className="required">*</span></label>
                        <select
                          className={'plan-project-select' + (!planProjectId ? ' required-field' : '')}
                          value={planProjectId || ''}
                          onChange={e => { setPlanProjectId(e.target.value || null); setPlanError('') }}
                        >
                          <option value="">選択してください（必須）</option>
                          {projects.filter(p => !p.isArchived).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <span className="plan-label-hint">追加するタスク全てにラベルとプロジェクトが設定されます</span>
                    <button
                      className="plan-add-tasks-btn"
                      onClick={() => {
                        if (!planLabel.trim()) {
                          setPlanError('共通ラベルを入力してください')
                          return
                        }
                        if (!planProjectId) {
                          setPlanError('プロジェクトを選択してください')
                          return
                        }
                        const selectedTasks = planTasks.filter(t => t.selected)
                        if (selectedTasks.length === 0) {
                          setPlanError('追加するタスクを選択してください')
                          return
                        }

                        const today = new Date()
                        today.setHours(0, 0, 0, 0)

                        const taskLabels = [planLabel.trim()]

                        const newTodos: Todo[] = selectedTasks.map((task, index) => {
                          const dueDate = new Date(today)
                          dueDate.setDate(dueDate.getDate() + task.daysFromStart)

                          const priority: Priority = task.priority === 'high' ? 1 : task.priority === 'medium' ? 2 : 3
                          const timeframe: Timeframe = task.daysFromStart === 0 ? 'today' : task.daysFromStart <= 7 ? 'week' : 'month'

                          return {
                            id: Date.now().toString() + Math.random().toString(36).slice(2) + index,
                            text: task.title,
                            completed: false,
                            createdAt: Date.now() + index,
                            parentId: null,
                            priority,
                            reminder: null,
                            reminderSent: false,
                            weeklyReminder: null,
                            followUpCount: 0,
                            lastNotifiedAt: null,
                            timeframe,
                            dueDate: dueDate.getTime(),
                            dueDateNotified: false,
                            labels: taskLabels,
                            recurrence: null,
                            description: task.description,
                            sectionId: null,
                            order: todos.length + index,
                            estimatedMinutes: task.estimatedMinutes || null,
                            comments: [],
                            projectId: planProjectId,
                            karmaAwarded: false,
                            archived: false,
                            archivedAt: null,
                          }
                        })
                        updateTodosWithHistory(prev => [...prev, ...newTodos])

                        setPlanResult(null)
                        setPlanTasks([])
                        setPlanGoal('')
                        setPlanLabel('')
                        setPlanProjectId(null)
                        setCurrentTimeframe('today')
                      }}
                      disabled={planTasks.filter(t => t.selected).length === 0}
                    >
                      選択したタスクを追加 ({planTasks.filter(t => t.selected).length}件)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ボードビュー */}
        {viewMode === 'board' && (
          <div className="board-view">
            <div className="board-column">
              <div className="board-column-header">
                <h3>未着手</h3>
                <span className="board-column-count">{displayTodos.filter(t => !t.completed && t.parentId === null).length}</span>
              </div>
              <div className="board-column-tasks">
                {displayTodos.filter(t => !t.completed && t.parentId === null).map(todo => (
                  <div key={todo.id} className={'board-task priority-' + priorityColor(todo.priority)}>
                    <div className="board-task-header">
                      <button className="checkbox-small" onClick={() => toggleTodo(todo.id)}></button>
                      <span className={'priority-dot priority-' + priorityColor(todo.priority)}></span>
                    </div>
                    <div className="board-task-title">{todo.text}</div>
                    {todo.dueDate && (
                      <div className={'board-task-due' + (isDueDateOverdue(todo.dueDate) ? ' overdue' : '')}>
                        📅 {formatDueDate(todo.dueDate)}
                      </div>
                    )}
                    {todo.labels && todo.labels.length > 0 && (
                      <div className="board-task-labels">
                        {todo.labels.map((label, i) => (
                          <span key={i} className="label-badge-small">#{label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="board-column completed-column">
              <div className="board-column-header">
                <h3>完了</h3>
                <span className="board-column-count">{displayTodos.filter(t => t.completed && t.parentId === null).length}</span>
              </div>
              <div className="board-column-tasks">
                {displayTodos.filter(t => t.completed && t.parentId === null).map(todo => (
                  <div key={todo.id} className="board-task completed">
                    <div className="board-task-header">
                      <button className="checkbox-small checked" onClick={() => toggleTodo(todo.id)}>✓</button>
                    </div>
                    <div className="board-task-title">{todo.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Upcomingビュー */}
        {viewMode === 'upcoming' && (
          <div className="upcoming-view">
            {(() => {
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              const days = Array.from({ length: 7 }, (_, i) => {
                const date = new Date(today)
                date.setDate(date.getDate() + i)
                return date
              })
              const dayNames = ['日', '月', '火', '水', '木', '金', '土']

              return days.map((date, index) => {
                const dayStart = date.getTime()
                const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1
                const dayTodos = todos.filter(t =>
                  t.dueDate && t.dueDate >= dayStart && t.dueDate <= dayEnd && !t.completed && t.parentId === null
                )
                const isToday = index === 0

                return (
                  <div key={index} className={'upcoming-day' + (isToday ? ' today' : '')}>
                    <div className="upcoming-day-header">
                      <span className="upcoming-day-name">
                        {isToday ? '今日' : index === 1 ? '明日' : `${date.getMonth() + 1}/${date.getDate()}`}
                      </span>
                      <span className="upcoming-day-weekday">{dayNames[date.getDay()]}曜日</span>
                      <span className="upcoming-day-count">{dayTodos.length}件</span>
                    </div>
                    <div className="upcoming-day-tasks">
                      {dayTodos.length === 0 ? (
                        <div className="upcoming-empty">予定なし</div>
                      ) : (
                        dayTodos.map(todo => (
                          <div key={todo.id} className={'upcoming-task priority-' + priorityColor(todo.priority)}>
                            <button className="checkbox-small" onClick={() => toggleTodo(todo.id)}></button>
                            <span className={'priority-dot priority-' + priorityColor(todo.priority)}></span>
                            <span className="upcoming-task-text">{todo.text}</span>
                            {todo.labels && todo.labels.length > 0 && (
                              <span className="upcoming-task-labels">
                                {todo.labels.map((label, i) => (
                                  <span key={i} className="label-badge-small">#{label}</span>
                                ))}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        )}

        {/* リストビュー */}
        {viewMode === 'list' && (
        <>
          {/* 複数選択の操作バー */}
          <div className="selection-toolbar">
            <button
              className={'selection-mode-btn' + (selectionMode ? ' active' : '')}
              onClick={toggleSelectionMode}
              title={selectionMode ? '選択モードを終了' : '複数選択モード'}
            >
              ☑ {selectionMode ? '選択終了' : '複数選択'}
            </button>
            {selectionMode && (
              <>
                <button className="selection-action-btn" onClick={selectAllVisibleTodos} title="すべて選択">
                  すべて選択
                </button>
                <button className="selection-action-btn" onClick={clearSelection} title="選択解除">
                  選択解除
                </button>
                <span className="selection-count">{selectedTodoIds.size}件選択中</span>
                {selectedTodoIds.size > 0 && (
                  <>
                    <button className="selection-action-btn" onClick={toggleSelectedTodosCompletion} title="完了/未完了を切り替え">
                      ✓ 完了切替
                    </button>
                    <button className="selection-action-btn priority-high" onClick={() => setSelectedTodosPriority(1)} title="優先度：P1（最高）">
                      P1
                    </button>
                    <button className="selection-action-btn priority-medium" onClick={() => setSelectedTodosPriority(2)} title="優先度：P2">
                      P2
                    </button>
                    <button className="selection-action-btn priority-medium" onClick={() => setSelectedTodosPriority(3)} title="優先度：P3">
                      P3
                    </button>
                    <button className="selection-action-btn priority-low" onClick={() => setSelectedTodosPriority(4)} title="優先度：P4（最低）">
                      P4
                    </button>
                    <button className="selection-action-btn danger" onClick={requestDeleteSelectedTodos} title="選択したタスクを削除">
                      🗑 削除
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <ul className="todo-list">
          {/* Demo task for intro */}
          {showIntro && (
            <li className="todo-item demo-task">
              <button className="checkbox"></button>
              <button className="priority-badge priority-medium">中</button>
              <button className="timeframe-badge timeframe-today">今日</button>
              <button className="due-date-btn">📅</button>
              <span className="todo-text">買い物に行く</span>
              <button className="edit-btn">✎</button>
              <button className="reminder-btn">🔔</button>
              <button className="ai-btn">✨</button>
              <button className="delete-btn">×</button>
            </li>
          )}
          {displayTodos.length === 0 && !showIntro && currentTimeframe !== 'plan' ? (
            <li className="empty-state">
              <div className="empty-icon">{filter === 'completed' ? '✓' : '○'}</div>
              <div className="empty-title">
                {filter === 'all' ? 'タスクがありません' : filter === 'active' ? 'すべて完了！' : 'まだ完了したタスクはありません'}
              </div>
              <div className="empty-hint">
                {filter === 'all' ? 'nキーで新しいタスクを追加' : filter === 'active' ? '素晴らしい！今日もお疲れさまでした' : 'タスクを完了するとここに表示されます'}
              </div>
            </li>
          ) : currentTimeframe === 'plan' ? null : buildTree(null).filter(t => !isHidden(t)).map(todo => {
            const depth = getDepth(todo)
            const hasChild = hasChildren(todo.id)
            const isCollapsed = collapsed.has(todo.id)
            return (
              <li
                key={todo.id}
                className={'todo-item ' + (todo.completed ? 'completed' : '') + (depth > 0 ? ' child depth-' + depth : '') + (draggedTodoId === todo.id ? ' dragging' : '')}
                draggable={depth === 0}
                onDragStart={() => handleDragStart(todo.id)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(todo.id)}
                onDragEnd={handleDragEnd}
              >
                {selectionMode && todo.parentId === null && (
                  <input
                    type="checkbox"
                    className="selection-checkbox"
                    checked={selectedTodoIds.has(todo.id)}
                    onChange={() => toggleTodoSelection(todo.id)}
                  />
                )}
                {hasChild && (
                  <button className="collapse-btn" onClick={() => toggleCollapse(todo.id)} title={isCollapsed ? '展開' : '折りたたむ'}>
                    {isCollapsed ? '▶' : '▼'}
                  </button>
                )}
                <button className="checkbox" onClick={() => toggleTodo(todo.id)}>{todo.completed ? '✓' : ''}</button>
                <button className={'priority-badge priority-' + priorityColor(todo.priority)} onClick={() => cyclePriority(todo.id)} title="優先度を変更">{priorityLabel(todo.priority)}</button>
                {todo.parentId === null && (
                  <button className={'timeframe-badge timeframe-' + todo.timeframe} onClick={() => cycleTimeframe(todo.id)} title="期間を変更">{timeframeLabel(todo.timeframe)}</button>
                )}
                {todo.parentId === null && (
                  <button className={'due-date-btn' + (todo.dueDate ? (isDueDateOverdue(todo.dueDate) && !todo.completed ? ' overdue' : ' has-due-date') : '')} onClick={() => openDueDateModal(todo.id)} title={todo.dueDate ? `期日: ${formatDueDate(todo.dueDate)}` : '期日を設定'}>
                    📅{todo.dueDate && <span className="due-date-text">{formatDueDate(todo.dueDate)}</span>}
                  </button>
                )}
                {editingId === todo.id ? (
                  <input type="text" className="edit-input" value={editText} onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                    onBlur={saveEdit} autoFocus />
                ) : (
                  <span className="todo-text" onDoubleClick={() => startEdit(todo)}>
                    {todo.text}
                    {todo.recurrence && <span className="recurrence-badge" title={formatRecurrence(todo.recurrence)}>🔄</span>}
                  </span>
                )}
                <div className="labels-inline">
                  {todo.labels && todo.labels.map((label, i) => (
                    <span key={i} className="label-tag">
                      <span className="label-text" onClick={(e) => { e.stopPropagation(); setLabelFilter(label); }}>#{label}</span>
                      <button className="label-remove" onClick={(e) => { e.stopPropagation(); removeLabelFromTodo(todo.id, label); }} title="ラベルを削除">×</button>
                    </span>
                  ))}
                  <button className="label-add-btn" onClick={() => openLabelModal(todo.id)} title="ラベルを追加">+</button>
                </div>
                <button className="edit-btn" onClick={() => startEdit(todo)} title="編集">✎</button>
                <button className={'note-btn' + (todo.description ? ' has-note' : '')} onClick={() => startEditDescription(todo)} title={todo.description || 'ノートを追加'}>
                  📝
                </button>
                <button className={'duration-btn' + (todo.estimatedMinutes ? ' has-duration' : '')} onClick={() => openDurationModal(todo.id)} title={todo.estimatedMinutes ? formatDuration(todo.estimatedMinutes) : '所要時間を設定'}>
                  ⏱️{todo.estimatedMinutes && <span className="duration-text">{formatDuration(todo.estimatedMinutes)}</span>}
                </button>
                <button className={'comment-btn' + (todo.comments.length > 0 ? ' has-comments' : '')} onClick={() => openCommentModal(todo.id)} title={todo.comments.length > 0 ? `${todo.comments.length}件のコメント` : 'コメントを追加'}>
                  💬{todo.comments.length > 0 && <span className="comment-count">{todo.comments.length}</span>}
                </button>
                <button className={'reminder-btn' + (todo.reminder || todo.weeklyReminder ? ' has-reminder' : '')} onClick={() => openReminderModal(todo.id)} title={todo.weeklyReminder ? formatWeeklyReminder(todo.weeklyReminder) : todo.reminder ? formatReminder(todo.reminder) : 'リマインダー設定'}>
                  🔔{todo.weeklyReminder && <span className="reminder-time">{formatWeeklyReminder(todo.weeklyReminder)}</span>}
                  {todo.reminder && !todo.weeklyReminder && <span className="reminder-time">{formatReminder(todo.reminder)}</span>}
                </button>
                <button className={'ai-btn' + (decomposing === todo.id ? ' decomposing' : '')} onClick={() => handleDecompose(todo)} disabled={decomposing === todo.id || todo.completed} title={decomposing === todo.id ? '検索・分解中...' : 'AIで分解'}>
                  {decomposing === todo.id ? '🔄' : '✨'}
                </button>
                <button className="delete-btn" onClick={() => requestDeleteTodo(todo.id)}>×</button>
              </li>
            )
          })}
        </ul>
        </>
        )}

        {completedCount > 0 && <button className="clear-btn archive-btn" onClick={archiveCompleted}>完了したタスクをアーカイブ ({completedCount})</button>}
      </main>

      <footer className="footer"></footer>

      {showSettings && (
        <div className="modal-overlay">
          <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2>設定</h2>
              <button className="modal-close-btn" onClick={() => setShowSettings(false)} title="閉じる">×</button>
            </div>
            <div className="settings-modal-content">
              <p className="settings-intro-text">
                タスク分解・計画生成・AIリマインダーなど、主要機能はAIで動作します。<br />
                <strong>APIキーを設定</strong>してください（OpenAI / Claude / Gemini対応）。
              </p>
              <div className="settings-section">
                <KanaeReminderSettings
                  onSaved={syncKanaeReminderService}
                  embedded={true}
                  saveRef={kanaeSettingsSaveRef}
                />
              </div>
              <div className="settings-section">
                <h3>通知テスト</h3>
                <p className="modal-description">通知が正しく動作するかテストします。</p>
                <button className="modal-btn secondary" onClick={() => {
                  showNotification('テスト通知', '通知が正常に動作しています！')
                }}>通知をテスト</button>
              </div>
              <div className="settings-section">
                <h3>バックアップ</h3>
                <p className="modal-description">データはC:/CalmTodoBackupに自動保存されます。手動で保存・復元もできます。</p>
                <div className="export-import-btns">
                  <button className="modal-btn secondary" onClick={saveBackupManual}>バックアップを保存</button>
                  <button className="modal-btn secondary" onClick={restoreFromBackupWithDialog}>バックアップから復元</button>
                </div>
              </div>
              <div className="settings-section">
                <h3>削除確認</h3>
                <p className="modal-description">タスク削除時に確認ダイアログを表示します。</p>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={!confirmDeleteDisabled}
                    onChange={(e) => {
                      const enabled = e.target.checked
                      setConfirmDeleteDisabled(!enabled)
                      if (enabled) {
                        localStorage.removeItem('calm-todo-skip-delete-confirm')
                      } else {
                        localStorage.setItem('calm-todo-skip-delete-confirm', 'true')
                      }
                    }}
                  />
                  削除時に確認する
                </label>
              </div>
            </div>
            <div className="settings-modal-footer">
              <button className="modal-btn primary" onClick={handleSaveSettings}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {showDeleteConfirm && deleteTargetId && (
        <div className="modal-overlay" onClick={cancelTodoDelete}>
          <div className="modal delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <h2>タスクを削除</h2>
            <p className="modal-description">
              「{todos.find(t => t.id === deleteTargetId)?.text}」を削除しますか？
              {todos.some(t => t.parentId === deleteTargetId) && (
                <><br /><span className="delete-warning">サブタスクも一緒に削除されます</span></>
              )}
            </p>
            <div className="modal-actions delete-confirm-actions">
              <button className="modal-btn secondary" onClick={cancelTodoDelete}>キャンセル</button>
              <button className="modal-btn danger" onClick={() => confirmTodoDelete(false)}>削除</button>
            </div>
            <button className="skip-confirm-btn" onClick={() => confirmTodoDelete(true)}>
              削除して、今後は確認しない
            </button>
          </div>
        </div>
      )}

      {/* 一括削除確認モーダル */}
      {showBulkDeleteConfirm && (
        <div className="modal-overlay" onClick={cancelBulkDelete}>
          <div className="modal delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <h2>複数タスクを削除</h2>
            <p className="modal-description">
              選択した{selectedTodoIds.size}件のタスクを削除しますか？
              <br /><span className="delete-warning">サブタスクも一緒に削除されます</span>
            </p>
            <div className="modal-actions delete-confirm-actions">
              <button className="modal-btn secondary" onClick={cancelBulkDelete}>キャンセル</button>
              <button className="modal-btn danger" onClick={executeDeleteSelectedTodos}>削除</button>
            </div>
          </div>
        </div>
      )}

      {/* 説明/ノート編集モーダル */}
      {editingDescription && (
        <div className="modal-overlay" onClick={cancelEditDescription}>
          <div className="modal note-modal" onClick={e => e.stopPropagation()}>
            <h2>ノート</h2>
            <p className="modal-description">タスクの詳細やメモを追加できます</p>
            <textarea 
              className="note-textarea" 
              placeholder="ノートを入力..." 
              value={descriptionText}
              onChange={e => setDescriptionText(e.target.value)}
              autoFocus
              rows={6}
            />
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={cancelEditDescription}>キャンセル</button>
              <button className="modal-btn primary" onClick={saveDescription}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* セクション追加モーダル */}
      {showSectionModal && (
        <div className="modal-overlay" onClick={() => setShowSectionModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>新しいセクション</h2>
            <input type="text" className="api-key-input" placeholder="セクション名..." value={newSectionName}
              onChange={e => setNewSectionName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSection()} autoFocus />
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowSectionModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={addSection} disabled={!newSectionName.trim()}>作成</button>
            </div>
          </div>
        </div>
      )}

      {/* ラベル追加モーダル */}
      {showLabelModal && labelTodoId && (
        <div className="modal-overlay" onClick={closeLabelModal}>
          <div className="modal label-modal" onClick={e => e.stopPropagation()}>
            <h2>ラベルを追加</h2>
            <p className="modal-description">タスクにラベルを追加して整理できます</p>
            <div className="label-input-row">
              <input
                type="text"
                className="label-input"
                placeholder="ラベル名を入力..."
                value={newLabelInput}
                onChange={e => setNewLabelInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addLabelToTodo(); }}
                autoFocus
              />
              <button className="modal-btn primary" onClick={addLabelToTodo} disabled={!newLabelInput.trim()}>追加</button>
            </div>
            {allLabels.length > 0 && (
              <div className="existing-labels">
                <p className="existing-labels-title">既存のラベル:</p>
                <div className="existing-labels-list">
                  {allLabels.filter(l => !todos.find(t => t.id === labelTodoId)?.labels.includes(l)).map(label => (
                    <button key={label} className="existing-label-btn" onClick={() => {
                      if (!labelTodoId) return
                      updateTodosWithHistory(prev => prev.map(t => {
                        if (t.id !== labelTodoId) return t
                        if (t.labels.includes(label)) return t
                        return { ...t, labels: [...t.labels, label] }
                      }))
                    }}>
                      #{label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="current-labels">
              <p className="current-labels-title">このタスクのラベル:</p>
              <div className="current-labels-list">
                {todos.find(t => t.id === labelTodoId)?.labels.map((label, i) => (
                  <span key={i} className="current-label-tag">
                    #{label}
                    <button className="current-label-remove" onClick={() => removeLabelFromTodo(labelTodoId, label)}>×</button>
                  </span>
                ))}
                {todos.find(t => t.id === labelTodoId)?.labels.length === 0 && (
                  <span className="no-labels">ラベルがありません</span>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={closeLabelModal}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {showFilterModal && (
        <div className="modal-overlay" onClick={() => setShowFilterModal(false)}>
          <div className="modal filter-modal" onClick={e => e.stopPropagation()}>
            <h2>カスタムフィルターを作成</h2>
            <p className="modal-description">条件を組み合わせてフィルターを作成できます</p>

            <div className="filter-form">
              <div className="filter-field">
                <label>フィルター名</label>
                <input type="text" className="api-key-input" placeholder="例: 今日の緊急タスク" value={newFilterName}
                  onChange={e => setNewFilterName(e.target.value)} autoFocus />
              </div>

              <div className="filter-field">
                <label>優先度</label>
                <div className="filter-options">
                  <button className={'filter-option-btn' + (newFilterPriority === null ? ' active' : '')} onClick={() => setNewFilterPriority(null)}>すべて</button>
                  <button className={'filter-option-btn priority-p1' + (newFilterPriority === 1 ? ' active' : '')} onClick={() => setNewFilterPriority(1)}>P1</button>
                  <button className={'filter-option-btn priority-p2' + (newFilterPriority === 2 ? ' active' : '')} onClick={() => setNewFilterPriority(2)}>P2</button>
                  <button className={'filter-option-btn priority-p3' + (newFilterPriority === 3 ? ' active' : '')} onClick={() => setNewFilterPriority(3)}>P3</button>
                  <button className={'filter-option-btn priority-p4' + (newFilterPriority === 4 ? ' active' : '')} onClick={() => setNewFilterPriority(4)}>P4</button>
                </div>
              </div>

              {allLabels.length > 0 && (
                <div className="filter-field">
                  <label>ラベル</label>
                  <div className="filter-options">
                    {allLabels.map(label => (
                      <button key={label} className={'filter-option-btn' + (newFilterLabels.includes(label) ? ' active' : '')}
                        onClick={() => setNewFilterLabels(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label])}>
                        #{label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="filter-field">
                <label>その他の条件</label>
                <div className="filter-options">
                  <button className={'filter-option-btn' + (newFilterOverdue ? ' active' : '')} onClick={() => setNewFilterOverdue(p => !p)}>期日超過</button>
                  <button className={'filter-option-btn' + (newFilterHasRecurrence ? ' active' : '')} onClick={() => setNewFilterHasRecurrence(p => !p)}>繰り返しタスク</button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowFilterModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={addCustomFilter} disabled={!newFilterName.trim()}>作成</button>
            </div>
          </div>
        </div>
      )}

      {showDecomposeModal && (
        <div className="modal-overlay" onClick={() => setShowDecomposeModal(false)}>
          <div className="modal decompose-modal" onClick={e => e.stopPropagation()}>
            <h2>サブタスク</h2>
            <p className="modal-description">追加するサブタスクを選択・編集:</p>
            <div className="select-all-row">
              <button className="select-all-btn" onClick={toggleAllSubtasks}>
                {selectedSubtasks.size === subtasks.length ? '全解除' : '全選択'}
              </button>
              <span className="selected-count">{selectedSubtasks.size}/{subtasks.length} 選択中</span>
            </div>
            <ul className="subtask-list">
              {subtasks.map((st, i) => (
                <li key={i} className={'subtask-item ' + (selectedSubtasks.has(i) ? 'selected' : '')}>
                  <span className="subtask-checkbox" onClick={() => toggleSubtask(i)}>{selectedSubtasks.has(i) ? '✓' : ''}</span>
                  <button className={'subtask-priority priority-' + subtaskPriorityColor(st.priority)} onClick={() => updateSubtaskPriority(i)}>{subtaskPriorityLabel(st.priority)}</button>
                  {editingSubtask === i ? (
                    <input type="text" className="subtask-edit-input" value={st.title}
                      onChange={e => updateSubtaskTitle(i, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingSubtask(null) }}
                      onBlur={() => setEditingSubtask(null)} autoFocus />
                  ) : (
                    <span className="subtask-title" onClick={() => toggleSubtask(i)} onDoubleClick={() => setEditingSubtask(i)}>{st.title}</span>
                  )}
                  {st.estimatedMinutes && <span className="subtask-duration">{formatDuration(st.estimatedMinutes)}</span>}
                  <button className="subtask-edit-btn" onClick={() => setEditingSubtask(i)}>✎</button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowDecomposeModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={addSelectedSubtasks} disabled={selectedSubtasks.size === 0}>選択を追加 ({selectedSubtasks.size})</button>
            </div>
          </div>
        </div>
      )}

      {showReminderModal && reminderTodoId && (
        <div className="modal-overlay" onClick={() => setShowReminderModal(false)}>
          <div className="modal reminder-modal" onClick={e => e.stopPropagation()}>
            <h2>リマインダー設定</h2>
            <div className="reminder-type-tabs">
              <button className={'reminder-type-tab' + (reminderType === 'once' ? ' active' : '')} onClick={() => setReminderType('once')}>1回のみ</button>
              <button className={'reminder-type-tab' + (reminderType === 'weekly' ? ' active' : '')} onClick={() => setReminderType('weekly')}>毎週</button>
            </div>
            {reminderType === 'once' ? (
              <>
                <p className="modal-description">通知する日時:</p>
                <input
                  type="datetime-local"
                  className="reminder-input"
                  value={reminderDateTime}
                  onChange={e => setReminderDateTime(e.target.value)}
                />
              </>
            ) : (
              <>
                <p className="modal-description">曜日を選択:</p>
                <div className="weekday-selector">
                  {dayNames.map((name, i) => (
                    <button key={i} className={'weekday-btn' + (weeklyDays.includes(i) ? ' selected' : '')} onClick={() => toggleWeeklyDay(i)}>{name}</button>
                  ))}
                </div>
                <p className="modal-description">時刻:</p>
                <input
                  type="time"
                  className="reminder-input"
                  value={weeklyTime}
                  onChange={e => setWeeklyTime(e.target.value)}
                />
              </>
            )}
            <div className="modal-actions">
              {(todos.find(t => t.id === reminderTodoId)?.reminder || todos.find(t => t.id === reminderTodoId)?.weeklyReminder) && (
                <button className="modal-btn danger" onClick={() => clearReminder(reminderTodoId)}>削除</button>
              )}
              <button className="modal-btn secondary" onClick={() => setShowReminderModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={setReminder} disabled={reminderType === 'once' ? !reminderDateTime : weeklyDays.length === 0}>設定</button>
            </div>
          </div>
        </div>
      )}

      {showDueDateModal && dueDateTodoId && (
        <div className="modal-overlay" onClick={() => setShowDueDateModal(false)}>
          <div className="modal due-date-modal" onClick={e => e.stopPropagation()}>
            <h2>期日設定</h2>
            <p className="modal-description">タスクの期日を設定します。期日を過ぎても完了していない場合は通知でお知らせします。</p>
            <input
              type="datetime-local"
              className="due-date-input"
              value={dueDateInput}
              onChange={e => setDueDateInput(e.target.value)}
            />
            <div className="modal-actions">
              {todos.find(t => t.id === dueDateTodoId)?.dueDate && (
                <button className="modal-btn danger" onClick={() => clearDueDate(dueDateTodoId)}>削除</button>
              )}
              <button className="modal-btn secondary" onClick={() => setShowDueDateModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={setDueDate} disabled={!dueDateInput}>設定</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal help-modal" onClick={e => e.stopPropagation()}>
            <h2>使い方ガイド</h2>
            <div className="help-content">
              <div className="help-section">
                <h3>タスクの追加</h3>
                <ul className="help-list">
                  <li><strong>基本:</strong> 入力欄に入力してEnterまたは「追加」ボタン</li>
                  <li><strong>自然言語:</strong> 「明日 買い物 #仕事 P1」のように入力</li>
                  <li><strong>期日:</strong> 「今日」「明日」「来週」などを自動認識</li>
                  <li><strong>ラベル:</strong> #をつけて入力（例：#仕事 #緊急）</li>
                  <li><strong>優先度:</strong> P1〜P4で指定（P1が最高優先度）</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>タスクの操作</h3>
                <ul className="help-list">
                  <li><strong>✓ チェック:</strong> 完了/未完了の切り替え</li>
                  <li><strong>P1〜P4:</strong> クリックで優先度を変更</li>
                  <li><strong>📅 期日:</strong> 具体的な日時を設定</li>
                  <li><strong>🔔 リマインダー:</strong> 通知を設定</li>
                  <li><strong>✨ AI分解:</strong> サブタスクに自動分解（要APIキー）</li>
                  <li><strong>✎ 編集:</strong> ダブルクリックまたはボタンで編集</li>
                  <li><strong>× 削除:</strong> タスクを削除</li>
                  <li><strong>▼ 折りたたみ:</strong> サブタスクを非表示</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>期間タブ</h3>
                <ul className="help-list">
                  <li><strong>今日:</strong> 今日中にやるべきタスク</li>
                  <li><strong>1週間:</strong> 今週中のタスク</li>
                  <li><strong>1ヶ月:</strong> 長期的なタスク</li>
                  <li><strong>計画:</strong> AI計画生成（目標から逆算）</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>AI計画生成（計画タブ）</h3>
                <ul className="help-list">
                  <li><strong>目標入力:</strong> 達成したい目標を入力してEnter</li>
                  <li><strong>生成内容:</strong> 現在地点・目標・ギャップ分析</li>
                  <li><strong>達成可能性:</strong> 数値で検証（FEASIBLE/CHALLENGING/INFEASIBLE）</li>
                  <li><strong>タスクリスト:</strong> 選択して一括追加可能</li>
                  <li><strong>ウェブ検索:</strong> Tavily APIで最新情報を取得（任意）</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>リマインダー</h3>
                <ul className="help-list">
                  <li><strong>単発:</strong> 指定した日時に1回だけ通知</li>
                  <li><strong>毎週:</strong> 指定した曜日・時刻に繰り返し通知</li>
                  <li><strong>期日通知:</strong> 期日当日に自動で通知</li>
                  <li><strong>専属リマインダー:</strong> AI人格がリマインド文を生成</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>AI機能（設定でAPIキー登録）</h3>
                <ul className="help-list">
                  <li><strong>対応サービス:</strong> OpenAI / Claude / Gemini</li>
                  <li><strong>モデル選択:</strong> 設定 → モデル設定で変更</li>
                  <li><strong>タスク分解:</strong> ✨ボタンでサブタスクに自動分解</li>
                  <li><strong>計画生成:</strong> 計画タブで目標から計画を作成</li>
                  <li><strong>専属リマインダー:</strong> 設定 → 人格で選択</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>サイドバー</h3>
                <ul className="help-list">
                  <li><strong>ラベル一覧:</strong> クリックでラベルごとにフィルター</li>
                  <li><strong>📅 カレンダー:</strong> 月表示でタスクを確認</li>
                  <li><strong>ICSエクスポート:</strong> Google/Outlookカレンダーに連携</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>キーボードショートカット</h3>
                <ul className="help-list shortcut-list">
                  <li><kbd>n</kbd> 新規タスク入力にフォーカス</li>
                  <li><kbd>?</kbd> このヘルプを表示</li>
                  <li><kbd>Esc</kbd> モーダルを閉じる</li>
                  <li><kbd>Ctrl+Z</kbd> 直前の操作を取り消し（Undo）</li>
                  <li><kbd>Ctrl+Y</kbd> 取り消した操作をやり直し（Redo）</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>バックアップ</h3>
                <ul className="help-list">
                  <li><strong>自動保存:</strong> データはlocalStorageに自動保存</li>
                  <li><strong>自動バックアップ:</strong> C:/CalmTodoBackup/に定期保存</li>
                  <li><strong>手動バックアップ:</strong> 設定 → バックアップで保存/復元</li>
                </ul>
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={() => setShowHelp(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {showCalendar && (
        <div className="modal-overlay" onClick={() => { setShowCalendar(false); setSelectedCalendarDay(null) }}>
          <div className="modal calendar-modal" onClick={e => e.stopPropagation()}>
            <h2>📅 カレンダー</h2>
            <div className="calendar-header">
              <button className="calendar-nav-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1))}>◀</button>
              <span className="calendar-month">{calendarDate.getFullYear()}年{calendarDate.getMonth() + 1}月</span>
              <button className="calendar-nav-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1))}>▶</button>
            </div>
            <div className="calendar-weekdays">
              {['日', '月', '火', '水', '木', '金', '土'].map(d => <span key={d} className="calendar-weekday">{d}</span>)}
            </div>
            <div className="calendar-grid">
              {getCalendarDays(calendarDate).map((day, i) => {
                if (!day) return <span key={i} className="calendar-day empty" />
                const tasks = getTasksForDay(day)
                const isToday = isSameDay(day, new Date())
                const isSelected = selectedCalendarDay && isSameDay(day, selectedCalendarDay)
                const hasOverdue = tasks.some(t => !t.completed && t.dueDate && t.dueDate < Date.now())
                return (
                  <button
                    key={i}
                    className={'calendar-day' + (isToday ? ' today' : '') + (isSelected ? ' selected' : '') + (tasks.length > 0 ? ' has-tasks' : '') + (hasOverdue ? ' has-overdue' : '')}
                    onClick={() => setSelectedCalendarDay(day)}
                  >
                    {day.getDate()}
                    {tasks.length > 0 && <span className="calendar-dot" />}
                  </button>
                )
              })}
            </div>
            {selectedCalendarDay && (
              <div className="calendar-day-tasks">
                <h3>{selectedCalendarDay.getMonth() + 1}/{selectedCalendarDay.getDate()}のタスク</h3>
                {getTasksForDay(selectedCalendarDay).length === 0 ? (
                  <p className="no-tasks">この日のタスクはありません</p>
                ) : (
                  <ul className="calendar-task-list">
                    {getTasksForDay(selectedCalendarDay).map(todo => (
                      <li key={todo.id} className={'calendar-task-item' + (todo.completed ? ' completed' : '') + (todo.dueDate && todo.dueDate < Date.now() && !todo.completed ? ' overdue' : '')}>
                        <span className="calendar-task-time">{new Date(todo.dueDate!).getHours().toString().padStart(2, '0')}:{new Date(todo.dueDate!).getMinutes().toString().padStart(2, '0')}</span>
                        <span className="calendar-task-text">{todo.text}</span>
                        <div className="calendar-task-actions">
                          <button className="calendar-export-btn" onClick={() => downloadTaskICS(todo)} title="ICSダウンロード">📥</button>
                          <a href={getGoogleCalendarURL(todo) || '#'} target="_blank" rel="noopener noreferrer" className="calendar-export-btn" title="Googleカレンダーに追加">G</a>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="calendar-footer">
              <button className="modal-btn secondary" onClick={exportAllToICS} disabled={todos.filter(t => t.dueDate).length === 0}>
                📥 ICSエクスポート
              </button>
              <button className="modal-btn google-calendar" onClick={exportToGoogleCalendar} disabled={todos.filter(t => t.dueDate).length === 0}>
                📆 Googleカレンダーに追加
              </button>
              <button className="modal-btn primary" onClick={() => { setShowCalendar(false); setSelectedCalendarDay(null) }}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* プロジェクト追加モーダル */}
      {showProjectModal && (
        <div className="modal-overlay" onClick={() => { setShowProjectModal(false); setNewProjectParentId(null); }}>
          <div className="modal project-modal" onClick={e => e.stopPropagation()}>
            <h2>{newProjectParentId ? 'サブプロジェクト追加' : '新しいプロジェクト'}</h2>
            <p className="modal-description">{newProjectParentId ? `「${projects.find(p => p.id === newProjectParentId)?.name}」のサブプロジェクト` : 'プロジェクトでタスクを整理できます'}</p>
            <div className="project-form">
              <input
                type="text"
                className="project-name-input"
                placeholder="プロジェクト名..."
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addProject()}
                autoFocus
              />
              <div className="project-color-picker">
                <label>カラー:</label>
                <div className="color-options">
                  {['#e07b39', '#d94f4f', '#4a9c6d', '#5a7bb5', '#8b6aad', '#e09839'].map(color => (
                    <button
                      key={color}
                      className={'color-option' + (newProjectColor === color ? ' active' : '')}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewProjectColor(color)}
                    />
                  ))}
                </div>
              </div>
              {!newProjectParentId && projects.filter(p => !p.parentId && !p.isArchived).length > 0 && (
                <div className="project-parent-picker">
                  <label>親プロジェクト（オプション）:</label>
                  <select value={newProjectParentId || ''} onChange={e => setNewProjectParentId(e.target.value || null)}>
                    <option value="">なし（ルートプロジェクト）</option>
                    {projects.filter(p => !p.parentId && !p.isArchived).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => { setShowProjectModal(false); setNewProjectParentId(null); }}>キャンセル</button>
              <button className="modal-btn primary" onClick={addProject} disabled={!newProjectName.trim()}>作成</button>
            </div>
          </div>
        </div>
      )}

      {/* アクティビティ履歴モーダル */}
      {showActivityModal && (
        <div className="modal-overlay" onClick={() => setShowActivityModal(false)}>
          <div className="modal activity-modal" onClick={e => e.stopPropagation()}>
            <h2>📊 アクティビティ履歴</h2>
            <div className="activity-list">
              {activityLog.length === 0 ? (
                <p className="empty-text">アクティビティがありません</p>
              ) : (
                [...activityLog].reverse().slice(0, 50).map(log => (
                  <div key={log.id} className={`activity-item ${log.type}`}>
                    <span className="activity-icon">
                      {log.type === 'task_completed' && '✅'}
                      {log.type === 'task_created' && '➕'}
                      {log.type === 'task_deleted' && '🗑️'}
                      {log.type === 'project_created' && '📁'}
                      {log.type === 'task_updated' && '✏️'}
                    </span>
                    <span className="activity-text">
                      {log.type === 'task_completed' && `「${log.taskText}」を完了`}
                      {log.type === 'task_created' && `「${log.taskText}」を作成`}
                      {log.type === 'task_deleted' && `「${log.taskText}」を削除`}
                      {log.type === 'project_created' && `プロジェクト「${log.projectName}」を作成`}
                      {log.type === 'task_updated' && `「${log.taskText}」を更新`}
                    </span>
                    <span className="activity-time">{new Date(log.timestamp).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowActivityModal(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* カルマモーダル */}
      {showKarmaModal && (
        <div className="modal-overlay" onClick={() => setShowKarmaModal(false)}>
          <div className="modal karma-modal" onClick={e => e.stopPropagation()}>
            <h2>🏆 カルマ</h2>
            <div className="karma-stats">
              <div className="karma-main">
                <div className="karma-level-display">
                  <span className="level-number">Lv.{karma.level}</span>
                  <span className="level-title">{getLevelName(karma.level)}</span>
                </div>
                <div className="karma-points-display">
                  <span className="points-number">{karma.totalPoints}</span>
                  <span className="points-label">ポイント</span>
                </div>
              </div>
              <div className="karma-details">
                <div className="karma-stat">
                  <span className="stat-icon">🔥</span>
                  <span className="stat-value">{karma.streak}</span>
                  <span className="stat-label">現在のストリーク</span>
                </div>
                <div className="karma-stat">
                  <span className="stat-icon">🏅</span>
                  <span className="stat-value">{karma.longestStreak}</span>
                  <span className="stat-label">最長ストリーク</span>
                </div>
                <div className="karma-stat">
                  <span className="stat-icon">✅</span>
                  <span className="stat-value">{karma.tasksCompleted}</span>
                  <span className="stat-label">完了タスク総数</span>
                </div>
                <div className="karma-stat">
                  <span className="stat-icon">📅</span>
                  <span className="stat-value">{karma.tasksCompletedToday}</span>
                  <span className="stat-label">今日の完了</span>
                </div>
              </div>
              <div className="karma-progress">
                <p className="progress-label">次のレベルまで</p>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.min(100, (karma.totalPoints % 100) / 100 * 100)}%` }}></div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowKarmaModal(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* 所要時間設定モーダル */}
      {showDurationModal && durationTodoId && (
        <div className="modal-overlay" onClick={() => setShowDurationModal(false)}>
          <div className="modal duration-modal" onClick={e => e.stopPropagation()}>
            <h2>所要時間</h2>
            <p className="modal-description">タスクの完了にかかる時間を設定します</p>
            <div className="duration-input-group">
              <input
                type="number"
                className="duration-input"
                placeholder="分数を入力..."
                value={durationInput}
                onChange={e => setDurationInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setDuration()}
                min="1"
                autoFocus
              />
              <span className="duration-unit">分</span>
            </div>
            <div className="duration-presets">
              <button className="preset-btn" onClick={() => setDurationInput('15')}>15分</button>
              <button className="preset-btn" onClick={() => setDurationInput('30')}>30分</button>
              <button className="preset-btn" onClick={() => setDurationInput('60')}>1時間</button>
              <button className="preset-btn" onClick={() => setDurationInput('120')}>2時間</button>
            </div>
            <div className="modal-actions">
              {todos.find(t => t.id === durationTodoId)?.estimatedMinutes && (
                <button className="modal-btn danger" onClick={() => clearDuration(durationTodoId)}>削除</button>
              )}
              <button className="modal-btn secondary" onClick={() => setShowDurationModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={setDuration} disabled={!durationInput}>設定</button>
            </div>
          </div>
        </div>
      )}

      {/* コメントモーダル */}
      {showCommentModal && commentTodoId && (
        <div className="modal-overlay" onClick={() => setShowCommentModal(false)}>
          <div className="modal comment-modal" onClick={e => e.stopPropagation()}>
            <h2>コメント</h2>
            <p className="modal-description">タスクにメモやコメントを追加できます</p>
            <div className="comments-list">
              {todos.find(t => t.id === commentTodoId)?.comments.map(comment => (
                <div key={comment.id} className="comment-item">
                  <div className="comment-content">
                    <p className="comment-text">{comment.text}</p>
                    <span className="comment-date">{new Date(comment.createdAt).toLocaleString('ja-JP')}</span>
                  </div>
                  <button className="comment-delete" onClick={() => deleteComment(commentTodoId, comment.id)} title="削除">×</button>
                </div>
              ))}
              {todos.find(t => t.id === commentTodoId)?.comments.length === 0 && (
                <div className="no-comments">コメントはまだありません</div>
              )}
            </div>
            <div className="comment-input-group">
              <textarea
                className="comment-input"
                placeholder="コメントを入力..."
                value={newCommentText}
                onChange={e => setNewCommentText(e.target.value)}
                rows={3}
              />
              <button className="add-comment-btn" onClick={addComment} disabled={!newCommentText.trim()}>追加</button>
            </div>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={() => setShowCommentModal(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {showIntro && (
        <div className="intro-tooltip">
          <div className="intro-tooltip-content">
            <span className="intro-tooltip-icon">{introSteps[introStep].icon}</span>
            <div className="intro-tooltip-text">
              <strong>{introSteps[introStep].title}</strong>
              <span dangerouslySetInnerHTML={{
                __html: introSteps[introStep].content
                  .replace(/\n/g, '<br/>')
                  .replace(/<hl>/g, '<span class="intro-text-hl">')
                  .replace(/<\/hl>/g, '</span>')
              }} />
            </div>
          </div>
          <div className="intro-tooltip-nav">
            <div className="intro-dots">
              {introSteps.map((_, i) => (
                <span key={i} className={'intro-dot' + (i === introStep ? ' active' : '')} onClick={() => setIntroStep(i)} />
              ))}
            </div>
            <div className="intro-tooltip-buttons">
              {introStep > 0 && (
                <button className="intro-nav-btn" onClick={() => setIntroStep(s => s - 1)}>←</button>
              )}
              {introStep < introSteps.length - 1 ? (
                <button className="intro-nav-btn primary" onClick={() => setIntroStep(s => s + 1)}>次へ →</button>
              ) : (
                <button className="intro-nav-btn primary" onClick={completeIntro}>始める</button>
              )}
              <button className="intro-skip-btn" onClick={completeIntro}>×</button>
            </div>
          </div>
        </div>
      )}

      {exportResult && (
        <div className="modal-overlay export-result-overlay" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExportResult(null)}>
          <div className="modal export-result-modal" style={{ background: 'white', padding: '24px', borderRadius: '12px', maxWidth: '400px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="export-result-icon" style={{ width: '64px', height: '64px', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', background: exportResult.success ? 'rgba(74, 156, 109, 0.12)' : 'rgba(217, 79, 79, 0.12)', color: exportResult.success ? '#4a9c6d' : '#d94f4f', borderRadius: '50%' }}>{exportResult.success ? '✓' : '✕'}</div>
            <h2 style={{ marginBottom: '12px' }}>{exportResult.success ? 'エクスポート完了' : 'エクスポート失敗'}</h2>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
              {exportResult.success
                ? `ファイルを保存しました:`
                : 'エラーが発生しました:'}
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: '12px', background: '#f5f5f5', padding: '8px 12px', borderRadius: '8px', wordBreak: 'break-all', marginBottom: '16px' }}>{exportResult.message}</p>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={() => setExportResult(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
