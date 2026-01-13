// ICS (iCalendar) ファイルパーサー
// Googleカレンダーからエクスポートしたデータをインポートするためのユーティリティ

import type { Todo } from '@/types/todo'
import type { RecurrencePattern } from '@/lib/parseNaturalLanguage'

export interface ICSEvent {
  uid: string
  summary: string
  description?: string
  dtstart: Date
  dtend?: Date
  rrule?: RRuleData
  categories?: string[]
  priority?: number
  status?: string
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
 * ICSファイルの内容を解析してイベント配列を返す
 */
export function parseICS(icsContent: string): ICSEvent[] {
  const events: ICSEvent[] = []
  const lines = unfoldLines(icsContent)

  let currentEvent: Partial<ICSEvent> | null = null

  for (const line of lines) {
    const { name, params, value } = parseLine(line)

    if (name === 'BEGIN' && value === 'VEVENT') {
      currentEvent = {}
    } else if (name === 'END' && value === 'VEVENT') {
      if (currentEvent && currentEvent.summary && currentEvent.dtstart) {
        events.push({
          uid: currentEvent.uid || crypto.randomUUID(),
          summary: currentEvent.summary,
          description: currentEvent.description,
          dtstart: currentEvent.dtstart,
          dtend: currentEvent.dtend,
          rrule: currentEvent.rrule,
          categories: currentEvent.categories,
          priority: currentEvent.priority,
          status: currentEvent.status,
        })
      }
      currentEvent = null
    } else if (currentEvent) {
      switch (name) {
        case 'UID':
          currentEvent.uid = value
          break
        case 'SUMMARY':
          currentEvent.summary = unescapeText(value)
          break
        case 'DESCRIPTION':
          currentEvent.description = unescapeText(value)
          break
        case 'DTSTART':
          currentEvent.dtstart = parseDateTime(value, params)
          break
        case 'DTEND':
          currentEvent.dtend = parseDateTime(value, params)
          break
        case 'RRULE':
          currentEvent.rrule = parseRRule(value)
          break
        case 'CATEGORIES':
          currentEvent.categories = value.split(',').map(c => c.trim())
          break
        case 'PRIORITY':
          currentEvent.priority = parseInt(value, 10)
          break
        case 'STATUS':
          currentEvent.status = value
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

  // 完了状態を判定
  const completed = event.status === 'COMPLETED'

  // 期限に応じたtimeframeを決定
  const dueDate = event.dtstart.getTime()
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
  } = {}
): { todos: Omit<Todo, 'id'>[]; stats: ImportStats } {
  const { importCompleted = true, importPast = false } = options
  const events = parseICS(icsContent)
  const now = Date.now()

  const stats: ImportStats = {
    total: events.length,
    imported: 0,
    skipped: 0,
    skippedReasons: {
      completed: 0,
      past: 0,
    },
  }

  const todos: Omit<Todo, 'id'>[] = []

  for (const event of events) {
    // 完了済みイベントをスキップ
    if (!importCompleted && event.status === 'COMPLETED') {
      stats.skipped++
      stats.skippedReasons.completed++
      continue
    }

    // 過去のイベントをスキップ（繰り返しイベントは除く）
    if (!importPast && !event.rrule && event.dtstart.getTime() < now) {
      stats.skipped++
      stats.skippedReasons.past++
      continue
    }

    todos.push(icsEventToTodo(event))
    stats.imported++
  }

  return { todos, stats }
}

export interface ImportStats {
  total: number
  imported: number
  skipped: number
  skippedReasons: {
    completed: number
    past: number
  }
}
