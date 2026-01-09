import { useState, useEffect } from 'react'
import { decomposeTask, getApiKey, setApiKey, clearApiKey, Subtask } from './lib/openai'
import { invoke } from '@tauri-apps/api/core'

type Timeframe = 'today' | 'week' | 'month'

interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: number
  parentId: string | null
  priority: "high" | "medium" | "low"
  group: string
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
}

const STORAGE_KEY = 'calm-todo-items'
const COLLAPSED_KEY = 'calm-todo-collapsed'
const INTRO_SEEN_KEY = 'calm-todo-intro-seen'

function loadTodos(): Todo[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    return parsed.map((t: Todo) => {
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
          weeklyReminder = { ...weeklyReminder, lastSent: weeklyReminder.times.reduce((acc, time) => ({ ...acc, [time]: oldLastSent }), {}) }
        }
      }
      return { ...t, parentId: t.parentId ?? null, priority: t.priority ?? 'medium', group: t.group ?? 'default', reminder: t.reminder ?? null, reminderSent: t.reminderSent ?? false, weeklyReminder, followUpCount: t.followUpCount ?? 0, lastNotifiedAt: t.lastNotifiedAt ?? null, timeframe: t.timeframe ?? 'today' }
    })
  } catch {
    return []
  }
}

function saveTodos(todos: Todo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
}

// Check if running in Tauri environment
const isTauri = () => {
  return typeof window !== 'undefined' &&
    (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window))
}

async function requestNotificationPermission(): Promise<boolean> {
  // Tauri notifications don't require permission on Windows
  return true
}

async function showNotification(title: string, body: string) {
  console.log('showNotification called, isTauri:', isTauri())
  if (isTauri()) {
    try {
      const result = await invoke<string>('show_notification', { title, body })
      console.log('Notification result:', result)
    } catch (e) {
      console.error('Notification error:', e)
    }
  } else {
    console.log('Not in Tauri environment')
  }
}

function loadCollapsed(): Set<string> {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY)
    return new Set(saved ? JSON.parse(saved) : [])
  } catch {
    return new Set()
  }
}

// 期間に基づいた自動リマインダー設定を生成
// 今日: 当日の12:00と18:00
// 1週間: 毎日12:00と18:00
// 1ヶ月: 毎日12:00
interface AutoReminderConfig {
  times: string[]  // リマインダー時刻の配列 "HH:MM"
  days: number[]   // 曜日の配列 (0=日, 1=月, ..., 6=土)
}

function getAutoReminderConfig(timeframe: Timeframe): AutoReminderConfig {
  const allDays = [0, 1, 2, 3, 4, 5, 6] // 毎日
  const today = new Date().getDay()

  if (timeframe === 'today') {
    // 今日: 当日の12:00と18:00
    return { times: ['12:00', '18:00'], days: [today] }
  } else if (timeframe === 'week') {
    // 1週間: 毎日12:00と18:00
    return { times: ['12:00', '18:00'], days: allDays }
  } else {
    // 1ヶ月: 毎日12:00
    return { times: ['12:00'], days: allDays }
  }
}

function saveCollapsed(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
}

async function saveBackup(todos: Todo[], collapsed: Set<string>) {
  try {
    await fetch('/api/backup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todos, collapsed: [...collapsed], savedAt: new Date().toISOString() })
    })
  } catch (e) {
    console.warn('Backup failed:', e)
  }
}

async function loadBackup(): Promise<{ todos: Todo[], collapsed: string[] } | null> {
  try {
    const res = await fetch('/api/backup/load')
    if (res.ok) {
      const data = await res.json()
      return data
    }
  } catch (e) {
    console.warn('Load backup failed:', e)
  }
  return null
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey() || '')
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
  const [currentGroup, setCurrentGroup] = useState('default')
  const [currentTimeframe, setCurrentTimeframe] = useState<Timeframe>('today')
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [reminderTodoId, setReminderTodoId] = useState<string | null>(null)
  const [reminderDateTime, setReminderDateTime] = useState('')
  const [reminderType, setReminderType] = useState<'once' | 'weekly'>('once')
  const [weeklyDays, setWeeklyDays] = useState<number[]>([])
  const [weeklyTime, setWeeklyTime] = useState('09:00')
  const [showHelp, setShowHelp] = useState(false)
  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem(INTRO_SEEN_KEY))
  const [introStep, setIntroStep] = useState(0)

  // Auto-restore from backup if localStorage is empty
  useEffect(() => {
    const autoRestore = async () => {
      const localTodos = loadTodos()
      if (localTodos.length === 0) {
        const backup = await loadBackup()
        if (backup && backup.todos && backup.todos.length > 0) {
          const migrated = backup.todos.map((t: Todo) => ({ ...t, parentId: t.parentId ?? null, priority: t.priority ?? 'medium', group: t.group ?? 'default', followUpCount: t.followUpCount ?? 0, lastNotifiedAt: t.lastNotifiedAt ?? null, timeframe: t.timeframe ?? 'today' }))
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

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // 急かす通知メッセージを生成
  const getUrgentMessage = (text: string, followUpCount: number): { title: string, body: string } => {
    const messages = [
      { title: '今すぐやって！', body: `「${text}」まだ終わってないよ？` },
      { title: 'まだやってないの？', body: `「${text}」早くやって！` },
      { title: 'おーい！', body: `「${text}」忘れてない？今すぐ！` },
      { title: '急いで！！', body: `「${text}」もう${followUpCount}回目だよ！` },
      { title: 'いい加減にして！', body: `「${text}」何回言わせるの？` },
      { title: '最後通告！', body: `「${text}」今すぐやらないと大変なことに！` },
    ]
    const index = Math.min(followUpCount, messages.length - 1)
    return messages[index]
  }

  // Check reminders every 10 seconds
  useEffect(() => {
    // 期間ごとの追い通知間隔
    const getFollowUpInterval = (timeframe: Timeframe): number => {
      if (timeframe === 'today') {
        return 12 * 60 * 60 * 1000 // 半日 (12時間)
      } else if (timeframe === 'week') {
        return 3.5 * 24 * 60 * 60 * 1000 // 3.5日
      } else {
        return 15 * 24 * 60 * 60 * 1000 // 半月 (15日)
      }
    }

    const checkReminders = async () => {
      const now = new Date()
      const nowTime = now.getTime()
      const todayStr = now.toISOString().slice(0, 10)
      const currentDay = now.getDay()
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

      console.log('Checking reminders at', now.toLocaleString(), 'currentTime:', currentTime)

      const todosToNotify: { id: string, type: 'once' | 'weekly' | 'followup', followUpCount: number }[] = []

      setTodos(prev => {
        const updated = prev.map(todo => {
          // One-time reminder check
          if (todo.reminder && !todo.reminderSent && !todo.completed) {
            console.log('Checking reminder for:', todo.text, 'reminder:', todo.reminder, 'now:', nowTime, 'due:', todo.reminder <= nowTime)
            if (todo.reminder <= nowTime) {
              console.log('Triggering one-time reminder for:', todo.text)
              todosToNotify.push({ id: todo.id, type: 'once', followUpCount: 0 })
              return { ...todo, reminderSent: true, followUpCount: 0, lastNotifiedAt: nowTime }
            }
          }
          // Weekly reminder check (multiple times support)
          if (todo.weeklyReminder && !todo.completed) {
            const { days, times, lastSent } = todo.weeklyReminder
            const lastSentMap = lastSent || {}

            // 各時刻をチェック
            for (const time of (times || [])) {
              const timeLastSent = lastSentMap[time]
              console.log('Weekly reminder check:', todo.text, 'days:', days, 'currentDay:', currentDay, 'time:', time, 'currentTime:', currentTime, 'lastSent:', timeLastSent)

              if (days.includes(currentDay) && currentTime >= time && timeLastSent !== todayStr) {
                console.log('Triggering weekly reminder for:', todo.text, 'at', time)
                todosToNotify.push({ id: todo.id, type: 'weekly', followUpCount: 0 })
                // この時刻の lastSent を更新
                const newLastSent = { ...lastSentMap, [time]: todayStr }
                return { ...todo, weeklyReminder: { ...todo.weeklyReminder, lastSent: newLastSent }, followUpCount: 0, lastNotifiedAt: nowTime }
              }
            }
          }
          // 追い通知チェック - 通知済みで未完了のタスク（期間に応じた間隔）
          const followUpInterval = getFollowUpInterval(todo.timeframe)
          if (todo.lastNotifiedAt && !todo.completed && (nowTime - todo.lastNotifiedAt) >= followUpInterval) {
            const newFollowUpCount = todo.followUpCount + 1
            console.log('Triggering follow-up notification for:', todo.text, 'count:', newFollowUpCount, 'interval:', followUpInterval / (60 * 60 * 1000), 'hours')
            todosToNotify.push({ id: todo.id, type: 'followup', followUpCount: newFollowUpCount })
            return { ...todo, followUpCount: newFollowUpCount, lastNotifiedAt: nowTime }
          }
          return todo
        })

        // Send notifications after state update
        todosToNotify.forEach(item => {
          const todo = updated.find(t => t.id === item.id)
          if (todo) {
            if (item.type === 'followup') {
              const msg = getUrgentMessage(todo.text, item.followUpCount)
              showNotification(msg.title, msg.body)
            } else {
              const msg = getUrgentMessage(todo.text, 0)
              showNotification(msg.title, msg.body)
            }
          }
        })

        return updated
      })
    }
    checkReminders()
    const interval = setInterval(checkReminders, 10000) // Check every 10 seconds
    return () => clearInterval(interval)
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
        setShowGroupModal(false)
        setShowDecomposeModal(false)
        setShowReminderModal(false)
        setShowHelp(false)
        setEditingId(null)
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const restoreFromBackup = async () => {
    const backup = await loadBackup()
    if (backup && backup.todos && backup.todos.length > 0) {
      const migrated = backup.todos.map((t: Todo) => ({ ...t, parentId: t.parentId ?? null, priority: t.priority ?? 'medium', group: t.group ?? 'default', followUpCount: t.followUpCount ?? 0, lastNotifiedAt: t.lastNotifiedAt ?? null, timeframe: t.timeframe ?? 'today' }))
      setTodos(migrated)
      if (backup.collapsed) {
        setCollapsed(new Set(backup.collapsed))
      }
    }
  }

  const groups = [...new Set(todos.map(t => t.group))].sort()
  if (!groups.includes('default')) groups.unshift('default')

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    const config = getAutoReminderConfig(currentTimeframe)
    const weeklyReminder = { days: config.days, time: config.times[0] || '12:00', times: config.times, lastSent: null }
    setTodos(prev => [{ id: crypto.randomUUID(), text, completed: false, createdAt: Date.now(), parentId: null, priority: 'medium', group: currentGroup, reminder: null, reminderSent: false, weeklyReminder, followUpCount: 0, lastNotifiedAt: null, timeframe: currentTimeframe }, ...prev])
    setInput('')
  }

  const toggleTodo = (id: string) => {
    setTodos(prev => {
      const target = prev.find(t => t.id === id)
      if (!target) return prev
      const newCompleted = !target.completed
      const getDescendantIds = (parentId: string): string[] => {
        const children = prev.filter(t => t.parentId === parentId)
        return children.flatMap(c => [c.id, ...getDescendantIds(c.id)])
      }
      const idsToToggle = new Set([id, ...getDescendantIds(id)])

      // まず対象タスクと子タスクを更新
      let updated = prev.map(todo => idsToToggle.has(todo.id) ? { ...todo, completed: newCompleted, followUpCount: newCompleted ? 0 : todo.followUpCount, lastNotifiedAt: newCompleted ? null : todo.lastNotifiedAt } : todo)

      // 子タスクを完了した場合、親タスクのすべての子が完了したか確認
      if (newCompleted && target.parentId) {
        const checkAndCompleteParent = (parentId: string | null) => {
          if (!parentId) return
          const siblings = updated.filter(t => t.parentId === parentId)
          const allSiblingsCompleted = siblings.length > 0 && siblings.every(t => t.completed)
          if (allSiblingsCompleted) {
            updated = updated.map(t => t.id === parentId ? { ...t, completed: true, followUpCount: 0, lastNotifiedAt: null } : t)
            // 親の親も確認
            const parent = updated.find(t => t.id === parentId)
            if (parent?.parentId) {
              checkAndCompleteParent(parent.parentId)
            }
          }
        }
        checkAndCompleteParent(target.parentId)
      }

      return updated
    })
  }

  const deleteTodo = (id: string) => {
    const getDescendantIds = (parentId: string): string[] => {
      const children = todos.filter(t => t.parentId === parentId)
      return children.flatMap(c => [c.id, ...getDescendantIds(c.id)])
    }
    const idsToDelete = new Set([id, ...getDescendantIds(id)])
    setTodos(prev => prev.filter(todo => !idsToDelete.has(todo.id)))
  }

  const clearCompleted = () => { setTodos(prev => prev.filter(todo => !todo.completed)) }

  const cycleTimeframe = (id: string) => {
    setTodos(prev => prev.map(todo => {
      if (todo.id !== id) return todo
      const next: Timeframe = todo.timeframe === 'today' ? 'week' : todo.timeframe === 'week' ? 'month' : 'today'
      const config = getAutoReminderConfig(next)
      const weeklyReminder = { days: config.days, time: config.times[0] || '12:00', times: config.times, lastSent: null }
      return { ...todo, timeframe: next, reminder: null, reminderSent: false, weeklyReminder, followUpCount: 0, lastNotifiedAt: null }
    }))
  }

  const timeframeLabel = (tf: Timeframe) => tf === 'today' ? '今日' : tf === 'week' ? '週' : '月'

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) { setApiKey(apiKeyInput.trim()) } else { clearApiKey() }
    setShowSettings(false)
  }

  const handleDecompose = async (todo: Todo) => {
    if (!getApiKey()) { setShowSettings(true); return }
    setDecomposingTodo(todo)
    setDecomposing(todo.id)
    setDecomposeError('')
    try {
      const result = await decomposeTask(todo.text)
      setSubtasks(result.subtasks)
      setSelectedSubtasks(new Set(result.subtasks.map((_, i) => i)))
      setShowDecomposeModal(true)
    } catch (error) {
      setDecomposeError(error instanceof Error ? error.message : 'Error')
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
    if (selectedSubtasks.size === subtasks.length) {
      setSelectedSubtasks(new Set())
    } else {
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
    const parentGroup = decomposingTodo?.group ?? 'default'
    const parentTimeframe = decomposingTodo?.timeframe ?? 'today'
    const autoReminder = getAutoReminderConfig(parentTimeframe)
    const newTodos: Todo[] = selected.map(st => ({ id: crypto.randomUUID(), text: st.title, completed: false, createdAt: Date.now(), parentId, priority: st.priority || 'medium', group: parentGroup, reminder: null, reminderSent: false, weeklyReminder: { days: autoReminder.days, time: autoReminder.times[0], times: autoReminder.times, lastSent: null }, followUpCount: 0, lastNotifiedAt: null, timeframe: parentTimeframe }))
    setTodos(prev => {
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
    setTodos(prev => prev.map(todo => {
      if (todo.id !== id) return todo
      const next = todo.priority === 'high' ? 'medium' : todo.priority === 'medium' ? 'low' : 'high'
      return { ...todo, priority: next }
    }))
  }

  const priorityLabel = (p: "high" | "medium" | "low") => p === 'high' ? '高' : p === 'medium' ? '中' : '低'

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const saveEdit = () => {
    if (!editingId || !editText.trim()) return
    setTodos(prev => prev.map(todo => todo.id === editingId ? { ...todo, text: editText.trim() } : todo))
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

  const buildTree = (parentId: string | null, group: string): Todo[] => {
    const children = filteredTodos.filter(t => t.parentId === parentId && t.group === group)
    return children.flatMap(child => [child, ...buildTree(child.id, group)])
  }

  const filteredTodos = todos.filter(todo => {
    // 期間フィルター（子タスクは親のtimeframeに従う）
    if (todo.parentId === null && todo.timeframe !== currentTimeframe) return false
    if (todo.parentId !== null) {
      const parent = todos.find(t => t.id === todo.parentId)
      if (parent && parent.timeframe !== currentTimeframe) return false
    }
    // 完了/未完了フィルター
    if (filter === 'active') return !todo.completed
    if (filter === 'completed') return todo.completed
    return true
  })

  const completedCount = todos.filter(t => t.completed).length

  const addGroup = () => {
    const name = newGroupName.trim()
    if (!name || groups.includes(name)) return
    setCurrentGroup(name)
    setShowGroupModal(false)
    setNewGroupName('')
  }

  const groupLabel = (g: string) => g === 'default' ? 'デフォルト' : g

  const deleteGroup = (groupName: string) => {
    if (groupName === 'default') return
    // Move tasks to default group
    setTodos(prev => prev.map(t => t.group === groupName ? { ...t, group: 'default' } : t))
    if (currentGroup === groupName) setCurrentGroup('default')
  }

  const exportData = () => {
    const data = {
      todos,
      collapsed: [...collapsed],
      exportedAt: new Date().toISOString(),
      version: '2.0'
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `calm-todo-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importData = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string)
        if (data.todos && Array.isArray(data.todos)) {
          const migrated = data.todos.map((t: Todo) => ({
            ...t,
            parentId: t.parentId ?? null,
            priority: t.priority ?? 'medium',
            group: t.group ?? 'default',
            reminder: t.reminder ?? null,
            reminderSent: t.reminderSent ?? false,
            weeklyReminder: t.weeklyReminder ?? null
          }))
          setTodos(migrated)
          if (data.collapsed) {
            setCollapsed(new Set(data.collapsed))
          }
          setShowSettings(false)
        }
      } catch {
        alert('ファイルの読み込みに失敗しました')
      }
    }
    reader.readAsText(file)
  }

  // Today's statistics
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayTasks = todos.filter(t => t.createdAt >= today.getTime() || (t.completed && t.createdAt < today.getTime()))
  const todayCompleted = todayTasks.filter(t => t.completed).length
  const totalActive = todos.filter(t => !t.completed).length

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
      const now = new Date()
      now.setHours(now.getHours() + 1, 0, 0, 0)
      setReminderDateTime(now.toISOString().slice(0, 16))
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
      setTodos(prev => prev.map(todo =>
        todo.id === reminderTodoId ? { ...todo, reminder: timestamp, reminderSent: false, weeklyReminder: null } : todo
      ))
    } else {
      if (weeklyDays.length === 0) return
      setTodos(prev => prev.map(todo =>
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
    setTodos(prev => prev.map(todo =>
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

  const completeIntro = () => {
    localStorage.setItem(INTRO_SEEN_KEY, 'true')
    setShowIntro(false)
    setIntroStep(0)
  }

  const introSteps = [
    {
      title: 'Calm Todoへようこそ',
      content: 'シンプルで美しいタスク管理アプリです。アカウント登録不要で、データは全てローカルに保存されます。',
      icon: '👋'
    },
    {
      title: 'タスクを追加',
      content: '上部の入力欄にタスクを入力してEnterキーまたは「追加」ボタンをクリック。nキーで素早く入力欄にフォーカスできます。',
      icon: '✏️'
    },
    {
      title: 'サブタスクとAI分解',
      content: 'タスクの✨ボタンでAIがサブタスクを提案します（OpenAI APIキーが必要）。設定画面でAPIキーを登録してください。',
      icon: '✨'
    },
    {
      title: 'リマインダー',
      content: '🔔ボタンでリマインダーを設定。1回限りの通知や、毎週特定の曜日に通知する週次リマインダーが使えます。',
      icon: '🔔'
    },
    {
      title: 'さあ、始めましょう！',
      content: 'ヘルプが必要なときは?キーまたは右上の?ボタンをクリックしてください。',
      icon: '🚀'
    }
  ]

  const hasApiKey = !!getApiKey()

  return (
    <div className="app">
      <header className="header">
        <h1>Calm Todo</h1>
        <p className="subtitle">オフラインで動くタスク管理</p>
        <div className="header-stats">
          <span className="stat" title="未完了タスク">{totalActive} 件</span>
          <span className="stat-divider">|</span>
          <span className="stat completed-stat" title="今日完了">{todayCompleted} 完了</span>
        </div>
        <div className="header-buttons">
          <button className="help-btn" onClick={() => setShowHelp(true)} title="ヘルプ (?)">?</button>
          <button className="settings-btn" onClick={() => setShowSettings(true)} title="設定">
            {hasApiKey ? '⚙ AI設定済' : '⚙ 設定'}
          </button>
        </div>
      </header>

      <main className="main">
        <div className="input-section">
          <input type="text" className="todo-input" placeholder="やることを入力..." value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTodo()} />
          <button className="add-btn" onClick={addTodo} disabled={!input.trim()}>追加</button>
        </div>

        <div className="group-tabs">
          {groups.map(g => (
            <div key={g} className={'group-tab-wrapper' + (currentGroup === g ? ' active' : '')}>
              <button className={'group-tab ' + (currentGroup === g ? 'active' : '')} onClick={() => setCurrentGroup(g)}>
                {groupLabel(g)}
                <span className="group-count">({todos.filter(t => t.group === g && (filter === 'all' || (filter === 'active' && !t.completed) || (filter === 'completed' && t.completed))).length})</span>
              </button>
              {g !== 'default' && currentGroup === g && (
                <button className="group-delete-btn" onClick={() => deleteGroup(g)} title="グループを削除">×</button>
              )}
            </div>
          ))}
          <button className="group-tab add-group" onClick={() => setShowGroupModal(true)}>+ グループ</button>
        </div>

        <div className="timeframe-tabs">
          <button className={'timeframe-btn ' + (currentTimeframe === 'today' ? 'active' : '')} onClick={() => setCurrentTimeframe('today')}>
            今日 ({todos.filter(t => t.group === currentGroup && t.timeframe === 'today' && t.parentId === null).length})
          </button>
          <button className={'timeframe-btn ' + (currentTimeframe === 'week' ? 'active' : '')} onClick={() => setCurrentTimeframe('week')}>
            1週間 ({todos.filter(t => t.group === currentGroup && t.timeframe === 'week' && t.parentId === null).length})
          </button>
          <button className={'timeframe-btn ' + (currentTimeframe === 'month' ? 'active' : '')} onClick={() => setCurrentTimeframe('month')}>
            1ヶ月 ({todos.filter(t => t.group === currentGroup && t.timeframe === 'month' && t.parentId === null).length})
          </button>
        </div>

        <div className="filters">
          <button className={'filter-btn ' + (filter === 'all' ? 'active' : '')} onClick={() => setFilter('all')}>すべて ({filteredTodos.filter(t => t.group === currentGroup).length})</button>
          <button className={'filter-btn ' + (filter === 'active' ? 'active' : '')} onClick={() => setFilter('active')}>未完了 ({todos.filter(t => t.group === currentGroup && t.timeframe === currentTimeframe && !t.completed && t.parentId === null).length})</button>
          <button className={'filter-btn ' + (filter === 'completed' ? 'active' : '')} onClick={() => setFilter('completed')}>完了 ({todos.filter(t => t.group === currentGroup && t.timeframe === currentTimeframe && t.completed && t.parentId === null).length})</button>
        </div>

        {decomposeError && <div className="error-message">{decomposeError}</div>}

        <ul className="todo-list">
          {filteredTodos.filter(t => t.group === currentGroup).length === 0 ? (
            <li className="empty-state">
              <div className="empty-icon">{filter === 'completed' ? '✓' : '○'}</div>
              <div className="empty-title">
                {filter === 'all' ? 'タスクがありません' : filter === 'active' ? 'すべて完了！' : 'まだ完了したタスクはありません'}
              </div>
              <div className="empty-hint">
                {filter === 'all' ? 'nキーで新しいタスクを追加' : filter === 'active' ? '素晴らしい！今日もお疲れさまでした' : 'タスクを完了するとここに表示されます'}
              </div>
            </li>
          ) : buildTree(null, currentGroup).filter(t => !isHidden(t)).map(todo => {
            const depth = getDepth(todo)
            const hasChild = hasChildren(todo.id)
            const isCollapsed = collapsed.has(todo.id)
            return (
              <li key={todo.id} className={'todo-item ' + (todo.completed ? 'completed' : '') + (depth > 0 ? ' child depth-' + depth : '')}>
                {hasChild && (
                  <button className="collapse-btn" onClick={() => toggleCollapse(todo.id)} title={isCollapsed ? '展開' : '折りたたむ'}>
                    {isCollapsed ? '▶' : '▼'}
                  </button>
                )}
                <button className="checkbox" onClick={() => toggleTodo(todo.id)}>{todo.completed ? '✓' : ''}</button>
                <button className={'priority-badge priority-' + todo.priority} onClick={() => cyclePriority(todo.id)} title="優先度を変更">{priorityLabel(todo.priority)}</button>
                {todo.parentId === null && (
                  <button className={'timeframe-badge timeframe-' + todo.timeframe} onClick={() => cycleTimeframe(todo.id)} title="期間を変更">{timeframeLabel(todo.timeframe)}</button>
                )}
                {editingId === todo.id ? (
                  <input type="text" className="edit-input" value={editText} onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                    onBlur={saveEdit} autoFocus />
                ) : (
                  <span className="todo-text" onDoubleClick={() => startEdit(todo)}>{todo.text}</span>
                )}
                <button className="edit-btn" onClick={() => startEdit(todo)} title="編集">✎</button>
                <button className={'reminder-btn' + (todo.reminder || todo.weeklyReminder ? ' has-reminder' : '')} onClick={() => openReminderModal(todo.id)} title={todo.weeklyReminder ? formatWeeklyReminder(todo.weeklyReminder) : todo.reminder ? formatReminder(todo.reminder) : 'リマインダー設定'}>
                  🔔{todo.weeklyReminder && <span className="reminder-time">{formatWeeklyReminder(todo.weeklyReminder)}</span>}
                  {todo.reminder && !todo.weeklyReminder && <span className="reminder-time">{formatReminder(todo.reminder)}</span>}
                </button>
                <button className="ai-btn" onClick={() => handleDecompose(todo)} disabled={decomposing === todo.id || todo.completed} title="AIで分解">
                  {decomposing === todo.id ? '...' : '✨'}
                </button>
                <button className="delete-btn" onClick={() => deleteTodo(todo.id)}>×</button>
              </li>
            )
          })}
        </ul>

        {completedCount > 0 && <button className="clear-btn" onClick={clearCompleted}>完了したタスクを削除 ({completedCount})</button>}
      </main>

      <footer className="footer"></footer>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
            <h2>設定</h2>
            <div className="settings-section">
              <h3>AI設定</h3>
              <p className="modal-description">OpenAI APIキーを設定すると、タスクをサブタスクに分解できます。</p>
              <input type="password" className="api-key-input" placeholder="sk-..." value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)} />
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
              <p className="modal-description">データはC:/CalmTodoBackupに自動保存されます。</p>
              <button className="modal-btn secondary restore-btn" onClick={restoreFromBackup}>バックアップから復元</button>
            </div>
            <div className="settings-section">
              <h3>データ管理</h3>
              <p className="modal-description">JSONファイルでデータをエクスポート/インポートできます。</p>
              <div className="export-import-btns">
                <button className="modal-btn secondary" onClick={exportData}>エクスポート</button>
                <label className="modal-btn secondary import-label">
                  インポート
                  <input type="file" accept=".json" onChange={e => e.target.files?.[0] && importData(e.target.files[0])} hidden />
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowSettings(false)}>閉じる</button>
              <button className="modal-btn primary" onClick={handleSaveApiKey}>保存</button>
            </div>
          </div>
        </div>
      )}

      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>新しいグループ</h2>
            <input type="text" className="api-key-input" placeholder="グループ名..." value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGroup()} autoFocus />
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowGroupModal(false)}>キャンセル</button>
              <button className="modal-btn primary" onClick={addGroup} disabled={!newGroupName.trim()}>作成</button>
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
                  <button className={'subtask-priority priority-' + (st.priority || 'medium')} onClick={() => updateSubtaskPriority(i)}>{priorityLabel(st.priority || 'medium')}</button>
                  {editingSubtask === i ? (
                    <input type="text" className="subtask-edit-input" value={st.title}
                      onChange={e => updateSubtaskTitle(i, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingSubtask(null) }}
                      onBlur={() => setEditingSubtask(null)} autoFocus />
                  ) : (
                    <span className="subtask-title" onClick={() => toggleSubtask(i)} onDoubleClick={() => setEditingSubtask(i)}>{st.title}</span>
                  )}
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

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal help-modal" onClick={e => e.stopPropagation()}>
            <h2>使い方ガイド</h2>
            <div className="help-content">
              <div className="help-section">
                <h3>基本操作</h3>
                <ul className="help-list">
                  <li><strong>タスク追加:</strong> 入力欄に入力してEnterまたは「追加」ボタン</li>
                  <li><strong>完了:</strong> チェックボックスをクリック</li>
                  <li><strong>編集:</strong> タスクをダブルクリック、または✎ボタン</li>
                  <li><strong>削除:</strong> ×ボタンをクリック</li>
                  <li><strong>優先度:</strong> 高/中/低バッジをクリックで変更</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>整理機能</h3>
                <ul className="help-list">
                  <li><strong>グループ:</strong> タブでタスクを分類</li>
                  <li><strong>フィルター:</strong> すべて/未完了/完了で絞り込み</li>
                  <li><strong>サブタスク:</strong> ✨ボタンでAI分解（要APIキー）</li>
                  <li><strong>折りたたみ:</strong> ▼ボタンで子タスクを非表示</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>リマインダー</h3>
                <ul className="help-list">
                  <li><strong>1回:</strong> 特定の日時に通知</li>
                  <li><strong>毎週:</strong> 指定した曜日・時刻に繰り返し通知</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>キーボードショートカット</h3>
                <ul className="help-list shortcut-list">
                  <li><kbd>n</kbd> 新規タスク入力</li>
                  <li><kbd>?</kbd> ヘルプを表示</li>
                  <li><kbd>Esc</kbd> モーダルを閉じる</li>
                </ul>
              </div>
              <div className="help-section">
                <h3>データ管理</h3>
                <ul className="help-list">
                  <li>データは自動的にローカルに保存されます</li>
                  <li>設定画面でエクスポート/インポートが可能</li>
                  <li>C:/CalmTodoBackupにも自動バックアップ</li>
                </ul>
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={() => setShowHelp(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {showIntro && (
        <div className="modal-overlay intro-overlay">
          <div className="modal intro-modal">
            <div className="intro-icon">{introSteps[introStep].icon}</div>
            <h2>{introSteps[introStep].title}</h2>
            <p className="intro-content">{introSteps[introStep].content}</p>
            <div className="intro-dots">
              {introSteps.map((_, i) => (
                <span key={i} className={'intro-dot' + (i === introStep ? ' active' : '')} onClick={() => setIntroStep(i)} />
              ))}
            </div>
            <div className="modal-actions intro-actions">
              {introStep > 0 && (
                <button className="modal-btn secondary" onClick={() => setIntroStep(s => s - 1)}>戻る</button>
              )}
              {introStep < introSteps.length - 1 ? (
                <button className="modal-btn primary" onClick={() => setIntroStep(s => s + 1)}>次へ</button>
              ) : (
                <button className="modal-btn primary" onClick={completeIntro}>始める</button>
              )}
            </div>
            <button className="intro-skip" onClick={completeIntro}>スキップ</button>
          </div>
        </div>
      )}
    </div>
  )
}
