import { useState, useEffect, useRef, useCallback } from 'react'
import { useUIState } from './hooks/useUIState'
import { useKarma } from './hooks/useKarma'
import { useProjects } from './hooks/useProjects'
import { useCalendar } from './hooks/useCalendar'
import { usePlanning, INTRO_SAMPLE_PLAN } from './hooks/usePlanning'
import { KanaeReminderSettings } from './components/settings/KanaeReminderSettings'
import { BoardView } from './components/BoardView'
import Sidebar from './components/Sidebar'
import { decomposeTask, getKanaeConfig, startReminderService, stopReminderService, type ReminderTask, type Subtask, type NotificationResult } from './services/reminder'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-shell'

import { parseNaturalLanguage, getNextRecurrenceDate, formatRecurrence, type RecurrencePattern } from './lib/parseNaturalLanguage'
import { importICSToTodos, type ImportStats } from './lib/icsParser'
// generatePlan, PlanTask, PlanResult は usePlanning から取得
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
  // ActivityLog, KarmaStats は useKarma 経由で使用
  Priority,
  Timeframe,
  // ViewTimeframe は useUIState / usePlanning 経由で使用
  LabelDefinition,
} from '@/types/todo'
import { LABEL_COLORS } from '@/types/todo'

// Storage utilities
import {
  INTRO_SEEN_KEY,
  loadCustomFilters,
  saveCustomFilters,
  loadSections,
  saveSections,
  saveLabels,
  saveProjects,
  saveLabelDefinitions,
  // loadProjects, loadLabels, loadLabelDefinitions は useProjects 経由で使用
  // カルマ・ビューモード関連は useKarma / useUIState 経由で使用
  getPointsForNextLevel,
  getPointsForCurrentLevel,
  LEVEL_THRESHOLDS,
  loadTodos,
  saveTodos,
  loadCollapsed,
  saveCollapsed,
} from '@/lib/storage'

// Utility functions
import {
  isTauri,
  requestNotificationPermission,
  saveBackup,
  loadBackup,
} from '@/lib/utils'

// INTRO_SAMPLE_PLAN は usePlanning からインポート

export default function App() {
  // カスタムフック - UI状態
  const {
    showSettings, setShowSettings,
    showHelp, setShowHelp,
    showSectionModal, setShowSectionModal,
    showFilterModal, setShowFilterModal,
    showLabelModal, setShowLabelModal,
    showProjectModal, setShowProjectModal,
    showDueDateModal, setShowDueDateModal,
    showDurationModal, setShowDurationModal,
    showCommentModal, setShowCommentModal,
    showActivityModal, setShowActivityModal,
    showKarmaModal, setShowKarmaModal,
    showDecomposeModal, setShowDecomposeModal,
    showImportModal, setShowImportModal,
    showCalendar, setShowCalendar,
    showIntro, setShowIntro,
    sidebarCollapsed, setSidebarCollapsed,
    viewMode,
    activeView, setActiveView,
    currentTimeframe, setCurrentTimeframe,
    selectedLabel, setSelectedLabel,
    selectedProjectId, setSelectedProjectId,
    activeCustomFilter, setActiveCustomFilter,
    labelFilter, setLabelFilter,
    changeViewMode,
  } = useUIState()

  // カスタムフック - カルマ・アクティビティ
  const {
    karma,
    activityLog,
    addActivityLog,
    updateKarmaOnComplete,
    updateKarmaOnUncomplete,
    getContributionData,
    getContributionLevel,
    getLevelName,
  } = useKarma()

  // カスタムフック - プロジェクト・ラベル
  const {
    projects,
    setProjects,
    newProjectName,
    setNewProjectName,
    newProjectColor,
    setNewProjectColor,
    newProjectParentId,
    setNewProjectParentId,
    savedLabels,
    setSavedLabels,
    labelDefinitions,
    setLabelDefinitions,
    labelTodoId,
    setLabelTodoId,
    newLabelInput,
    setNewLabelInput,
    newLabelName,
    setNewLabelName,
    newLabelColor,
    setNewLabelColor,
    addProject,
    toggleProjectFavorite,
    getSubProjects,
    getFavoriteProjects,
    deleteProject,
    getAllLabels,
    getUniqueLabelName,
    // openLabelModal, closeLabelModal, addLabelToTodo, removeLabelFromTodo は App.tsx内で定義
  } = useProjects()

  // カスタムフック - カレンダー・期日
  const {
    calendarDate,
    setCalendarDate,
    selectedCalendarDay,
    setSelectedCalendarDay,
    dueDateTodoId,
    // setDueDateTodoId は useCalendar 内部でのみ使用（openDueDateModal経由）
    dueDateInput,
    setDueDateInput,
    dueDateNotifyEnabled,
    setDueDateNotifyEnabled,
    dueDateNotifyBefore,
    setDueDateNotifyBefore,
    dueDateRecurrenceType,
    setDueDateRecurrenceType,
    dueDateRecurrenceDays,
    setDueDateRecurrenceDays,
    dueDateRecurrenceTime,
    setDueDateRecurrenceTime,
    dueDateMonthlyDay,
    setDueDateMonthlyDay,
    dueDateYearlyMonth,
    setDueDateYearlyMonth,
    dueDateYearlyDay,
    setDueDateYearlyDay,
    // formatLocalDateTime は useCalendar 内部でのみ使用
    formatDueDate,
    isDueDateOverdue,
    getCalendarDays,
    getTasksForDay: getTasksForDayFromHook,
    isSameDay,
    openDueDateModal: openDueDateModalFromHook,
    setDueDate: setDueDateFromHook,
    clearDueDate: clearDueDateFromHook,
  } = useCalendar()

  // カスタムフック - プランニング
  const {
    planGoal,
    setPlanGoal,
    planTargetDays,
    setPlanTargetDays,
    planTargetPreset,
    setPlanTargetPreset,
    planCustomDate,
    setPlanCustomDate,
    planResult,
    setPlanResult,
    planTasks,
    setPlanTasks,
    isGeneratingPlan,
    setIsGeneratingPlan,
    planError,
    setPlanError,
    editingPlanTaskIndex,
    setEditingPlanTaskIndex,
    editingPlanTaskTitle,
    setEditingPlanTaskTitle,
    planLabel,
    setPlanLabel,
    planProjectId,
    setPlanProjectId,
    showNewProjectInPlan,
    setShowNewProjectInPlan,
    newProjectNameInPlan,
    setNewProjectNameInPlan,
    introSamplePlanRef,
    introPrevTimeframeRef,
    generatePlan,
  } = usePlanning()

  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [input, setInput] = useState('')
  // タスク追加の詳細オプション
  const [addDueDateYear, setAddDueDateYear] = useState('')
  const [addDueDateMonth, setAddDueDateMonth] = useState('')
  const [addDueDateDay, setAddDueDateDay] = useState('')
  const [addDueTime, setAddDueTime] = useState('23:59') // HH:mm形式
  const dueDateMonthRef = useRef<HTMLInputElement>(null)
  const dueDateDayRef = useRef<HTMLInputElement>(null)

  // 日付が有効かどうか
  const hasValidDueDate = addDueDateYear.length === 4 && addDueDateMonth.length >= 1 && addDueDateDay.length >= 1
  const addDueDate = hasValidDueDate
    ? `${addDueDateYear}-${addDueDateMonth.padStart(2, '0')}-${addDueDateDay.padStart(2, '0')}`
    : ''

  const clearAddDueDate = () => {
    setAddDueDateYear('')
    setAddDueDateMonth('')
    setAddDueDateDay('')
  }
  const [addRecurrenceType, setAddRecurrenceType] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('none')
  const [addWeeklyDay, setAddWeeklyDay] = useState<number>(1) // 0=日曜, 1=月曜, ...
  const [addMonthlyDay, setAddMonthlyDay] = useState<number>(1) // 1〜31
  const [addYearlyMonth, setAddYearlyMonth] = useState<number>(1) // 1〜12
  const [addYearlyDay, setAddYearlyDay] = useState<number>(1) // 1〜31
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  // labelFilter, activeCustomFilter, showFilterModal は useUIState から取得
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>(loadCustomFilters)
  const [newFilterName, setNewFilterName] = useState('')
  const [newFilterPriority, setNewFilterPriority] = useState<Priority | null>(null)
  const [newFilterLabels, setNewFilterLabels] = useState<string[]>([])
  const [newFilterOverdue, setNewFilterOverdue] = useState(false)
  const [newFilterHasRecurrence, setNewFilterHasRecurrence] = useState(false)
  const [sections, setSections] = useState<Section[]>(loadSections)
  // savedLabels, labelDefinitions は useProjects から取得
  // viewMode, showSectionModal, showSettings は useUIState から取得
  const [newSectionName, setNewSectionName] = useState('')
  const [editingDescription, setEditingDescription] = useState<string | null>(null)
  const [descriptionText, setDescriptionText] = useState('')
  const kanaeSettingsSaveRef = useRef<(() => void) | null>(null)
  const [decomposing, setDecomposing] = useState<string | null>(null)
  const [decomposingTodo, setDecomposingTodo] = useState<Todo | null>(null)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(new Set())
  // showDecomposeModal は useUIState から取得
  const [decomposeError, setDecomposeError] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null)
  // currentTimeframe, showDueDateModal は useUIState から取得
  // dueDateTodoId 〜 dueDateYearlyDay は useCalendar から取得
  // showHelp, showIntro は useUIState から取得
  const [introStep, setIntroStep] = useState(0)
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null)
  // showImportModal は useUIState から取得
  const [importResult, setImportResult] = useState<{ success: boolean; stats: ImportStats } | null>(null)
  const [importOptions, setImportOptions] = useState({ importCompleted: false, importPast: false, importEvents: false })
  // showCalendar, showLabelModal は useUIState から取得
  // calendarDate, selectedCalendarDay は useCalendar から取得
  // labelTodoId, newLabelInput, newLabelName, newLabelColor は useProjects から取得
  // sidebarCollapsed, activeView, selectedLabel, selectedProjectId, showProjectModal は useUIState から取得
  // projects, newProjectName, newProjectColor は useProjects から取得
  // showDurationModal は useUIState から取得
  // 所要時間関連
  const [durationTodoId, setDurationTodoId] = useState<string | null>(null)
  const [durationInput, setDurationInput] = useState('')
  // showCommentModal は useUIState から取得
  // コメント関連
  const [commentTodoId, setCommentTodoId] = useState<string | null>(null)
  const [newCommentText, setNewCommentText] = useState('')
  // activityLog, showActivityModal, karma, showKarmaModal は useKarma / useUIState から取得
  // newProjectParentId は useProjects から取得
  // ドラッグ&ドロップ関連
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null)
  // 計画機能関連は usePlanning から取得
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
      dueDateNotification: todo.dueDateNotification,
      timeframe: todo.timeframe,
    }))
  }

  // 通知後のタスク更新コールバック
  const handleNotificationUpdates = (results: NotificationResult[]) => {
    setTodos(prevTodos => {
      const updated = prevTodos.map(todo => {
        const result = results.find(r => r.taskId === todo.id)
        if (result) {
          const todoUpdates: Partial<Todo> = {}
          // dueDateNotificationの更新
          if (result.updates.dueDateNotification !== undefined) {
            todoUpdates.dueDateNotification = result.updates.dueDateNotification as Todo['dueDateNotification']
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
            // リマインダーからdueDateNotificationへのマイグレーション
            let dueDateNotification = t.dueDateNotification ?? null
            if (!dueDateNotification && dueDate) {
              // 旧形式のreminder/weeklyReminderがある場合は通知を有効に
              const hasOldReminder = t.reminder || t.weeklyReminder
              dueDateNotification = {
                enabled: !!hasOldReminder || !t.dueDateNotified,
                notifyBefore: 0,
                notifiedAt: t.lastNotifiedAt ?? null,
                followUpCount: t.followUpCount ?? 0
              }
            }
            return {
              id: t.id,
              text: t.text,
              completed: t.completed,
              completedAt: t.completedAt ?? (t.completed ? t.createdAt : null),
              createdAt: t.createdAt,
              parentId: t.parentId ?? null,
              priority,
              timeframe: t.timeframe ?? 'today',
              dueDate,
              dueDateNotification,
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
      // リマインダーからdueDateNotificationへのマイグレーション
      let dueDateNotification = t.dueDateNotification ?? null
      if (!dueDateNotification && dueDate) {
        const hasOldReminder = t.reminder || t.weeklyReminder
        dueDateNotification = {
          enabled: !!hasOldReminder || !t.dueDateNotified,
          notifyBefore: 0,
          notifiedAt: t.lastNotifiedAt ?? null,
          followUpCount: t.followUpCount ?? 0
        }
      }
      return {
        id: t.id,
        text: t.text,
        completed: t.completed,
        completedAt: t.completedAt ?? (t.completed ? t.createdAt : null),
        createdAt: t.createdAt,
        parentId: t.parentId ?? null,
        priority,
        timeframe: t.timeframe ?? 'today',
        dueDate,
        dueDateNotification,
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

      // UIから設定された繰り返しを優先、なければパース結果を使用
      let finalRecurrence: RecurrencePattern | null = parsed.recurrence
      if (addRecurrenceType !== 'none') {
        finalRecurrence = { type: addRecurrenceType, interval: 1 }
      }

      // UIから設定された期限を優先、なければパース結果を使用
      let finalDueDate: number | null = parsed.dueDate
      if (addDueDate && addDueDate.match(/^\d{2}:\d{2}$/)) {
        // 繰り返しタスクの場合は時間のみ（HH:MM形式）
        const [hours, minutes] = addDueDate.split(':').map(Number)

        if (finalRecurrence?.type === 'daily') {
          // 毎日タスク：今日の日付と組み合わせる
          const today = new Date()
          today.setHours(hours, minutes, 0, 0)
          if (today.getTime() < Date.now()) {
            today.setDate(today.getDate() + 1)
          }
          finalDueDate = today.getTime()
        } else if (finalRecurrence?.type === 'weekly') {
          // 毎週タスク：曜日と時間から次の該当日を計算
          const targetDay = addWeeklyDay
          const now = new Date()
          const currentDay = now.getDay()
          let daysUntilTarget = targetDay - currentDay
          if (daysUntilTarget < 0) {
            daysUntilTarget += 7
          } else if (daysUntilTarget === 0) {
            const todayWithTime = new Date()
            todayWithTime.setHours(hours, minutes, 0, 0)
            if (todayWithTime.getTime() < Date.now()) {
              daysUntilTarget = 7
            }
          }
          const targetDate = new Date()
          targetDate.setDate(now.getDate() + daysUntilTarget)
          targetDate.setHours(hours, minutes, 0, 0)
          finalDueDate = targetDate.getTime()
        } else if (finalRecurrence?.type === 'monthly') {
          // 毎月タスク：指定日と時間から次の該当日を計算
          const now = new Date()
          const targetDate = new Date(now.getFullYear(), now.getMonth(), addMonthlyDay, hours, minutes, 0, 0)
          // 今月の指定日が過ぎていたら来月
          if (targetDate.getTime() < Date.now()) {
            targetDate.setMonth(targetDate.getMonth() + 1)
          }
          finalDueDate = targetDate.getTime()
        } else if (finalRecurrence?.type === 'yearly') {
          // 毎年タスク：指定月日と時間から次の該当日を計算
          const now = new Date()
          const targetDate = new Date(now.getFullYear(), addYearlyMonth - 1, addYearlyDay, hours, minutes, 0, 0)
          // 今年の指定日が過ぎていたら来年
          if (targetDate.getTime() < Date.now()) {
            targetDate.setFullYear(targetDate.getFullYear() + 1)
          }
          finalDueDate = targetDate.getTime()
        }
      } else if (addDueDate) {
        // 通常タスク：date + time形式
        const [hours, minutes] = addDueTime.split(':').map(Number)
        const dateObj = new Date(addDueDate)
        dateObj.setHours(hours, minutes, 0, 0)
        finalDueDate = dateObj.getTime()
      }

      // 期日が必須（UIでもテキストでも指定がない場合）
      if (!finalDueDate) {
        setDecomposeError('期日を指定してください（例：「明日」「来週月曜」「1/20」など、または下の期限設定を使用）')
        setInput(rawText)
        setIsAddingTodo(false)
        return
      }

      // タイムフレームの決定（year含む通常の期間タブはそのまま使用、特殊タブはtodayにフォールバック）
      const effectiveTimeframe: Timeframe = (currentTimeframe === 'completed' || currentTimeframe === 'plan' || currentTimeframe === 'archived') ? 'today' : currentTimeframe
      // 繰り返しタイプに応じたタイムフレーム
      let timeframe: Timeframe = effectiveTimeframe
      if (finalDueDate) {
        const now = new Date()
        const due = new Date(finalDueDate)
        const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays <= 1) timeframe = 'today'
        else if (diffDays <= 7) timeframe = 'week'
        else if (diffDays <= 31) timeframe = 'month'
        else timeframe = 'year'
      }
      // 繰り返しタスクの場合は適切なタイムフレームに
      if (finalRecurrence) {
        if (finalRecurrence.type === 'daily') timeframe = 'today'
        else if (finalRecurrence.type === 'weekly') timeframe = 'week'
        else if (finalRecurrence.type === 'monthly') timeframe = 'month'
        else if (finalRecurrence.type === 'yearly') timeframe = 'year'
      }

      updateTodosWithHistory(prev => [{
        id: crypto.randomUUID(),
        text: parsed.text,
        completed: false,
        completedAt: null,
        createdAt: Date.now(),
        parentId: null,
        priority: parsed.priority,
        timeframe,
        dueDate: finalDueDate,
        dueDateNotification: finalDueDate ? { enabled: true, notifyBefore: 0, notifiedAt: null, followUpCount: 0 } : null,
        labels: parsed.labels,
        recurrence: finalRecurrence,
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

      // 新しいラベルをsavedLabelsに保存
      const newLabels = parsed.labels.filter(l => !savedLabels.includes(l))
      if (newLabels.length > 0) {
        const updatedSavedLabels = [...savedLabels, ...newLabels].sort()
        setSavedLabels(updatedSavedLabels)
        saveLabels(updatedSavedLabels)
      }

      // UIオプションをリセット
      clearAddDueDate()
      setAddDueTime('23:59')
      setAddRecurrenceType('none')
      setAddWeeklyDay(1)
      setAddMonthlyDay(1)
      setAddYearlyMonth(1)
      setAddYearlyDay(1)
    } catch (error) {
      console.error('Failed to add todo:', error)
      // エラー時は元の入力を復元
      setInput(rawText)
    } finally {
      setIsAddingTodo(false)
    }
  }

  // addActivityLog, updateKarmaOnComplete, updateKarmaOnUncomplete は useKarma から取得

  const toggleTodo = (id: string) => {
    setTodosHistory(prevHistory => [...prevHistory.slice(-19), todos])
    setTodos(prev => {
      const target = prev.find(t => t.id === id)
      if (!target) return prev
      const newCompleted = !target.completed

      // カルマとアクティビティログの更新
      if (newCompleted) {
        // 完了時：ポイント付与（所要時間ボーナス含む）
        updateKarmaOnComplete(target.priority, target.estimatedMinutes)
        addActivityLog({
          type: 'task_completed',
          taskId: target.id,
          taskText: target.text
        })
      } else if (target.karmaAwarded) {
        // 完了取り消し時：ポイント減点（獲得済みの場合のみ）
        updateKarmaOnUncomplete(target.priority, target.estimatedMinutes)
      }
      const getDescendantIds = (parentId: string): string[] => {
        const children = prev.filter(t => t.parentId === parentId)
        return children.flatMap(c => [c.id, ...getDescendantIds(c.id)])
      }
      const idsToToggle = new Set([id, ...getDescendantIds(id)])

      // まず対象タスクと子タスクを更新（完了/未完了に応じてkarmaAwardedとcompletedAtを更新）
      const now = Date.now()
      let updated = prev.map(todo => {
        if (!idsToToggle.has(todo.id)) return todo
        const updatedTodo = { ...todo, completed: newCompleted, completedAt: newCompleted ? now : null, karmaAwarded: newCompleted }
        // 通知設定をリセット
        if (newCompleted && updatedTodo.dueDateNotification) {
          updatedTodo.dueDateNotification = { ...updatedTodo.dueDateNotification, followUpCount: 0, notifiedAt: null }
        }
        return updatedTodo
      })

      // 子タスクを完了した場合、親タスクのすべての子が完了したか確認
      if (newCompleted && target.parentId) {
        const checkAndCompleteParent = (parentId: string | null) => {
          if (!parentId) return
          const siblings = updated.filter(t => t.parentId === parentId)
          const allSiblingsCompleted = siblings.length > 0 && siblings.every(t => t.completed)
          if (allSiblingsCompleted) {
            updated = updated.map(t => {
              if (t.id !== parentId) return t
              const parentTodo = { ...t, completed: true, completedAt: now, karmaAwarded: true }
              if (parentTodo.dueDateNotification) {
                parentTodo.dueDateNotification = { ...parentTodo.dueDateNotification, followUpCount: 0, notifiedAt: null }
              }
              return parentTodo
            })
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

        const nextTodo: Todo = {
          id: crypto.randomUUID(),
          text: target.text,
          completed: false,
          completedAt: null,
          createdAt: Date.now(),
          parentId: null,
          priority: target.priority,
          timeframe: target.timeframe,
          dueDate: nextDate.getTime(),
          dueDateNotification: { enabled: true, notifyBefore: 0, notifiedAt: null, followUpCount: 0 },
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
    const next: Timeframe =
      todo.timeframe === 'today' ? 'week' :
      todo.timeframe === 'week' ? 'month' :
      todo.timeframe === 'month' ? 'year' : 'today'

    // 親タスクと子タスクを一緒に移動
    updateTodosWithHistory(prev => prev.map(t => {
      // 対象のタスク
      if (t.id === id) return { ...t, timeframe: next }
      // 子タスクも一緒に移動
      if (t.parentId === id) return { ...t, timeframe: next }
      return t
    }))

    // ビューをインボックスに保ち、タイムフレームを更新
    if (activeView === 'inbox') {
      setCurrentTimeframe(next)
    }
  }

  const timeframeLabel = (tf: Timeframe) =>
    tf === 'today' ? '今日' :
    tf === 'week' ? '週' :
    tf === 'month' ? '月' : '年'

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
      completedAt: null,
      createdAt: Date.now(),
      parentId,
      priority: mapPriority(st.priority),
      timeframe: parentTimeframe,
      dueDate: null,
      dueDateNotification: null,
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

  // 全ラベルを収集（useProjectsのgetAllLabelsを使用）
  const allLabels = getAllLabels(todos)
  // getUniqueLabelName は useProjects から取得

  // 繰り返しタスクがそのタブに表示されるべきかチェック
  const shouldShowRecurringInTimeframe = (todo: Todo, timeframe: Timeframe): boolean => {
    if (!todo.recurrence) return false
    const { type } = todo.recurrence
    // 毎日 → 今日タブ、毎週 → 1週間タブ、毎月 → 1ヶ月タブ、毎年 → 1年タブ
    if (type === 'daily' && timeframe === 'today') return true
    if (type === 'weekly' && timeframe === 'week') return true
    if (type === 'monthly' && timeframe === 'month') return true
    if (type === 'yearly' && timeframe === 'year') return true
    return false
  }

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
        // 繰り返しタスクは対応するタブにも表示
        if (todo.parentId === null) {
          const matchesTimeframe = todo.timeframe === currentTimeframe
          const matchesRecurrence = shouldShowRecurringInTimeframe(todo, currentTimeframe as Timeframe)
          if (!matchesTimeframe && !matchesRecurrence) return false
        }
        if (todo.parentId !== null) {
          const parent = todos.find(t => t.id === todo.parentId)
          if (parent) {
            const matchesTimeframe = parent.timeframe === currentTimeframe
            const matchesRecurrence = shouldShowRecurringInTimeframe(parent, currentTimeframe as Timeframe)
            if (!matchesTimeframe && !matchesRecurrence) return false
          }
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

  // changeViewMode は useUIState から取得

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
    // savedLabelsにも追加（タスク削除後も保持）
    if (!savedLabels.includes(label)) {
      const newSavedLabels = [...savedLabels, label].sort()
      setSavedLabels(newSavedLabels)
      saveLabels(newSavedLabels)
    }
    setNewLabelInput('')
  }

  const removeLabelFromTodo = (todoId: string, label: string) => {
    updateTodosWithHistory(prev => prev.map(t => {
      if (t.id !== todoId) return t
      return { ...t, labels: t.labels.filter(l => l !== label) }
    }))
  }

  // プロジェクト関連の関数（useProjectsをラップ）
  const handleAddProject = () => {
    addProject(
      (log) => addActivityLog(log),
      () => setShowProjectModal(false)
    )
  }

  // プロジェクトアーカイブトグル（将来使用）
  const _toggleProjectArchive = (id: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, isArchived: !p.isArchived } : p))
  }
  void _toggleProjectArchive

  // deleteProjectラッパー
  const handleDeleteProject = (id: string) => {
    deleteProject(
      id,
      updateTodosWithHistory,
      selectedProjectId,
      () => {
        setSelectedProjectId(null)
        setActiveView('inbox')
      }
    )
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

  // formatLocalDateTime, formatDueDate, isDueDateOverdue, getCalendarDays, isSameDay は useCalendar から取得

  // useCalendar のラッパー関数（App.tsx のスコープ内の変数を使用するため）
  const openDueDateModal = (todoId: string) => {
    openDueDateModalFromHook(todoId, todos, setShowDueDateModal)
  }

  const setDueDate = () => {
    setDueDateFromHook(updateTodosWithHistory, setShowDueDateModal)
  }

  const clearDueDate = (todoId: string) => {
    clearDueDateFromHook(todoId, updateTodosWithHistory, setShowDueDateModal)
  }

  // getTasksForDay は todos を使用するためラッパー関数として定義
  const getTasksForDay = (date: Date) => {
    return getTasksForDayFromHook(date, todos)
  }

  // getContributionData, getContributionLevel は useKarma から取得

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

  // Import from ICS file
  const handleICSImport = async (file: File) => {
    try {
      const content = await file.text()
      const { todos: importedTodos, stats } = importICSToTodos(content, {
        importCompleted: importOptions.importCompleted,
        importPast: importOptions.importPast,
        importEvents: importOptions.importEvents,
        importTasks: true,
      })

      if (importedTodos.length === 0) {
        setImportResult({
          success: false,
          stats,
        })
        return
      }

      // Todoにidを付与して追加
      const newTodos: Todo[] = importedTodos.map((todo, index) => ({
        ...todo,
        id: crypto.randomUUID(),
        order: todos.length + index,
      } as Todo))

      updateTodosWithHistory(prev => [...prev, ...newTodos])

      setImportResult({
        success: true,
        stats,
      })

      // 3秒後に結果を非表示
      setTimeout(() => {
        setImportResult(null)
        setShowImportModal(false)
      }, 3000)
    } catch (error) {
      console.error('ICS import error:', error)
      setImportResult({
        success: false,
        stats: {
          total: 0,
          totalTasks: 0,
          totalEvents: 0,
          imported: 0,
          skipped: 0,
          skippedReasons: { completed: 0, past: 0, isEvent: 0 },
        },
      })
    }
  }

  // 外部リンクを開く（Tauri環境ではshell.openを使用）
  const openExternalLink = useCallback((url: string) => {
    if (isTauri()) {
      open(url).catch(err => {
        console.error('Failed to open URL with Tauri shell:', err)
        window.open(url, '_blank')
      })
    } else {
      window.open(url, '_blank')
    }
  }, [])

  // Export to ICS and open Google Calendar import page
  const exportToGoogleCalendar = () => {
    const tasksWithDueDate = todos.filter(t => t.dueDate)
    if (tasksWithDueDate.length === 0) return

    // If 5 or fewer tasks, open each directly in Google Calendar
    if (tasksWithDueDate.length <= 5) {
      tasksWithDueDate.forEach((todo, i) => {
        const url = getGoogleCalendarURL(todo)
        if (url) {
          setTimeout(() => openExternalLink(url), i * 300)
        }
      })
      return
    }

    // For more tasks, export ICS and open Google Calendar import settings
    exportAllToICS()
    setTimeout(() => {
      openExternalLink('https://calendar.google.com/calendar/u/0/r/settings/export')
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

  // イントロサンプル表示用の状態を保持する参照は usePlanning から取得

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
      title: 'サイドバーで整理',
      content: '左側のサイドバーで効率的に管理できます。\n\n<hl>プロジェクト</hl>：タスクをグループ化\n<hl>ラベル</hl>：タグで分類（色付き対応）\n<hl>フィルター</hl>：条件で絞り込み\n<hl>カルマ</hl>：完了でポイント獲得！',
      icon: '📂',
      target: '.sidebar',
      btnTarget: null
    },
    {
      title: '期間で整理',
      content: 'タスクは<hl>今日・1週間・1ヶ月・1年・計画</hl>の5つで管理。\n<hl>リスト/ボード/カレンダー</hl>の3つの表示形式に切替可能。',
      icon: '📅',
      target: '.timeframe-tabs',
      btnTarget: null
    },
    {
      title: 'AI計画生成',
      content: '下に表示されているのは<hl>実際の生成例</hl>です。\n\n（スクロールして見てみてね）\n\n<hl>現在地点・到達目標・ギャップ分析</hl>、\n達成可能性、リスク・コスト、参考リソースを自動生成します。\n\n<hl>Tavily APIキー</hl>（無料）を設定すると、\nウェブ検索で精度の高い計画を生成できます。',
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
      content: 'AIキャラクターがリマインドしてくれます。\n\n<hl>「人格」タブ</hl>でプリセットを選択、\nまたはカスタム人格を作成できます。\n\n<hl>Discord連携</hl>でDM通知も可能です。',
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
      <Sidebar
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        activeView={activeView}
        setActiveView={setActiveView}
        currentTimeframe={currentTimeframe}
        setCurrentTimeframe={setCurrentTimeframe}
        selectedLabel={selectedLabel}
        setSelectedLabel={setSelectedLabel}
        labelFilter={labelFilter}
        setLabelFilter={setLabelFilter}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        todos={todos}
        projects={projects}
        allLabels={allLabels}
        labelDefinitions={labelDefinitions}
        customFilters={customFilters}
        activeCustomFilter={activeCustomFilter}
        karma={karma}
        setShowKarmaModal={setShowKarmaModal}
        setShowProjectModal={setShowProjectModal}
        setShowLabelModal={setShowLabelModal}
        setShowFilterModal={setShowFilterModal}
        setShowCalendar={setShowCalendar}
        setShowActivityModal={setShowActivityModal}
        setShowSettings={setShowSettings}
        setShowHelp={setShowHelp}
        setNewProjectParentId={setNewProjectParentId}
        toggleProjectFavorite={toggleProjectFavorite}
        deleteProject={handleDeleteProject}
        deleteCustomFilter={deleteCustomFilter}
        applyCustomFilter={applyCustomFilter}
        getFavoriteProjects={getFavoriteProjects}
        getSubProjects={getSubProjects}
        getLevelName={getLevelName}
      />

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
              <button className={'timeframe-tab' + (currentTimeframe === 'year' ? ' active' : '')} onClick={() => setCurrentTimeframe('year')}>
                1年
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
            <div className="quick-add-main">
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
              {input.trim() && !decomposeError && (
                <button className="quick-add-submit" onClick={addTodo} disabled={isAddingTodo}>
                  追加
                </button>
              )}
            </div>
            {decomposeError && <span className="quick-add-error">{decomposeError}</span>}
            <div className="quick-add-options">
                <div className="quick-add-option">
                  <label className="quick-add-option-label">🔄 繰り返し</label>
                  <select
                    className="quick-add-recurrence"
                    value={addRecurrenceType}
                    onChange={e => {
                      const newType = e.target.value as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
                      setAddRecurrenceType(newType)
                      // 繰り返しタイプ変更時に期限をクリア
                      if (newType !== 'none') {
                        clearAddDueDate()
                      }
                    }}
                  >
                    <option value="none">なし</option>
                    <option value="daily">毎日</option>
                    <option value="weekly">毎週</option>
                    <option value="monthly">毎月</option>
                    <option value="yearly">毎年</option>
                  </select>
                </div>
                {/* 毎週の場合は曜日選択 */}
                {addRecurrenceType === 'weekly' && (
                  <div className="quick-add-option">
                    <label className="quick-add-option-label">📆 曜日</label>
                    <select
                      className="quick-add-weekday"
                      value={addWeeklyDay}
                      onChange={e => setAddWeeklyDay(Number(e.target.value))}
                    >
                      <option value={1}>月曜日</option>
                      <option value={2}>火曜日</option>
                      <option value={3}>水曜日</option>
                      <option value={4}>木曜日</option>
                      <option value={5}>金曜日</option>
                      <option value={6}>土曜日</option>
                      <option value={0}>日曜日</option>
                    </select>
                  </div>
                )}
                {/* 毎月の場合は日付選択 */}
                {addRecurrenceType === 'monthly' && (
                  <div className="quick-add-option">
                    <label className="quick-add-option-label">📆 日付</label>
                    <select
                      className="quick-add-monthday"
                      value={addMonthlyDay}
                      onChange={e => setAddMonthlyDay(Number(e.target.value))}
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                        <option key={day} value={day}>{day}日</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 毎年の場合は月と日付選択 */}
                {addRecurrenceType === 'yearly' && (
                  <>
                    <div className="quick-add-option">
                      <label className="quick-add-option-label">📆 月</label>
                      <select
                        className="quick-add-yearmonth"
                        value={addYearlyMonth}
                        onChange={e => setAddYearlyMonth(Number(e.target.value))}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>{month}月</option>
                        ))}
                      </select>
                    </div>
                    <div className="quick-add-option">
                      <label className="quick-add-option-label">日付</label>
                      <select
                        className="quick-add-yearday"
                        value={addYearlyDay}
                        onChange={e => setAddYearlyDay(Number(e.target.value))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{day}日</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {/* 時間選択（繰り返しタスクの場合のみ） */}
                {addRecurrenceType !== 'none' && (
                  <div className="quick-add-option">
                    <label className="quick-add-option-label">⏰ 時間</label>
                    <input
                      type="time"
                      className="quick-add-due-time"
                      value={addDueTime}
                      onChange={e => setAddDueTime(e.target.value)}
                    />
                  </div>
                )}
                {/* 通常タスクの期限 */}
                {addRecurrenceType === 'none' && (
                  <div className="quick-add-option">
                    <span className="quick-add-option-label">📅 期限</span>
                    <div className="date-input-group">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="date-input-year"
                        placeholder="yyyy"
                        maxLength={4}
                        value={addDueDateYear}
                        onChange={e => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                          setAddDueDateYear(v)
                          if (v.length === 4) dueDateMonthRef.current?.focus()
                        }}
                      />
                      <span className="date-separator">/</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="date-input-month"
                        placeholder="mm"
                        maxLength={2}
                        ref={dueDateMonthRef}
                        value={addDueDateMonth}
                        onChange={e => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                          setAddDueDateMonth(v)
                          if (v.length === 2 || (v.length === 1 && parseInt(v) > 1)) dueDateDayRef.current?.focus()
                        }}
                      />
                      <span className="date-separator">/</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="date-input-day"
                        placeholder="dd"
                        maxLength={2}
                        ref={dueDateDayRef}
                        value={addDueDateDay}
                        onChange={e => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                          setAddDueDateDay(v)
                        }}
                      />
                    </div>
                    <input
                      type="time"
                      className="quick-add-due-time"
                      value={addDueTime}
                      onChange={e => setAddDueTime(e.target.value)}
                    />
                    {hasValidDueDate && (
                      <button
                        type="button"
                        className="quick-add-clear-btn"
                        onClick={clearAddDueDate}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
                <span className="quick-add-options-hint">
                  テキストで「明日」「毎日」などと入力しても自動認識されます
                </span>
              </div>
          </div>
        )}

        {/* 計画ビュー */}
        {currentTimeframe === 'plan' && (
          <div className="plan-view">
            <div className="plan-input-section">
              <h3>目標を入力</h3>
              <p className="plan-description">達成したい目標を自由に書いてください。AIが具体的なタスクとスケジュールを提案します。</p>
              <div className="plan-target-date-section">
                <label className="plan-target-label">目標達成期間:</label>
                <select
                  className="plan-target-select"
                  value={planTargetPreset}
                  onChange={e => {
                    const value = e.target.value
                    setPlanTargetPreset(value)
                    if (value !== 'custom') {
                      setPlanTargetDays(Number(value))
                      setPlanCustomDate('')
                    }
                  }}
                >
                  <option value="7">1週間</option>
                  <option value="14">2週間</option>
                  <option value="30">1ヶ月</option>
                  <option value="60">2ヶ月</option>
                  <option value="90">3ヶ月</option>
                  <option value="180">6ヶ月</option>
                  <option value="365">1年</option>
                  <option value="custom">カスタム</option>
                </select>
                {planTargetPreset === 'custom' ? (
                  <input
                    type="date"
                    className="plan-target-date-input"
                    value={planCustomDate}
                    min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    onChange={e => {
                      const dateValue = e.target.value
                      setPlanCustomDate(dateValue)
                      if (dateValue) {
                        const selectedDate = new Date(dateValue)
                        const today = new Date()
                        today.setHours(0, 0, 0, 0)
                        const diffTime = selectedDate.getTime() - today.getTime()
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                        setPlanTargetDays(Math.max(1, diffDays))
                      }
                    }}
                  />
                ) : (
                  <span className="plan-target-hint">
                    （{new Date(Date.now() + planTargetDays * 24 * 60 * 60 * 1000).toLocaleDateString('ja-JP')}まで）
                  </span>
                )}
                {planTargetPreset === 'custom' && planCustomDate && (
                  <span className="plan-target-hint">
                    （残り{planTargetDays}日）
                  </span>
                )}
              </div>
              <div className="plan-input-wrapper">
                <textarea
                  className="plan-goal-input"
                  placeholder="例：TOEIC 800点を取る、ポートフォリオサイトを作る、引越しの準備をする（Ctrl+Enterで生成）"
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
                        const result = await generatePlan(trimmedGoal, planTargetDays, webContext)
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
                      const result = await generatePlan(trimmedGoal, planTargetDays, webContext)
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
                            {resource.url && (
                              <button
                                className="resource-link-btn"
                                onClick={() => openExternalLink(resource.url!)}
                                title="リンクを開く"
                              >
                                開く →
                              </button>
                            )}
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
                            {task.recurrence && (
                              <span className={`plan-task-recurrence recurrence-${task.recurrence.type}`}>
                                {task.recurrence.type === 'daily' ? '🔄毎日' :
                                 task.recurrence.type === 'weekly' ? '🔄毎週' :
                                 task.recurrence.type === 'monthly' ? '🔄毎月' : '🔄毎年'}
                              </span>
                            )}
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
                        <label className="plan-label-label">共通ラベル</label>
                        <div className="plan-label-input-row">
                          <span className="plan-label-prefix">#</span>
                          <input
                            type="text"
                            className="plan-label-input"
                            placeholder="空欄で「未設定」"
                            value={planLabel}
                            onChange={e => { setPlanLabel(e.target.value.replace(/^#/, '')); setPlanError('') }}
                          />
                        </div>
                      </div>
                      <div className="plan-project-select-wrapper">
                        <label className="plan-label-label">プロジェクト</label>
                        {!showNewProjectInPlan ? (
                          <div className="plan-project-row">
                            <select
                              className="plan-project-select"
                              value={planProjectId || ''}
                              onChange={e => { setPlanProjectId(e.target.value || null); setPlanError('') }}
                            >
                              <option value="">未設定</option>
                              {projects.filter(p => !p.isArchived).map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="plan-new-project-btn"
                              onClick={() => setShowNewProjectInPlan(true)}
                              title="新規プロジェクト作成"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <div className="plan-new-project-input-row">
                            <input
                              type="text"
                              className="plan-new-project-input"
                              placeholder="プロジェクト名"
                              value={newProjectNameInPlan}
                              onChange={e => setNewProjectNameInPlan(e.target.value)}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="plan-new-project-confirm-btn"
                              onClick={() => {
                                const name = newProjectNameInPlan.trim()
                                if (!name) {
                                  setShowNewProjectInPlan(false)
                                  setNewProjectNameInPlan('')
                                  return
                                }
                                const newProject: Project = {
                                  id: crypto.randomUUID(),
                                  name,
                                  color: '#6366f1',
                                  order: projects.length,
                                  parentId: null,
                                  isFavorite: false,
                                  isArchived: false,
                                }
                                const updated = [...projects, newProject]
                                setProjects(updated)
                                saveProjects(updated)
                                setPlanProjectId(newProject.id)
                                setShowNewProjectInPlan(false)
                                setNewProjectNameInPlan('')
                              }}
                              disabled={!newProjectNameInPlan.trim()}
                            >
                              作成
                            </button>
                            <button
                              type="button"
                              className="plan-new-project-cancel-btn"
                              onClick={() => {
                                setShowNewProjectInPlan(false)
                                setNewProjectNameInPlan('')
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="plan-label-hint">空欄の場合は「未設定」ラベルが自動で付与されます</span>
                    <button
                      className="plan-add-tasks-btn"
                      onClick={() => {
                        const selectedTasks = planTasks.filter(t => t.selected)
                        if (selectedTasks.length === 0) {
                          setPlanError('追加するタスクを選択してください')
                          return
                        }

                        const today = new Date()
                        today.setHours(0, 0, 0, 0)

                        // 空欄の場合は「未設定」（重複時は「未設定 1」等）
                        const labelName = planLabel.trim() || getUniqueLabelName('未設定', todos)
                        const taskLabels = [labelName]

                        const newTodos: Todo[] = selectedTasks.map((task, index) => {
                          // 繰り返しタスクの変換
                          let recurrence: RecurrencePattern | null = null
                          let finalDueDate: number
                          let timeframe: Timeframe

                          if (task.recurrence) {
                            // 繰り返しタスク用のRecurrencePatternを作成
                            recurrence = {
                              type: task.recurrence.type,
                              interval: task.recurrence.interval || 1,
                            }

                            // 繰り返しタイプに応じた期日と時間枠を設定
                            const now = new Date()
                            if (task.recurrence.type === 'daily') {
                              // 毎日タスク：今日の23:59
                              const targetDate = new Date(now)
                              targetDate.setHours(23, 59, 0, 0)
                              finalDueDate = targetDate.getTime()
                              timeframe = 'today'
                            } else if (task.recurrence.type === 'weekly') {
                              // 毎週タスク：指定曜日の23:59
                              const targetDay = task.recurrence.dayOfWeek ?? now.getDay()
                              const daysUntilTarget = (targetDay - now.getDay() + 7) % 7 || 7
                              const targetDate = new Date(now)
                              targetDate.setDate(now.getDate() + daysUntilTarget)
                              targetDate.setHours(23, 59, 0, 0)
                              finalDueDate = targetDate.getTime()
                              timeframe = 'week'
                            } else if (task.recurrence.type === 'monthly') {
                              // 毎月タスク：指定日の23:59
                              const targetDay = task.recurrence.dayOfMonth ?? 1
                              const targetDate = new Date(now.getFullYear(), now.getMonth(), targetDay, 23, 59, 0, 0)
                              if (targetDate.getTime() < now.getTime()) {
                                targetDate.setMonth(targetDate.getMonth() + 1)
                              }
                              finalDueDate = targetDate.getTime()
                              timeframe = 'month'
                            } else {
                              // 毎年タスク：指定日の23:59
                              const targetMonth = (task.recurrence.monthOfYear ?? 1) - 1
                              const targetDay = task.recurrence.dayOfYear ?? 1
                              const targetDate = new Date(now.getFullYear(), targetMonth, targetDay, 23, 59, 0, 0)
                              if (targetDate.getTime() < now.getTime()) {
                                targetDate.setFullYear(targetDate.getFullYear() + 1)
                              }
                              finalDueDate = targetDate.getTime()
                              timeframe = 'year'
                            }
                          } else {
                            // 通常タスク
                            const dueDate = new Date(today)
                            dueDate.setDate(dueDate.getDate() + task.daysFromStart)
                            // 今日中のタスクは23:59を期限に
                            if (task.daysFromStart === 0) {
                              dueDate.setHours(23, 59, 0, 0)
                            }
                            finalDueDate = dueDate.getTime()
                            timeframe =
                              task.daysFromStart === 0 ? 'today' :
                              task.daysFromStart <= 7 ? 'week' :
                              task.daysFromStart <= 31 ? 'month' : 'year'
                          }

                          const priority: Priority = task.priority === 'high' ? 1 : task.priority === 'medium' ? 2 : 3

                          return {
                            id: Date.now().toString() + Math.random().toString(36).slice(2) + index,
                            text: task.title,
                            completed: false,
                            completedAt: null,
                            createdAt: Date.now() + index,
                            parentId: null,
                            priority,
                            timeframe,
                            dueDate: finalDueDate,
                            dueDateNotification: { enabled: true, notifyBefore: 0, notifiedAt: null, followUpCount: 0 },
                            labels: taskLabels,
                            recurrence,
                            description: task.description,
                            sectionId: null,
                            order: todos.length + index,
                            estimatedMinutes: task.estimatedMinutes || null,
                            comments: [],
                            projectId: planProjectId,  // nullも許可
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
                        setShowNewProjectInPlan(false)
                        setNewProjectNameInPlan('')
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
          <BoardView
            displayTodos={displayTodos}
            labelDefinitions={labelDefinitions}
            toggleTodo={toggleTodo}
            priorityColor={priorityColor}
            formatDueDate={formatDueDate}
            isDueDateOverdue={isDueDateOverdue}
          />
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
                                {todo.labels.map((label, i) => {
                                  const def = labelDefinitions.find(ld => ld.name === label)
                                  return <span key={i} className="label-badge-small" style={def?.color ? { backgroundColor: def.color } : undefined}>#{label}</span>
                                })}
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
          ) : currentTimeframe === 'plan' ? null : (() => {
            const allTasks = buildTree(null).filter(t => !isHidden(t))

            // 各タブに対応する繰り返しタイプを取得
            const getRecurrenceTypeForTimeframe = (tf: Timeframe): 'daily' | 'weekly' | 'monthly' | 'yearly' | null => {
              switch (tf) {
                case 'today': return 'daily'
                case 'week': return 'weekly'
                case 'month': return 'monthly'
                case 'year': return 'yearly'
                default: return null
              }
            }

            const recurrenceType = getRecurrenceTypeForTimeframe(currentTimeframe as Timeframe)
            const recurringTasks = recurrenceType ? allTasks.filter(t => t.recurrence?.type === recurrenceType) : []
            const regularTasks = recurrenceType ? allTasks.filter(t => t.recurrence?.type !== recurrenceType) : allTasks

            // セクションタイトルを取得
            const getRecurringSectionTitle = (tf: Timeframe): { icon: string; title: string } => {
              switch (tf) {
                case 'today': return { icon: '🔄', title: '毎日のタスク' }
                case 'week': return { icon: '📅', title: '毎週のタスク' }
                case 'month': return { icon: '📆', title: '毎月のタスク' }
                case 'year': return { icon: '🗓️', title: '毎年のタスク' }
                default: return { icon: '🔄', title: '繰り返しタスク' }
              }
            }

            const getRegularSectionTitle = (tf: Timeframe): { icon: string; title: string } => {
              switch (tf) {
                case 'today': return { icon: '📋', title: '今日のタスク' }
                case 'week': return { icon: '📋', title: '今週のタスク' }
                case 'month': return { icon: '📋', title: '今月のタスク' }
                case 'year': return { icon: '📋', title: '今年のタスク' }
                default: return { icon: '📋', title: 'タスク' }
              }
            }

            const recurringSection = getRecurringSectionTitle(currentTimeframe as Timeframe)
            const regularSection = getRegularSectionTitle(currentTimeframe as Timeframe)

            const renderTodoItem = (todo: Todo) => {
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
                {todo.recurrence && (
                  <span className={`recurrence-badge recurrence-${todo.recurrence.type}`} title={formatRecurrence(todo.recurrence)}>
                    {todo.recurrence.type === 'daily' ? '毎日' : todo.recurrence.type === 'weekly' ? '毎週' : todo.recurrence.type === 'monthly' ? '毎月' : '毎年'}
                  </span>
                )}
                <button className={'priority-badge priority-' + priorityColor(todo.priority)} onClick={() => cyclePriority(todo.id)} title="優先度を変更">{priorityLabel(todo.priority)}</button>
                {todo.parentId === null && (
                  <button className={'timeframe-badge timeframe-' + todo.timeframe} onClick={() => cycleTimeframe(todo.id)} title="期間を変更">{timeframeLabel(todo.timeframe)}</button>
                )}
                {todo.parentId === null && (
                  <button className={'due-date-btn' + (todo.dueDate ? (isDueDateOverdue(todo.dueDate) && !todo.completed ? ' overdue' : ' has-due-date') : '')} onClick={() => openDueDateModal(todo.id)} title={todo.dueDate ? `期日: ${formatDueDate(todo.dueDate, todo.recurrence)}` : '期日を設定'}>
                    📅{todo.dueDate && <span className="due-date-text">{formatDueDate(todo.dueDate, todo.recurrence)}</span>}
                  </button>
                )}
                {editingId === todo.id ? (
                  <input type="text" className="edit-input" value={editText} onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                    onBlur={saveEdit} autoFocus />
                ) : (
                  <span className="todo-text" onDoubleClick={() => startEdit(todo)}>
                    {todo.text}
                  </span>
                )}
                <div className="labels-inline">
                  {todo.labels && todo.labels.map((label, i) => {
                    const def = labelDefinitions.find(ld => ld.name === label)
                    return (
                      <span key={i} className="label-tag" style={def?.color ? { backgroundColor: def.color } : undefined}>
                        <span className="label-text" onClick={(e) => { e.stopPropagation(); setLabelFilter(label); }}>#{label}</span>
                        <button className="label-remove" onClick={(e) => { e.stopPropagation(); removeLabelFromTodo(todo.id, label); }} title="ラベルを削除">×</button>
                      </span>
                    )
                  })}
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
                <button className={'ai-btn' + (decomposing === todo.id ? ' decomposing' : '')} onClick={() => handleDecompose(todo)} disabled={decomposing === todo.id || todo.completed} title={decomposing === todo.id ? '検索・分解中...' : 'AIで分解'}>
                  {decomposing === todo.id ? '🔄' : '✨'}
                </button>
                <button className="delete-btn" onClick={() => requestDeleteTodo(todo.id)}>×</button>
              </li>
            )
            }

            return (
              <>
                {/* 繰り返しタスクセクション */}
                {recurringTasks.length > 0 && (
                  <>
                    <li className="section-header recurring-section-header">
                      <span className="section-icon">{recurringSection.icon}</span>
                      <span className="section-title">{recurringSection.title}</span>
                      <span className="section-count">{recurringTasks.length}</span>
                    </li>
                    {recurringTasks.map(renderTodoItem)}
                  </>
                )}
                {/* 通常タスクセクション - 常に表示 */}
                {regularTasks.length > 0 && (
                  <>
                    <li className="section-header regular-section-header">
                      <span className="section-icon">{regularSection.icon}</span>
                      <span className="section-title">{regularSection.title}</span>
                      <span className="section-count">{regularTasks.length}</span>
                    </li>
                    {regularTasks.map(renderTodoItem)}
                  </>
                )}
              </>
            )
          })()}
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

      {/* ラベル定義追加モーダル（サイドバーから） */}
      {showLabelModal && !labelTodoId && (
        <div className="modal-overlay" onClick={() => { setShowLabelModal(false); setNewLabelName(''); setNewLabelColor(LABEL_COLORS[0]); }}>
          <div className="modal label-modal" onClick={e => e.stopPropagation()}>
            <h2>新しいラベル</h2>
            <p className="modal-description">色付きのラベルを作成できます</p>
            <input
              type="text"
              className="label-input"
              placeholder="ラベル名..."
              value={newLabelName}
              onChange={e => setNewLabelName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newLabelName.trim()) {
                  const newDef: LabelDefinition = {
                    id: crypto.randomUUID(),
                    name: newLabelName.trim(),
                    color: newLabelColor,
                    order: labelDefinitions.length,
                  }
                  const updated = [...labelDefinitions, newDef]
                  setLabelDefinitions(updated)
                  saveLabelDefinitions(updated)
                  if (!savedLabels.includes(newLabelName.trim())) {
                    const updatedLabels = [...savedLabels, newLabelName.trim()].sort()
                    setSavedLabels(updatedLabels)
                    saveLabels(updatedLabels)
                  }
                  setShowLabelModal(false)
                  setNewLabelName('')
                  setNewLabelColor(LABEL_COLORS[0])
                }
              }}
              autoFocus
              style={{ marginBottom: 'var(--space-md)' }}
            />
            <div className="project-color-picker" style={{ marginBottom: 'var(--space-lg)' }}>
              <label>色:</label>
              <div className="color-options">
                {LABEL_COLORS.map(color => (
                  <button
                    key={color}
                    className={'color-option' + (newLabelColor === color ? ' active' : '')}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewLabelColor(color)}
                  />
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => { setShowLabelModal(false); setNewLabelName(''); setNewLabelColor(LABEL_COLORS[0]); }}>キャンセル</button>
              <button className="modal-btn primary" disabled={!newLabelName.trim()} onClick={() => {
                const newDef: LabelDefinition = {
                  id: crypto.randomUUID(),
                  name: newLabelName.trim(),
                  color: newLabelColor,
                  order: labelDefinitions.length,
                }
                const updated = [...labelDefinitions, newDef]
                setLabelDefinitions(updated)
                saveLabelDefinitions(updated)
                if (!savedLabels.includes(newLabelName.trim())) {
                  const updatedLabels = [...savedLabels, newLabelName.trim()].sort()
                  setSavedLabels(updatedLabels)
                  saveLabels(updatedLabels)
                }
                setShowLabelModal(false)
                setNewLabelName('')
                setNewLabelColor(LABEL_COLORS[0])
              }}>作成</button>
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
                {todos.find(t => t.id === labelTodoId)?.labels.map((label, i) => {
                  const def = labelDefinitions.find(ld => ld.name === label)
                  return (
                    <span key={i} className="current-label-tag" style={def?.color ? { backgroundColor: def.color } : undefined}>
                      #{label}
                      <button className="current-label-remove" onClick={() => removeLabelFromTodo(labelTodoId, label)}>×</button>
                    </span>
                  )
                })}
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

      {showDueDateModal && dueDateTodoId && (
        <div className="modal-overlay" onClick={() => setShowDueDateModal(false)}>
          <div className="modal due-date-modal" onClick={e => e.stopPropagation()}>
            <h2>期日設定</h2>
            <p className="modal-description">タスクの期日と通知を設定します。</p>

            {/* 繰り返し設定（先に表示） */}
            <div className="recurrence-settings">
              <label className="setting-label">繰り返し:</label>
              <select
                className="recurrence-select"
                value={dueDateRecurrenceType}
                onChange={e => {
                  setDueDateRecurrenceType(e.target.value as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly')
                  if (e.target.value !== 'weekly') setDueDateRecurrenceDays([])
                }}
              >
                <option value="none">なし（単発）</option>
                <option value="daily">毎日</option>
                <option value="weekly">毎週</option>
                <option value="monthly">毎月</option>
                <option value="yearly">毎年</option>
              </select>
            </div>

            {/* 通常タスクの場合：datetime-local */}
            {dueDateRecurrenceType === 'none' && (
              <input
                type="datetime-local"
                className="due-date-input"
                value={dueDateInput}
                onChange={e => setDueDateInput(e.target.value)}
              />
            )}

            {/* 繰り返しタスクの場合：タスク入力画面と同様のUI */}
            {dueDateRecurrenceType !== 'none' && (
              <div className="recurrence-datetime-settings">
                {/* 毎週の場合：曜日選択 */}
                {dueDateRecurrenceType === 'weekly' && (
                  <div className="recurrence-option">
                    <label className="recurrence-option-label">📅 曜日</label>
                    <div className="weekday-picker">
                      {['日', '月', '火', '水', '木', '金', '土'].map((day, index) => (
                        <label key={index} className={`weekday-btn ${dueDateRecurrenceDays.includes(index) ? 'active' : ''}`}>
                          <input
                            type="checkbox"
                            checked={dueDateRecurrenceDays.includes(index)}
                            onChange={e => {
                              if (e.target.checked) {
                                setDueDateRecurrenceDays([...dueDateRecurrenceDays, index].sort())
                              } else {
                                setDueDateRecurrenceDays(dueDateRecurrenceDays.filter(d => d !== index))
                              }
                            }}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 毎月の場合：日付選択 */}
                {dueDateRecurrenceType === 'monthly' && (
                  <div className="recurrence-option">
                    <label className="recurrence-option-label">📆 日付</label>
                    <select
                      className="recurrence-day-select"
                      value={dueDateMonthlyDay}
                      onChange={e => setDueDateMonthlyDay(Number(e.target.value))}
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                        <option key={day} value={day}>{day}日</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 毎年の場合：月と日付選択 */}
                {dueDateRecurrenceType === 'yearly' && (
                  <>
                    <div className="recurrence-option">
                      <label className="recurrence-option-label">📆 月</label>
                      <select
                        className="recurrence-month-select"
                        value={dueDateYearlyMonth}
                        onChange={e => setDueDateYearlyMonth(Number(e.target.value))}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>{month}月</option>
                        ))}
                      </select>
                    </div>
                    <div className="recurrence-option">
                      <label className="recurrence-option-label">日付</label>
                      <select
                        className="recurrence-day-select"
                        value={dueDateYearlyDay}
                        onChange={e => setDueDateYearlyDay(Number(e.target.value))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{day}日</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {/* 時間選択（繰り返しタスク共通） */}
                <div className="recurrence-option">
                  <label className="recurrence-option-label">⏰ 時間</label>
                  <input
                    type="time"
                    className="recurrence-time-input"
                    value={dueDateRecurrenceTime}
                    onChange={e => setDueDateRecurrenceTime(e.target.value)}
                  />
                </div>

                <p className="recurrence-hint">
                  繰り返しタスクは専用のリマインドメッセージで通知されます
                </p>
              </div>
            )}

            <div className="notification-settings">
              <label className="notify-checkbox">
                <input
                  type="checkbox"
                  checked={dueDateNotifyEnabled}
                  onChange={e => setDueDateNotifyEnabled(e.target.checked)}
                />
                期日に通知する
              </label>
              {dueDateNotifyEnabled && (
                <div className="notify-before-setting">
                  <span>通知タイミング:</span>
                  <select
                    value={dueDateNotifyBefore}
                    onChange={e => setDueDateNotifyBefore(Number(e.target.value))}
                  >
                    <option value={0}>期限ちょうど</option>
                    <option value={15}>15分前</option>
                    <option value={30}>30分前</option>
                    <option value={60}>1時間前</option>
                    <option value={120}>2時間前</option>
                    <option value={360}>6時間前</option>
                    <option value={720}>12時間前</option>
                    <option value={1440}>1日前</option>
                  </select>
                </div>
              )}
            </div>
            <div className="modal-actions">
              {todos.find(t => t.id === dueDateTodoId)?.dueDate && (
                <button className="modal-btn danger" onClick={() => clearDueDate(dueDateTodoId)}>削除</button>
              )}
              <button className="modal-btn secondary" onClick={() => setShowDueDateModal(false)}>キャンセル</button>
              <button
                className="modal-btn primary"
                onClick={setDueDate}
                disabled={
                  dueDateRecurrenceType === 'none' ? !dueDateInput :
                  dueDateRecurrenceType === 'weekly' ? dueDateRecurrenceDays.length === 0 :
                  false
                }
              >設定</button>
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
                  <li><strong>📅 期日:</strong> 期日と通知を設定</li>
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
                  <li><strong>1ヶ月:</strong> 1ヶ月以内のタスク</li>
                  <li><strong>1年:</strong> 長期的なタスク</li>
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
                <h3>期日通知</h3>
                <ul className="help-list">
                  <li><strong>通知タイミング:</strong> 期限ちょうどまたは指定時間前に通知</li>
                  <li><strong>AI人格:</strong> 設定でAI人格を選択すると、パーソナライズされた通知が届きます</li>
                  <li><strong>Discord連携:</strong> Discord DMでも通知を受け取れます</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>AI機能（設定でAPIキー登録）</h3>
                <ul className="help-list">
                  <li><strong>対応サービス:</strong> OpenAI / Claude / Gemini</li>
                  <li><strong>モデル選択:</strong> 設定 → モデル設定で変更</li>
                  <li><strong>タスク分解:</strong> ✨ボタンでサブタスクに自動分解</li>
                  <li><strong>計画生成:</strong> 計画タブで目標から計画を作成</li>
                  <li><strong>AI人格:</strong> 設定 → 人格で選択</li>
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

            {/* GitHub-style Contribution Graph */}
            <div className="contribution-graph">
              <h3 className="contribution-title">タスク完了ロードマップ</h3>
              <div className="contribution-wrapper">
                <div className="contribution-months">
                  {(() => {
                    const months: string[] = []
                    const today = new Date()
                    for (let i = 11; i >= 0; i--) {
                      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
                      months.push(['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'][d.getMonth()])
                    }
                    return months.map((m, i) => <span key={i} className="contribution-month">{m}</span>)
                  })()}
                </div>
                <div className="contribution-content">
                  <div className="contribution-days-label">
                    <span>月</span>
                    <span>水</span>
                    <span>金</span>
                  </div>
                  <div className="contribution-grid">
                    {(() => {
                      const data = getContributionData(todos)
                      // 週ごとにグループ化（日曜始まり）
                      const weeks: { date: Date; count: number }[][] = []
                      let currentWeek: { date: Date; count: number }[] = []

                      // 最初の週の空白を埋める
                      const firstDayOfWeek = data[0].date.getDay()
                      for (let i = 0; i < firstDayOfWeek; i++) {
                        currentWeek.push({ date: new Date(0), count: -1 }) // -1 = empty
                      }

                      data.forEach((d) => {
                        currentWeek.push(d)
                        if (currentWeek.length === 7) {
                          weeks.push(currentWeek)
                          currentWeek = []
                        }
                      })
                      if (currentWeek.length > 0) {
                        weeks.push(currentWeek)
                      }

                      return weeks.map((week, wi) => (
                        <div key={wi} className="contribution-week">
                          {week.map((day, di) => (
                            <div
                              key={di}
                              className={`contribution-cell level-${day.count === -1 ? 'empty' : getContributionLevel(day.count)}`}
                              title={day.count === -1 ? '' : `${day.date.getMonth() + 1}/${day.date.getDate()}: ${day.count}件完了`}
                            />
                          ))}
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              </div>
              <div className="contribution-legend">
                <span className="contribution-legend-label">少</span>
                <div className="contribution-cell level-0" />
                <div className="contribution-cell level-1" />
                <div className="contribution-cell level-2" />
                <div className="contribution-cell level-3" />
                <div className="contribution-cell level-4" />
                <span className="contribution-legend-label">多</span>
              </div>
            </div>

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
                          <button className="calendar-export-btn" onClick={() => { const url = getGoogleCalendarURL(todo); if (url) openExternalLink(url) }} title="Googleカレンダーに追加">G</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="calendar-footer">
              <button className="modal-btn secondary" onClick={() => setShowImportModal(true)}>
                📤 ICSインポート
              </button>
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

      {/* ICSインポートモーダル */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => { setShowImportModal(false); setImportResult(null) }}>
          <div className="modal import-modal" onClick={e => e.stopPropagation()}>
            <h2>タスクをインポート</h2>
            <p className="modal-description">
              ICS形式のファイルからタスク（VTODO）をインポートします。
              カレンダー予定（VEVENT）はデフォルトでスキップされます。
            </p>

            <div className="import-instructions">
              <h4>エクスポート方法</h4>
              <ol>
                <li><button className="link-button" onClick={() => openExternalLink('https://calendar.google.com/calendar/u/0/r/settings/export')}>Googleカレンダーの設定 →</button> または他のカレンダーアプリからエクスポート</li>
                <li>ダウンロードした .ics ファイルを下で選択</li>
              </ol>
            </div>

            <div className="import-options">
              <label className="import-option">
                <input
                  type="checkbox"
                  checked={importOptions.importEvents}
                  onChange={e => setImportOptions(prev => ({ ...prev, importEvents: e.target.checked }))}
                />
                カレンダー予定（VEVENT）もインポート
              </label>
              <label className="import-option">
                <input
                  type="checkbox"
                  checked={importOptions.importPast}
                  onChange={e => setImportOptions(prev => ({ ...prev, importPast: e.target.checked }))}
                />
                過去のタスクもインポート
              </label>
              <label className="import-option">
                <input
                  type="checkbox"
                  checked={importOptions.importCompleted}
                  onChange={e => setImportOptions(prev => ({ ...prev, importCompleted: e.target.checked }))}
                />
                完了済みタスクもインポート
              </label>
            </div>

            <div className="import-dropzone">
              <input
                type="file"
                accept=".ics,.ical,text/calendar"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleICSImport(file)
                }}
                id="ics-file-input"
                style={{ display: 'none' }}
              />
              <label htmlFor="ics-file-input" className="dropzone-label">
                <span className="dropzone-icon">📁</span>
                <span className="dropzone-text">ICSファイルを選択</span>
                <span className="dropzone-hint">.ics または .ical ファイル</span>
              </label>
            </div>

            {importResult && (
              <div className={`import-result ${importResult.success ? 'success' : 'error'}`}>
                {importResult.success ? (
                  <>
                    <strong>{importResult.stats.imported}件のタスクをインポートしました</strong>
                    <p className="import-stats-detail">
                      ファイル内容: タスク {importResult.stats.totalTasks}件 / 予定 {importResult.stats.totalEvents}件
                    </p>
                    {importResult.stats.skipped > 0 && (
                      <p className="import-skipped">
                        {importResult.stats.skipped}件をスキップ
                        {importResult.stats.skippedReasons.isEvent > 0 && ` (予定: ${importResult.stats.skippedReasons.isEvent}件)`}
                        {importResult.stats.skippedReasons.past > 0 && ` (過去: ${importResult.stats.skippedReasons.past}件)`}
                        {importResult.stats.skippedReasons.completed > 0 && ` (完了済み: ${importResult.stats.skippedReasons.completed}件)`}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <strong>インポートできるタスクがありませんでした</strong>
                    <p className="import-stats-detail">
                      ファイル内容: タスク {importResult.stats.totalTasks}件 / 予定 {importResult.stats.totalEvents}件
                    </p>
                    {importResult.stats.totalTasks === 0 && importResult.stats.totalEvents > 0 && (
                      <p className="import-hint">
                        予定をインポートするには「カレンダー予定もインポート」にチェックを入れてください
                      </p>
                    )}
                    {importResult.stats.skipped > 0 && (
                      <p className="import-skipped">
                        {importResult.stats.skipped}件すべてスキップ
                        {importResult.stats.skippedReasons.isEvent > 0 && ` (予定: ${importResult.stats.skippedReasons.isEvent}件)`}
                        {importResult.stats.skippedReasons.past > 0 && ` (過去: ${importResult.stats.skippedReasons.past}件)`}
                        {importResult.stats.skippedReasons.completed > 0 && ` (完了済み: ${importResult.stats.skippedReasons.completed}件)`}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => { setShowImportModal(false); setImportResult(null) }}>閉じる</button>
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
                onKeyDown={e => e.key === 'Enter' && handleAddProject()}
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
              <button className="modal-btn primary" onClick={handleAddProject} disabled={!newProjectName.trim()}>作成</button>
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
      {showKarmaModal && (() => {
        const currentLevelStart = getPointsForCurrentLevel(karma.level)
        const nextLevelStart = getPointsForNextLevel(karma.level)
        const pointsInCurrentLevel = karma.totalPoints - currentLevelStart
        const pointsNeededForNext = nextLevelStart - currentLevelStart
        const progressPercent = karma.level >= 10 ? 100 : Math.min(100, (pointsInCurrentLevel / pointsNeededForNext) * 100)
        const pointsToNextLevel = karma.level >= 10 ? 0 : nextLevelStart - karma.totalPoints

        return (
        <div className="modal-overlay" onClick={() => setShowKarmaModal(false)}>
          <div className="modal karma-modal" onClick={e => e.stopPropagation()}>
            <div className="karma-modal-header">
              <h2>🏆 経験値システム</h2>
              <button className="modal-close-btn" onClick={() => setShowKarmaModal(false)} title="閉じる">×</button>
            </div>
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

              {/* プログレスバー */}
              <div className="karma-progress">
                <div className="progress-header">
                  <span className="progress-label">
                    {karma.level >= 10 ? '最高レベル達成！' : `次のレベル（Lv.${karma.level + 1} ${getLevelName(karma.level + 1)}）まで`}
                  </span>
                  <span className="progress-numbers">
                    {karma.level >= 10 ? '∞' : `あと ${pointsToNextLevel} pt`}
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
                </div>
                <div className="progress-detail">
                  {karma.level < 10 && <span>{pointsInCurrentLevel} / {pointsNeededForNext} pt</span>}
                </div>
              </div>

              {/* 統計 */}
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

              {/* ポイント計算ガイド */}
              <div className="karma-guide">
                <h3>📖 ポイント獲得ガイド</h3>
                <div className="guide-section">
                  <h4>優先度ボーナス（基本ポイント）</h4>
                  <div className="guide-table">
                    <div className="guide-row" style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto', gap: '8px' }}>
                      <span className="priority-badge priority-p1" style={{ opacity: 1 }}>P1</span>
                      <span style={{ color: 'var(--text-secondary)' }}>緊急</span>
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>10 pt</span>
                    </div>
                    <div className="guide-row" style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto', gap: '8px' }}>
                      <span className="priority-badge priority-p2" style={{ opacity: 1 }}>P2</span>
                      <span style={{ color: 'var(--text-secondary)' }}>高</span>
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>7 pt</span>
                    </div>
                    <div className="guide-row" style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto', gap: '8px' }}>
                      <span className="priority-badge priority-p3" style={{ opacity: 1 }}>P3</span>
                      <span style={{ color: 'var(--text-secondary)' }}>中</span>
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>5 pt</span>
                    </div>
                    <div className="guide-row" style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto', gap: '8px' }}>
                      <span className="priority-badge priority-p4" style={{ opacity: 1 }}>P4</span>
                      <span style={{ color: 'var(--text-secondary)' }}>低</span>
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>3 pt</span>
                    </div>
                  </div>
                </div>
                <div className="guide-section">
                  <h4>困難度ボーナス（所要時間）</h4>
                  <div className="guide-table">
                    <div className="guide-row"><span>〜15分</span><span>+2 pt</span></div>
                    <div className="guide-row"><span>16〜30分</span><span>+5 pt</span></div>
                    <div className="guide-row"><span>31〜60分</span><span>+12 pt</span></div>
                    <div className="guide-row"><span>1〜2時間</span><span>+25 pt</span></div>
                    <div className="guide-row"><span>2〜4時間</span><span>+45 pt</span></div>
                    <div className="guide-row"><span>4〜8時間</span><span>+80 pt</span></div>
                    <div className="guide-row"><span>8時間以上</span><span>+120 pt</span></div>
                  </div>
                </div>
                <div className="guide-section">
                  <h4>ストリークボーナス（連続日数）</h4>
                  <p className="guide-note">毎日タスクを完了すると +1〜7 pt（最大7日分）</p>
                  <p className="guide-note current-streak">現在のボーナス: +{Math.min(karma.streak, 7)} pt</p>
                </div>
              </div>

              {/* レベル一覧 */}
              <div className="karma-levels">
                <h3>🎖️ レベル一覧</h3>
                <div className="levels-table">
                  {LEVEL_THRESHOLDS.slice(1).map((threshold, i) => {
                    const level = i + 1
                    const isCurrentLevel = karma.level === level
                    const isAchieved = karma.level > level
                    return (
                      <div key={level} className={`level-row ${isCurrentLevel ? 'current' : ''} ${isAchieved ? 'achieved' : ''}`}>
                        <span className="level-info">
                          <span className="level-num">Lv.{level}</span>
                          <span className="level-name">{getLevelName(level)}</span>
                        </span>
                        <span className="level-threshold">
                          {level === 1 ? '0' : threshold} pt〜
                        </span>
                        {isCurrentLevel && <span className="level-badge">現在</span>}
                        {isAchieved && <span className="level-check">✓</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
        )
      })()}

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
