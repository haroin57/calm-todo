import { useState } from 'react'
import type { RecurrencePattern } from '../lib/parseNaturalLanguage'
import type { Todo } from '@/types/todo'

// Note: parseNaturalLanguage, getNextRecurrenceDate, formatRecurrence are available from '../lib/parseNaturalLanguage' if needed

export function useCalendar() {
  // カレンダー関連の状態
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null)

  // 期日モーダル関連の状態
  const [dueDateTodoId, setDueDateTodoId] = useState<string | null>(null)
  const [dueDateInput, setDueDateInput] = useState('')
  const [dueDateNotifyEnabled, setDueDateNotifyEnabled] = useState(true)
  const [dueDateNotifyBefore, setDueDateNotifyBefore] = useState(0) // 期日の何分前に通知するか
  const [dueDateRecurrenceType, setDueDateRecurrenceType] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('none')
  const [dueDateRecurrenceDays, setDueDateRecurrenceDays] = useState<number[]>([]) // 曜日（weekly用）
  const [dueDateRecurrenceTime, setDueDateRecurrenceTime] = useState('09:00') // 繰り返しタスクの時間
  const [dueDateMonthlyDay, setDueDateMonthlyDay] = useState(1) // 毎月の日付
  const [dueDateYearlyMonth, setDueDateYearlyMonth] = useState(1) // 毎年の月
  const [dueDateYearlyDay, setDueDateYearlyDay] = useState(1) // 毎年の日付

  // 日付関連のユーティリティ関数
  const formatLocalDateTime = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  const formatDueDate = (timestamp: number, recurrence?: RecurrencePattern | null) => {
    const date = new Date(timestamp)
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const time = `${hours}:${minutes}`

    // 繰り返しタスクの場合、タイプに応じた表示形式
    if (recurrence) {
      const dayNames = ['日', '月', '火', '水', '木', '金', '土']
      switch (recurrence.type) {
        case 'daily':
          // 毎日: 時刻のみ
          return time
        case 'weekly':
          // 毎週: 曜日と時刻
          return `${dayNames[date.getDay()]}曜 ${time}`
        case 'monthly':
          // 毎月: 日付と時刻
          return `${day}日 ${time}`
        case 'yearly':
          // 毎年: 月と日付と時刻
          return `${month}月${day}日 ${time}`
      }
    }

    // 通常のタスク: 月/日 時:分
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

  const getTasksForDay = (date: Date, todos: Todo[]) => {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    return todos.filter(t => t.dueDate && t.dueDate >= dayStart && t.dueDate < dayEnd)
  }

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
  }

  const openDueDateModal = (todoId: string, todos: Todo[], setShowDueDateModal: (show: boolean) => void) => {
    const todo = todos.find(t => t.id === todoId)
    if (todo?.dueDate) {
      const date = new Date(todo.dueDate)
      setDueDateInput(formatLocalDateTime(date))
      // 時間を抽出（HH:MM形式）
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      setDueDateRecurrenceTime(`${hours}:${minutes}`)
      // 通知設定を読み込み
      if (todo.dueDateNotification) {
        setDueDateNotifyEnabled(todo.dueDateNotification.enabled)
        setDueDateNotifyBefore(todo.dueDateNotification.notifyBefore)
      } else {
        setDueDateNotifyEnabled(true)
        setDueDateNotifyBefore(0)
      }
      // 繰り返し設定を読み込み
      if (todo.recurrence) {
        setDueDateRecurrenceType(todo.recurrence.type)
        setDueDateRecurrenceDays(todo.recurrence.daysOfWeek || [])
        setDueDateMonthlyDay(todo.recurrence.dayOfMonth || date.getDate())
        // 毎年の場合は月と日を設定
        setDueDateYearlyMonth(date.getMonth() + 1)
        setDueDateYearlyDay(date.getDate())
      } else {
        setDueDateRecurrenceType('none')
        setDueDateRecurrenceDays([])
        setDueDateMonthlyDay(date.getDate())
        setDueDateYearlyMonth(date.getMonth() + 1)
        setDueDateYearlyDay(date.getDate())
      }
    } else {
      // Default to tomorrow at 18:00
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(18, 0, 0, 0)
      setDueDateInput(formatLocalDateTime(tomorrow))
      setDueDateNotifyEnabled(true)
      setDueDateNotifyBefore(0)
      setDueDateRecurrenceType('none')
      setDueDateRecurrenceDays([])
      setDueDateRecurrenceTime('09:00')
      setDueDateMonthlyDay(1)
      setDueDateYearlyMonth(new Date().getMonth() + 1)
      setDueDateYearlyDay(1)
    }
    setDueDateTodoId(todoId)
    setShowDueDateModal(true)
  }

  const setDueDate = (
    updateTodosWithHistory: (updater: (prev: Todo[]) => Todo[]) => void,
    setShowDueDateModal: (show: boolean) => void
  ) => {
    if (!dueDateTodoId) return

    let timestamp: number
    const now = Date.now()
    const [hours, minutes] = dueDateRecurrenceTime.split(':').map(Number)

    if (dueDateRecurrenceType === 'none') {
      // 通常タスク：datetime-localから取得
      if (!dueDateInput) return
      timestamp = new Date(dueDateInput).getTime()
    } else if (dueDateRecurrenceType === 'daily') {
      // 毎日：今日の指定時刻（過ぎていれば明日）
      const date = new Date()
      date.setHours(hours, minutes, 0, 0)
      if (date.getTime() <= now) {
        date.setDate(date.getDate() + 1)
      }
      timestamp = date.getTime()
    } else if (dueDateRecurrenceType === 'weekly') {
      // 毎週：次の該当曜日
      if (dueDateRecurrenceDays.length === 0) return
      const date = new Date()
      date.setHours(hours, minutes, 0, 0)
      const currentDay = date.getDay()
      const sortedDays = [...dueDateRecurrenceDays].sort((a, b) => a - b)
      let targetDay = sortedDays.find(d => d > currentDay || (d === currentDay && date.getTime() > now))
      if (targetDay === undefined) {
        targetDay = sortedDays[0]
        date.setDate(date.getDate() + (7 - currentDay + targetDay))
      } else {
        date.setDate(date.getDate() + (targetDay - currentDay))
      }
      timestamp = date.getTime()
    } else if (dueDateRecurrenceType === 'monthly') {
      // 毎月：次の該当日
      const date = new Date()
      date.setDate(dueDateMonthlyDay)
      date.setHours(hours, minutes, 0, 0)
      if (date.getTime() <= now) {
        date.setMonth(date.getMonth() + 1)
      }
      timestamp = date.getTime()
    } else {
      // 毎年：次の該当月日
      const date = new Date()
      date.setMonth(dueDateYearlyMonth - 1, dueDateYearlyDay)
      date.setHours(hours, minutes, 0, 0)
      if (date.getTime() <= now) {
        date.setFullYear(date.getFullYear() + 1)
      }
      timestamp = date.getTime()
    }

    // 通知時刻を計算（期日 - notifyBefore分）
    const notifyTime = timestamp - dueDateNotifyBefore * 60 * 1000
    // 通知時刻が現在より前の場合は通知済みとして扱う（即時通知を防ぐ）
    const notifiedAt = notifyTime <= now ? now : null
    // 繰り返し設定を構築
    const recurrence: RecurrencePattern | null = dueDateRecurrenceType !== 'none' ? {
      type: dueDateRecurrenceType,
      interval: 1,
      ...(dueDateRecurrenceType === 'weekly' && dueDateRecurrenceDays.length > 0 ? { daysOfWeek: dueDateRecurrenceDays } : {}),
      ...(dueDateRecurrenceType === 'monthly' ? { dayOfMonth: dueDateMonthlyDay } : {}),
      ...(dueDateRecurrenceType === 'yearly' ? { month: dueDateYearlyMonth, dayOfMonth: dueDateYearlyDay } : {})
    } : null
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.id === dueDateTodoId ? {
        ...todo,
        dueDate: timestamp,
        recurrence,
        dueDateNotification: {
          enabled: dueDateNotifyEnabled,
          notifyBefore: dueDateNotifyBefore,
          notifiedAt,
          followUpCount: 0
        }
      } : todo
    ))
    setShowDueDateModal(false)
    setDueDateTodoId(null)
    setDueDateInput('')
    setDueDateRecurrenceType('none')
    setDueDateRecurrenceDays([])
  }

  const clearDueDate = (
    todoId: string,
    updateTodosWithHistory: (updater: (prev: Todo[]) => Todo[]) => void,
    setShowDueDateModal: (show: boolean) => void
  ) => {
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.id === todoId ? { ...todo, dueDate: null, dueDateNotification: null, recurrence: null } : todo
    ))
    setShowDueDateModal(false)
    setDueDateTodoId(null)
    setDueDateInput('')
    setDueDateRecurrenceType('none')
    setDueDateRecurrenceDays([])
  }

  return {
    // カレンダー関連の状態
    calendarDate,
    setCalendarDate,
    selectedCalendarDay,
    setSelectedCalendarDay,

    // 期日モーダル関連の状態
    dueDateTodoId,
    setDueDateTodoId,
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

    // 日付関連の関数
    formatLocalDateTime,
    formatDueDate,
    isDueDateOverdue,
    getCalendarDays,
    getTasksForDay,
    isSameDay,
    openDueDateModal,
    setDueDate,
    clearDueDate,
  }
}
