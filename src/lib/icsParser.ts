// ICS (iCalendar) ファイルパーサー
// Googleカレンダー/Googleタスクからエクスポートしたデータをインポートするためのユーティリティ

import type { Todo } from '@/types/todo'
import type { RecurrencePattern } from '@/lib/parseNaturalLanguage'

export type ICSItemType = 'event' | 'task'

export interface ICSEvent {
  uid: string
  summary: string
  description?: string
  dtstart: Date
  dtend?: Date
  due?: Date  // VTODOの期限
  rrule?: RRuleData
  categories?: string[]
  priority?: number
  status?: string
  type: ICSItemType  // 'event' = VEVENT, 'task' = VTODO
  percentComplete?: number  // VTODO用: 進捗率
}

interface RRuleData {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval?: number
  byday?: string[]
  bymonthday?: number[]
  bymonth?: number[]
  count?: number
  until?: Date
}

/**
 * ICSファイルの内容を解析してイベント/タスク配列を返す
 * VEVENT（予定）とVTODO（タスク）の両方をパース
 */
export function parseICS(icsContent: string): ICSEvent[] {
  const events: ICSEvent[] = []
  const lines = unfoldLines(icsContent)

  let currentItem: Partial<ICSEvent> | null = null
  let currentType: ICSItemType | null = null

  for (const line of lines) {
    const { name, params, value } = parseLine(line)

    // VEVENT（予定）またはVTODO（タスク）の開始
    if (name === 'BEGIN' && (value === 'VEVENT' || value === 'VTODO')) {
      currentItem = {}
      currentType = value === 'VTODO' ? 'task' : 'event'
    }
    // VEVENT または VTODO の終了
    else if (name === 'END' && (value === 'VEVENT' || value === 'VTODO')) {
      if (currentItem && currentItem.summary && currentType) {
        // VTODOの場合、dtstartがなければdueを使用、それもなければ現在時刻
        const startDate = currentItem.dtstart || currentItem.due || new Date()
        events.push({
          uid: currentItem.uid || crypto.randomUUID(),
          summary: currentItem.summary,
          description: currentItem.description,
          dtstart: startDate,
          dtend: currentItem.dtend,
          due: currentItem.due,
          rrule: currentItem.rrule,
          categories: currentItem.categories,
          priority: currentItem.priority,
          status: currentItem.status,
          type: currentType,
          percentComplete: currentItem.percentComplete,
        })
      }
      currentItem = null
      currentType = null
    } else if (currentItem) {
      switch (name) {
        case 'UID':
          currentItem.uid = value
          break
        case 'SUMMARY':
          currentItem.summary = unescapeText(value)
          break
        case 'DESCRIPTION':
          currentItem.description = unescapeText(value)
          break
        case 'DTSTART':
          currentItem.dtstart = parseDateTime(value, params)
          break
        case 'DTEND':
          currentItem.dtend = parseDateTime(value, params)
          break
        case 'DUE':
          currentItem.due = parseDateTime(value, params)
          break
        case 'RRULE':
          currentItem.rrule = parseRRule(value)
          break
        case 'CATEGORIES':
          currentItem.categories = value.split(',').map(c => c.trim())
          break
        case 'PRIORITY':
          currentItem.priority = parseInt(value, 10)
          break
        case 'STATUS':
          currentItem.status = value
          break
        case 'PERCENT-COMPLETE':
          currentItem.percentComplete = parseInt(value, 10)
          break
      }
    }
  }

  return events
}

/**
 * ICSの折り返し行を展開する
 */
function unfoldLines(content: string): string[] {
  // CRLFとLFの両方に対応
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 継続行（スペースまたはタブで始まる行）を前の行に結合
  const unfolded = normalized.replace(/\n[ \t]/g, '')
  return unfolded.split('\n').filter(line => line.trim())
}

/**
 * ICS行を解析してプロパティ名、パラメータ、値に分割
 */
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } {
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) {
    return { name: line, params: {}, value: '' }
  }

  const nameAndParams = line.substring(0, colonIndex)
  const value = line.substring(colonIndex + 1)

  const semicolonIndex = nameAndParams.indexOf(';')
  if (semicolonIndex === -1) {
    return { name: nameAndParams.toUpperCase(), params: {}, value }
  }

  const name = nameAndParams.substring(0, semicolonIndex).toUpperCase()
  const paramsStr = nameAndParams.substring(semicolonIndex + 1)
  const params: Record<string, string> = {}

  for (const param of paramsStr.split(';')) {
    const [key, val] = param.split('=')
    if (key && val) {
      params[key.toUpperCase()] = val
    }
  }

  return { name, params, value }
}

/**
 * ICS日時文字列をDateオブジェクトに変換
 */
function parseDateTime(value: string, params: Record<string, string>): Date {
  // 形式: YYYYMMDD or YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const isUTC = value.endsWith('Z') || params.TZID === 'UTC'
  const cleanValue = value.replace('Z', '')

  const year = parseInt(cleanValue.substring(0, 4), 10)
  const month = parseInt(cleanValue.substring(4, 6), 10) - 1
  const day = parseInt(cleanValue.substring(6, 8), 10)

  if (cleanValue.length === 8) {
    // 日付のみ
    return new Date(year, month, day)
  }

  // 時刻あり (T区切り)
  const timeStr = cleanValue.substring(9)
  const hour = parseInt(timeStr.substring(0, 2), 10)
  const minute = parseInt(timeStr.substring(2, 4), 10)
  const second = timeStr.length >= 6 ? parseInt(timeStr.substring(4, 6), 10) : 0

  if (isUTC) {
    return new Date(Date.UTC(year, month, day, hour, minute, second))
  }

  return new Date(year, month, day, hour, minute, second)
}

/**
 * RRULE文字列を解析
 */
function parseRRule(value: string): RRuleData | undefined {
  const parts = value.split(';')
  const rrule: Partial<RRuleData> = {}

  for (const part of parts) {
    const [key, val] = part.split('=')
    if (!key || !val) continue

    switch (key.toUpperCase()) {
      case 'FREQ':
        if (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(val.toUpperCase())) {
          rrule.freq = val.toUpperCase() as RRuleData['freq']
        }
        break
      case 'INTERVAL':
        rrule.interval = parseInt(val, 10)
        break
      case 'BYDAY':
        rrule.byday = val.split(',')
        break
      case 'BYMONTHDAY':
        rrule.bymonthday = val.split(',').map(v => parseInt(v, 10))
        break
      case 'BYMONTH':
        rrule.bymonth = val.split(',').map(v => parseInt(v, 10))
        break
      case 'COUNT':
        rrule.count = parseInt(val, 10)
        break
      case 'UNTIL':
        rrule.until = parseDateTime(val, {})
        break
    }
  }

  if (rrule.freq) {
    return rrule as RRuleData
  }
  return undefined
}

/**
 * ICSテキストのエスケープを解除
 */
function unescapeText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * BYDAY文字列を曜日番号に変換 (SU=0, MO=1, ..., SA=6)
 */
function byDayToNumber(byday: string): number {
  const dayMap: Record<string, number> = {
    'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
  }
  // "1MO" のような形式から曜日部分を抽出
  const dayPart = byday.replace(/^-?\d+/, '')
  return dayMap[dayPart] ?? 0
}

/**
 * ICSイベントをTodoに変換
 */
export function icsEventToTodo(event: ICSEvent): Omit<Todo, 'id'> {
  // 繰り返しパターンを変換
  let recurrence: RecurrencePattern | null = null
  if (event.rrule) {
    const type = event.rrule.freq.toLowerCase() as 'daily' | 'weekly' | 'monthly' | 'yearly'
    recurrence = {
      type,
      interval: event.rrule.interval || 1,
    }

    if (type === 'weekly' && event.rrule.byday) {
      recurrence.daysOfWeek = event.rrule.byday.map(byDayToNumber)
    }

    if (type === 'monthly' && event.rrule.bymonthday && event.rrule.bymonthday.length > 0) {
      recurrence.dayOfMonth = event.rrule.bymonthday[0]
    }
  }

  // 優先度を変換 (ICS: 1-9, Todo: P1-P4)
  let priority: 1 | 2 | 3 | 4 = 4
  if (event.priority) {
    if (event.priority <= 2) priority = 1
    else if (event.priority <= 4) priority = 2
    else if (event.priority <= 6) priority = 3
    else priority = 4
  }

  // ラベルを抽出
  const labels = event.categories || []

  // 完了状態を判定（VTODOの場合は進捗率100%も完了とみなす）
  const completed = event.status === 'COMPLETED' || event.percentComplete === 100

  // 期限を決定（VTODOの場合はdueを優先、なければdtstart）
  const dueDateValue = event.due || event.dtstart
  const dueDate = dueDateValue.getTime()
  const now = Date.now()
  const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))
  let timeframe: 'today' | 'week' | 'month' | 'year' = 'today'
  if (diffDays <= 1) timeframe = 'today'
  else if (diffDays <= 7) timeframe = 'week'
  else if (diffDays <= 31) timeframe = 'month'
  else timeframe = 'year'

  // 繰り返しタスクの場合は適切なタイムフレームに
  if (recurrence) {
    if (recurrence.type === 'daily') timeframe = 'today'
    else if (recurrence.type === 'weekly') timeframe = 'week'
    else if (recurrence.type === 'monthly') timeframe = 'month'
    else if (recurrence.type === 'yearly') timeframe = 'year'
  }

  return {
    text: event.summary,
    completed,
    completedAt: completed ? Date.now() : null,
    createdAt: Date.now(),
    parentId: null,
    priority,
    timeframe,
    dueDate,
    dueDateNotification: {
      enabled: true,
      notifyBefore: 0,
      notifiedAt: null,
      followUpCount: 0,
    },
    labels,
    recurrence,
    description: event.description || '',
    sectionId: null,
    order: 0,
    estimatedMinutes: event.dtend
      ? Math.round((event.dtend.getTime() - event.dtstart.getTime()) / (1000 * 60))
      : null,
    comments: [],
    projectId: null,
    karmaAwarded: false,
    archived: false,
    archivedAt: null,
  }
}

/**
 * ICSファイルからTodo配列を生成
 */
export function importICSToTodos(
  icsContent: string,
  options: {
    importCompleted?: boolean
    importPast?: boolean
    importTasks?: boolean  // VTODOをインポート（デフォルト: true）
    importEvents?: boolean // VEVENTをインポート（デフォルト: false）
  } = {}
): { todos: Omit<Todo, 'id'>[]; stats: ImportStats } {
  const {
    importCompleted = true,
    importPast = false,
    importTasks = true,
    importEvents = false,
  } = options
  const allItems = parseICS(icsContent)
  const now = Date.now()

  const stats: ImportStats = {
    total: allItems.length,
    totalTasks: allItems.filter(e => e.type === 'task').length,
    totalEvents: allItems.filter(e => e.type === 'event').length,
    imported: 0,
    skipped: 0,
    skippedReasons: {
      completed: 0,
      past: 0,
      isEvent: 0,
    },
  }

  const todos: Omit<Todo, 'id'>[] = []

  for (const item of allItems) {
    // タイプによるフィルタリング
    if (item.type === 'task' && !importTasks) {
      stats.skipped++
      continue
    }
    if (item.type === 'event' && !importEvents) {
      stats.skipped++
      stats.skippedReasons.isEvent++
      continue
    }

    // 完了済みアイテムをスキップ
    if (!importCompleted && (item.status === 'COMPLETED' || item.percentComplete === 100)) {
      stats.skipped++
      stats.skippedReasons.completed++
      continue
    }

    // 期限を取得（VTODOはdue優先）
    const itemDate = item.due || item.dtstart

    // 過去のアイテムをスキップ（繰り返しアイテムは除く）
    if (!importPast && !item.rrule && itemDate.getTime() < now) {
      stats.skipped++
      stats.skippedReasons.past++
      continue
    }

    todos.push(icsEventToTodo(item))
    stats.imported++
  }

  return { todos, stats }
}

export interface ImportStats {
  total: number
  totalTasks: number   // VTODOの数
  totalEvents: number  // VEVENTの数
  imported: number
  skipped: number
  skippedReasons: {
    completed: number
    past: number
    isEvent: number  // 予定としてスキップされた数
  }
}
