/**
 * 自然言語パーサー - GPT APIを使用してタスク入力をパースする
 *
 * 例:
 * "明日 買い物 高" → { text: "買い物", dueDate: 明日, priority: "high" }
 * "毎週月曜 ミーティング" → { text: "ミーティング", recurrence: { type: "weekly", daysOfWeek: [1] } }
 * "来週金曜 レポート提出 #仕事" → { text: "レポート提出", dueDate: 来週金曜, labels: ["仕事"] }
 */

import { fetch } from '@tauri-apps/plugin-http'
import { getApiKey } from './openai'

export type Priority = 1 | 2 | 3 | 4  // P1=最高, P4=最低
export type Timeframe = 'today' | 'week' | 'month'

export interface RecurrencePattern {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  daysOfWeek?: number[]  // 0=日, 1=月, ..., 6=土
  dayOfMonth?: number
}

export interface ParsedTask {
  text: string
  priority: Priority
  timeframe: Timeframe
  dueDate: number | null
  labels: string[]
  recurrence: RecurrencePattern | null
  estimatedMinutes: number | null
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const NLP_SYSTEM_PROMPT = `あなたはタスク入力の解析アシスタントです。ユーザーの自然言語入力を解析し、構造化されたタスク情報を抽出します。

## 解析ルール

1. **タスク名 (text)**: 日付、優先度、ラベル、繰り返しパターンを除いた本文
2. **優先度 (priority)**: 数値で1-4（小さいほど高優先度）
   - "高", "緊急", "至急", "!!!", "p1" → 1
   - "中", "普通", "!!", "p2" → 2
   - "低", "!", "p3" → 3
   - 指定なし → 4
3. **日付 (dueDate)**: ISO 8601形式 (例: "2025-01-15T23:59:59")
   - "今日" → 本日
   - "明日" → 翌日
   - "明後日" → 2日後
   - "来週", "来週月曜" → 該当日
   - "X日後", "X週間後" → 該当日
   - "X月Y日" → 該当日（過去なら翌年）
4. **タイムフレーム (timeframe)**:
   - 今日/明日 → "today"
   - 2日後〜1週間 → "week"
   - 1週間以上 → "month"
5. **ラベル (labels)**: #で始まるタグ (例: #仕事, #買い物)
6. **繰り返し (recurrence)**:
   - "毎日" → { type: "daily", interval: 1 }
   - "毎週" → { type: "weekly", interval: 1, daysOfWeek: [今日の曜日] }
   - "毎週月曜" → { type: "weekly", interval: 1, daysOfWeek: [1] }
   - "毎月15日" → { type: "monthly", interval: 1, dayOfMonth: 15 }
   - "2週間ごと" → { type: "weekly", interval: 2 }
7. **所要時間 (estimatedMinutes)**: タスク内容から推定される所要時間（分）
   - 短いタスク（買い物、電話、メール確認など）: 15-30
   - 中程度のタスク（掃除、料理、軽い運動など）: 30-60
   - 長いタスク（勉強、レポート、会議など）: 60-120
   - "30分"や"1時間"など明示があればその値を使用
   - 不明な場合は30を設定

## 曜日の数値
日=0, 月=1, 火=2, 水=3, 木=4, 金=5, 土=6

## 出力形式
以下のJSON形式のみで回答:
{
  "text": "タスク名",
  "priority": 1 | 2 | 3 | 4,
  "timeframe": "today" | "week" | "month",
  "dueDate": "ISO 8601形式" | null,
  "labels": ["ラベル1", "ラベル2"],
  "recurrence": { "type": "daily"|"weekly"|"monthly"|"yearly", "interval": 1, "daysOfWeek": [1], "dayOfMonth": 15 } | null,
  "estimatedMinutes": 15 | 30 | 45 | 60 | 90 | 120
}

JSON以外のテキストを含めないでください。`

/**
 * GPT APIを使用してテキストから自然言語パターンをパースする
 */
export async function parseNaturalLanguage(input: string): Promise<ParsedTask> {
  const apiKey = getApiKey()

  // APIキーがない場合はフォールバック（ローカルパース）
  if (!apiKey) {
    console.log('[NLP] APIキーなし、ローカルフォールバック使用')
    return parseLocalFallback(input)
  }

  console.log('[NLP] GPT API呼び出し開始:', input)

  const today = new Date()
  const userPrompt = `今日の日付: ${today.toISOString().slice(0, 10)}（${['日', '月', '火', '水', '木', '金', '土'][today.getDay()]}曜日）

以下の入力を解析してください：
"${input}"

タスク情報をJSON形式で返してください。`

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: NLP_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      console.warn('[NLP] GPT API error:', response.status, 'フォールバック使用')
      return parseLocalFallback(input)
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      console.warn('[NLP] GPT応答なし、フォールバック使用')
      return parseLocalFallback(input)
    }

    console.log('[NLP] GPT応答:', content)
    const result = JSON.parse(content)

    // 日付文字列をタイムスタンプに変換
    let dueDate: number | null = null
    if (result.dueDate) {
      const parsed = new Date(result.dueDate)
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed.getTime()
      }
    }

    // 優先度を数値に正規化
    let priority: Priority = 4
    if (typeof result.priority === 'number' && result.priority >= 1 && result.priority <= 4) {
      priority = result.priority as Priority
    } else if (result.priority === 'high') {
      priority = 1
    } else if (result.priority === 'medium') {
      priority = 2
    } else if (result.priority === 'low') {
      priority = 3
    }

    // 所要時間を取得（15分単位、15-120分の範囲）
    let estimatedMinutes: number | null = null
    if (typeof result.estimatedMinutes === 'number' && result.estimatedMinutes > 0) {
      estimatedMinutes = Math.min(120, Math.max(15, Math.round(result.estimatedMinutes / 15) * 15))
    }

    return {
      text: result.text || input.trim(),
      priority,
      timeframe: result.timeframe || 'today',
      dueDate,
      labels: result.labels || [],
      recurrence: result.recurrence || null,
      estimatedMinutes,
    }
  } catch (error) {
    console.warn('[NLP] GPTパースエラー、フォールバック使用:', error)
    return parseLocalFallback(input)
  }
}

/**
 * APIキーがない場合やエラー時のローカルフォールバックパーサー
 */
function parseLocalFallback(input: string): ParsedTask {
  const now = new Date()
  let text = input.trim()
  let priority: Priority = 4
  let timeframe: Timeframe = 'today'
  let dueDate: number | null = null
  let recurrence: RecurrencePattern | null = null
  const labels: string[] = []

  // ラベルを抽出 (#タグ)
  const labelPattern = /#([^\s#]+)/gu
  let labelMatch
  while ((labelMatch = labelPattern.exec(text)) !== null) {
    labels.push(labelMatch[1])
  }
  text = text.replace(labelPattern, '').trim()

  // 優先度を抽出
  const priorityPatterns: { pattern: RegExp; priority: Priority }[] = [
    { pattern: /\s*!!!+\s*$/, priority: 1 },
    { pattern: /\s*!!\s*$/, priority: 2 },
    { pattern: /\s*!\s*$/, priority: 3 },
    { pattern: /(?:^|\s)(高|高優先|緊急|至急)(?:\s|$)/u, priority: 1 },
    { pattern: /(?:^|\s)(中|中優先|普通)(?:\s|$)/u, priority: 2 },
    { pattern: /(?:^|\s)(低|低優先)(?:\s|$)/u, priority: 3 },
    { pattern: /(?:^|\s)p1(?:\s|$)/i, priority: 1 },
    { pattern: /(?:^|\s)p2(?:\s|$)/i, priority: 2 },
    { pattern: /(?:^|\s)p3(?:\s|$)/i, priority: 3 },
    { pattern: /(?:^|\s)p4(?:\s|$)/i, priority: 4 },
  ]

  for (const { pattern, priority: p } of priorityPatterns) {
    if (pattern.test(text)) {
      priority = p
      text = text.replace(pattern, ' ').trim()
      break
    }
  }

  // 繰り返しを抽出
  const dayMap: Record<string, number> = {
    '日': 0, '日曜': 0, '日曜日': 0,
    '月': 1, '月曜': 1, '月曜日': 1,
    '火': 2, '火曜': 2, '火曜日': 2,
    '水': 3, '水曜': 3, '水曜日': 3,
    '木': 4, '木曜': 4, '木曜日': 4,
    '金': 5, '金曜': 5, '金曜日': 5,
    '土': 6, '土曜': 6, '土曜日': 6,
  }

  const recurrencePatterns = [
    // === 先頭パターン ===
    // 毎日
    { pattern: /^毎日/u, getRecurrence: () => ({ type: 'daily' as const, interval: 1 }) },
    { pattern: /^まいにち/u, getRecurrence: () => ({ type: 'daily' as const, interval: 1 }) },
    // 隔日（2日ごと）
    { pattern: /^隔日/u, getRecurrence: () => ({ type: 'daily' as const, interval: 2 }) },
    { pattern: /^かくじつ/u, getRecurrence: () => ({ type: 'daily' as const, interval: 2 }) },
    // 平日毎日（月〜金）
    { pattern: /^平日毎日/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }) },
    { pattern: /^平日/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }) },
    { pattern: /^へいじつ/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }) },
    // 毎週〇曜
    { pattern: /^毎週(日|月|火|水|木|金|土)(?:曜日?)?/u, getRecurrence: (m: RegExpMatchArray) => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [dayMap[m[1]] ?? 0] }) },
    // 毎週
    { pattern: /^毎週/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [new Date().getDay()] }) },
    { pattern: /^まいしゅう/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [new Date().getDay()] }) },
    // 隔週
    { pattern: /^隔週(日|月|火|水|木|金|土)(?:曜日?)?/u, getRecurrence: (m: RegExpMatchArray) => ({ type: 'weekly' as const, interval: 2, daysOfWeek: [dayMap[m[1]] ?? 0] }) },
    { pattern: /^隔週/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 2, daysOfWeek: [new Date().getDay()] }) },
    { pattern: /^かくしゅう/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 2, daysOfWeek: [new Date().getDay()] }) },
    // 週末毎（土日）
    { pattern: /^週末毎/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [0, 6] }) },
    { pattern: /^毎週末/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [0, 6] }) },
    { pattern: /^しゅうまつごと/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [0, 6] }) },
    // 毎月X日
    { pattern: /^毎月(\d{1,2})日/u, getRecurrence: (m: RegExpMatchArray) => ({ type: 'monthly' as const, interval: 1, dayOfMonth: parseInt(m[1], 10) }) },
    // 毎月
    { pattern: /^毎月/u, getRecurrence: () => ({ type: 'monthly' as const, interval: 1, dayOfMonth: new Date().getDate() }) },
    { pattern: /^まいつき/u, getRecurrence: () => ({ type: 'monthly' as const, interval: 1, dayOfMonth: new Date().getDate() }) },
    // 毎年
    { pattern: /^毎年/u, getRecurrence: () => ({ type: 'yearly' as const, interval: 1 }) },
    { pattern: /^まいとし/u, getRecurrence: () => ({ type: 'yearly' as const, interval: 1 }) },
    { pattern: /^まいねん/u, getRecurrence: () => ({ type: 'yearly' as const, interval: 1 }) },

    // === スペース区切りパターン ===
    // 毎日
    { pattern: /\s毎日(?:\s|$)/u, getRecurrence: () => ({ type: 'daily' as const, interval: 1 }) },
    { pattern: /\sまいにち(?:\s|$)/u, getRecurrence: () => ({ type: 'daily' as const, interval: 1 }) },
    // 隔日
    { pattern: /\s隔日(?:\s|$)/u, getRecurrence: () => ({ type: 'daily' as const, interval: 2 }) },
    { pattern: /\sかくじつ(?:\s|$)/u, getRecurrence: () => ({ type: 'daily' as const, interval: 2 }) },
    // 平日
    { pattern: /\s平日毎日(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }) },
    { pattern: /\s平日(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }) },
    { pattern: /\sへいじつ(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }) },
    // 毎週〇曜
    { pattern: /\s毎週(日|月|火|水|木|金|土)(?:曜日?)?(?:\s|$)/u, getRecurrence: (m: RegExpMatchArray) => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [dayMap[m[1]] ?? 0] }) },
    // 毎週
    { pattern: /\s毎週(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [new Date().getDay()] }) },
    { pattern: /\sまいしゅう(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [new Date().getDay()] }) },
    // 隔週
    { pattern: /\s隔週(日|月|火|水|木|金|土)(?:曜日?)?(?:\s|$)/u, getRecurrence: (m: RegExpMatchArray) => ({ type: 'weekly' as const, interval: 2, daysOfWeek: [dayMap[m[1]] ?? 0] }) },
    { pattern: /\s隔週(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 2, daysOfWeek: [new Date().getDay()] }) },
    { pattern: /\sかくしゅう(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 2, daysOfWeek: [new Date().getDay()] }) },
    // 週末毎
    { pattern: /\s週末毎(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [0, 6] }) },
    { pattern: /\s毎週末(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [0, 6] }) },
    { pattern: /\sしゅうまつごと(?:\s|$)/u, getRecurrence: () => ({ type: 'weekly' as const, interval: 1, daysOfWeek: [0, 6] }) },
    // 毎月X日
    { pattern: /\s毎月(\d{1,2})日(?:\s|$)/u, getRecurrence: (m: RegExpMatchArray) => ({ type: 'monthly' as const, interval: 1, dayOfMonth: parseInt(m[1], 10) }) },
    // 毎月
    { pattern: /\s毎月(?:\s|$)/u, getRecurrence: () => ({ type: 'monthly' as const, interval: 1, dayOfMonth: new Date().getDate() }) },
    { pattern: /\sまいつき(?:\s|$)/u, getRecurrence: () => ({ type: 'monthly' as const, interval: 1, dayOfMonth: new Date().getDate() }) },
    // 毎年
    { pattern: /\s毎年(?:\s|$)/u, getRecurrence: () => ({ type: 'yearly' as const, interval: 1 }) },
    { pattern: /\sまいとし(?:\s|$)/u, getRecurrence: () => ({ type: 'yearly' as const, interval: 1 }) },
    { pattern: /\sまいねん(?:\s|$)/u, getRecurrence: () => ({ type: 'yearly' as const, interval: 1 }) },
  ]

  for (const { pattern, getRecurrence } of recurrencePatterns) {
    const match = text.match(pattern)
    if (match) {
      recurrence = getRecurrence(match)
      text = text.replace(pattern, ' ').trim()
      break
    }
  }

  // 曜日から日数を計算するヘルパー
  const getDaysToWeekday = (targetDay: number, weeksAhead: number = 0): number => {
    const currentDay = now.getDay()
    let diff = targetDay - currentDay
    if (diff <= 0) diff += 7
    return diff + (weeksAhead * 7)
  }

  // 週末（次の土曜日）までの日数
  const getDaysToWeekend = (): number => {
    const currentDay = now.getDay()
    if (currentDay === 6) return 0 // 土曜なら今日
    if (currentDay === 0) return 6 // 日曜なら次の土曜
    return 6 - currentDay
  }

  // 月末までの日数
  const getDaysToMonthEnd = (): number => {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return Math.ceil((lastDay.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  // 来月1日までの日数
  const getDaysToNextMonth = (): number => {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  // 日付を抽出（先頭にある場合も、途中にある場合も対応）
  type DatePatternItem = {
    pattern: RegExp
    getDays: (m: RegExpMatchArray) => number
    tf: Timeframe
  }

  const datePatterns: DatePatternItem[] = [
    // === 先頭パターン ===
    // 今日
    { pattern: /^今日/u, getDays: () => 0, tf: 'today' as Timeframe },
    { pattern: /^きょう/u, getDays: () => 0, tf: 'today' as Timeframe },
    // 明日
    { pattern: /^明日/u, getDays: () => 1, tf: 'today' as Timeframe },
    { pattern: /^あした/u, getDays: () => 1, tf: 'today' as Timeframe },
    { pattern: /^あす/u, getDays: () => 1, tf: 'today' as Timeframe },
    // 明後日
    { pattern: /^明後日/u, getDays: () => 2, tf: 'week' as Timeframe },
    { pattern: /^あさって/u, getDays: () => 2, tf: 'week' as Timeframe },
    // 明々後日（しあさって）
    { pattern: /^明々後日/u, getDays: () => 3, tf: 'week' as Timeframe },
    { pattern: /^しあさって/u, getDays: () => 3, tf: 'week' as Timeframe },
    // 今週〇曜（今週金曜など）
    { pattern: /^今週(日|月|火|水|木|金|土)(?:曜日?)?/u, getDays: (m) => getDaysToWeekday(dayMap[m[1]] ?? 0, 0) - 7, tf: 'week' as Timeframe },
    { pattern: /^こんしゅう(にち|げつ|か|すい|もく|きん|ど)(?:ようび?)?/u, getDays: (m) => {
      const hiraganaMap: Record<string, number> = { 'にち': 0, 'げつ': 1, 'か': 2, 'すい': 3, 'もく': 4, 'きん': 5, 'ど': 6 }
      return getDaysToWeekday(hiraganaMap[m[1]] ?? 0, 0) - 7
    }, tf: 'week' as Timeframe },
    // 今週
    { pattern: /^今週/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    { pattern: /^こんしゅう/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    // 来週〇曜（来週月曜など）
    { pattern: /^来週(日|月|火|水|木|金|土)(?:曜日?)?/u, getDays: (m) => getDaysToWeekday(dayMap[m[1]] ?? 0, 1), tf: 'week' as Timeframe },
    { pattern: /^らいしゅう(にち|げつ|か|すい|もく|きん|ど)(?:ようび?)?/u, getDays: (m) => {
      const hiraganaMap: Record<string, number> = { 'にち': 0, 'げつ': 1, 'か': 2, 'すい': 3, 'もく': 4, 'きん': 5, 'ど': 6 }
      return getDaysToWeekday(hiraganaMap[m[1]] ?? 0, 1)
    }, tf: 'week' as Timeframe },
    // 来週
    { pattern: /^来週/u, getDays: () => 7, tf: 'week' as Timeframe },
    { pattern: /^らいしゅう/u, getDays: () => 7, tf: 'week' as Timeframe },
    // 再来週
    { pattern: /^再来週/u, getDays: () => 14, tf: 'month' as Timeframe },
    { pattern: /^さらいしゅう/u, getDays: () => 14, tf: 'month' as Timeframe },
    // 週末
    { pattern: /^週末/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    { pattern: /^しゅうまつ/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    // 月末
    { pattern: /^月末/u, getDays: () => getDaysToMonthEnd(), tf: 'month' as Timeframe },
    { pattern: /^げつまつ/u, getDays: () => getDaysToMonthEnd(), tf: 'month' as Timeframe },
    // 来月
    { pattern: /^来月/u, getDays: () => getDaysToNextMonth(), tf: 'month' as Timeframe },
    { pattern: /^らいげつ/u, getDays: () => getDaysToNextMonth(), tf: 'month' as Timeframe },
    // X日後
    { pattern: /^(\d+)日後/u, getDays: (m) => parseInt(m[1], 10), tf: 'week' as Timeframe },
    { pattern: /^(\d+)にちご/u, getDays: (m) => parseInt(m[1], 10), tf: 'week' as Timeframe },
    // X週間後
    { pattern: /^(\d+)週間後/u, getDays: (m) => parseInt(m[1], 10) * 7, tf: 'month' as Timeframe },
    { pattern: /^(\d+)しゅうかんご/u, getDays: (m) => parseInt(m[1], 10) * 7, tf: 'month' as Timeframe },
    // X月X日（1/20、1月20日など）- 先頭パターン
    { pattern: /^(\d{1,2})\/(\d{1,2})/u, getDays: (m) => {
      const targetDate = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10))
      if (targetDate < now) targetDate.setFullYear(targetDate.getFullYear() + 1)
      return Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }, tf: 'month' as Timeframe },
    { pattern: /^(\d{1,2})月(\d{1,2})日/u, getDays: (m) => {
      const targetDate = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10))
      if (targetDate < now) targetDate.setFullYear(targetDate.getFullYear() + 1)
      return Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }, tf: 'month' as Timeframe },

    // === スペース区切りパターン ===
    // 今日
    { pattern: /\s今日(?:\s|$)/u, getDays: () => 0, tf: 'today' as Timeframe },
    { pattern: /\sきょう(?:\s|$)/u, getDays: () => 0, tf: 'today' as Timeframe },
    // 明日
    { pattern: /\s明日(?:\s|$)/u, getDays: () => 1, tf: 'today' as Timeframe },
    { pattern: /\sあした(?:\s|$)/u, getDays: () => 1, tf: 'today' as Timeframe },
    { pattern: /\sあす(?:\s|$)/u, getDays: () => 1, tf: 'today' as Timeframe },
    // 明後日
    { pattern: /\s明後日(?:\s|$)/u, getDays: () => 2, tf: 'week' as Timeframe },
    { pattern: /\sあさって(?:\s|$)/u, getDays: () => 2, tf: 'week' as Timeframe },
    // 明々後日
    { pattern: /\s明々後日(?:\s|$)/u, getDays: () => 3, tf: 'week' as Timeframe },
    { pattern: /\sしあさって(?:\s|$)/u, getDays: () => 3, tf: 'week' as Timeframe },
    // 今週〇曜
    { pattern: /\s今週(日|月|火|水|木|金|土)(?:曜日?)?(?:\s|$)/u, getDays: (m) => getDaysToWeekday(dayMap[m[1]] ?? 0, 0) - 7, tf: 'week' as Timeframe },
    // 今週
    { pattern: /\s今週(?:\s|$)/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    { pattern: /\sこんしゅう(?:\s|$)/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    // 来週〇曜
    { pattern: /\s来週(日|月|火|水|木|金|土)(?:曜日?)?(?:\s|$)/u, getDays: (m) => getDaysToWeekday(dayMap[m[1]] ?? 0, 1), tf: 'week' as Timeframe },
    // 来週
    { pattern: /\s来週(?:\s|$)/u, getDays: () => 7, tf: 'week' as Timeframe },
    { pattern: /\sらいしゅう(?:\s|$)/u, getDays: () => 7, tf: 'week' as Timeframe },
    // 再来週
    { pattern: /\s再来週(?:\s|$)/u, getDays: () => 14, tf: 'month' as Timeframe },
    { pattern: /\sさらいしゅう(?:\s|$)/u, getDays: () => 14, tf: 'month' as Timeframe },
    // 週末
    { pattern: /\s週末(?:\s|$)/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    { pattern: /\sしゅうまつ(?:\s|$)/u, getDays: () => getDaysToWeekend(), tf: 'week' as Timeframe },
    // 月末
    { pattern: /\s月末(?:\s|$)/u, getDays: () => getDaysToMonthEnd(), tf: 'month' as Timeframe },
    { pattern: /\sげつまつ(?:\s|$)/u, getDays: () => getDaysToMonthEnd(), tf: 'month' as Timeframe },
    // 来月
    { pattern: /\s来月(?:\s|$)/u, getDays: () => getDaysToNextMonth(), tf: 'month' as Timeframe },
    { pattern: /\sらいげつ(?:\s|$)/u, getDays: () => getDaysToNextMonth(), tf: 'month' as Timeframe },
    // X日後
    { pattern: /\s(\d+)日後(?:\s|$)/u, getDays: (m) => parseInt(m[1], 10), tf: 'week' as Timeframe },
    { pattern: /\s(\d+)にちご(?:\s|$)/u, getDays: (m) => parseInt(m[1], 10), tf: 'week' as Timeframe },
    // X週間後
    { pattern: /\s(\d+)週間後(?:\s|$)/u, getDays: (m) => parseInt(m[1], 10) * 7, tf: 'month' as Timeframe },
    { pattern: /\s(\d+)しゅうかんご(?:\s|$)/u, getDays: (m) => parseInt(m[1], 10) * 7, tf: 'month' as Timeframe },
    // X月X日
    { pattern: /\s(\d{1,2})\/(\d{1,2})(?:\s|$)/u, getDays: (m) => {
      const targetDate = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10))
      if (targetDate < now) targetDate.setFullYear(targetDate.getFullYear() + 1)
      return Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }, tf: 'month' as Timeframe },
    { pattern: /\s(\d{1,2})月(\d{1,2})日(?:\s|$)/u, getDays: (m) => {
      const targetDate = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10))
      if (targetDate < now) targetDate.setFullYear(targetDate.getFullYear() + 1)
      return Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }, tf: 'month' as Timeframe },
  ]

  for (const { pattern, getDays, tf } of datePatterns) {
    const match = text.match(pattern)
    if (match) {
      const days = getDays(match)
      const d = new Date(now)
      d.setDate(d.getDate() + days)
      d.setHours(23, 59, 59, 999)
      dueDate = d.getTime()
      timeframe = tf
      text = text.replace(pattern, ' ').trim()
      break
    }
  }

  // 時刻を抽出
  type TimePatternItem = {
    pattern: RegExp
    getTime: (m: RegExpMatchArray) => { hours: number; minutes: number }
  }

  const timePatterns: TimePatternItem[] = [
    // === 先頭パターン ===
    // HH:MM形式（24時間）
    { pattern: /^(\d{1,2}):(\d{2})/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }) },
    // X時Y分
    { pattern: /^(\d{1,2})時(\d{1,2})分/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }) },
    // X時半
    { pattern: /^(\d{1,2})時半/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 30 }) },
    // X時
    { pattern: /^(\d{1,2})時/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 午前X時Y分
    { pattern: /^午前(\d{1,2})時(\d{1,2})分/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }) },
    // 午前X時半
    { pattern: /^午前(\d{1,2})時半/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 30 }) },
    // 午前X時
    { pattern: /^午前(\d{1,2})時/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 午後X時Y分（12時間制、午後は+12）
    { pattern: /^午後(\d{1,2})時(\d{1,2})分/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h === 12 ? 12 : h + 12, minutes: parseInt(m[2], 10) }
    }},
    // 午後X時半
    { pattern: /^午後(\d{1,2})時半/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h === 12 ? 12 : h + 12, minutes: 30 }
    }},
    // 午後X時
    { pattern: /^午後(\d{1,2})時/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h === 12 ? 12 : h + 12, minutes: 0 }
    }},
    // 朝X時
    { pattern: /^朝(\d{1,2})時/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 夜X時（18時以降とみなす）
    { pattern: /^夜(\d{1,2})時/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h < 12 ? h + 12 : h, minutes: 0 }
    }},
    // 昼X時（正午前後）
    { pattern: /^昼(\d{1,2})時/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 正午
    { pattern: /^正午/u, getTime: () => ({ hours: 12, minutes: 0 }) },
    // 深夜X時
    { pattern: /^深夜(\d{1,2})時/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },

    // === スペース区切りパターン ===
    // HH:MM形式
    { pattern: /\s(\d{1,2}):(\d{2})(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }) },
    // X時Y分
    { pattern: /\s(\d{1,2})時(\d{1,2})分(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }) },
    // X時半
    { pattern: /\s(\d{1,2})時半(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 30 }) },
    // X時
    { pattern: /\s(\d{1,2})時(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 午前X時Y分
    { pattern: /\s午前(\d{1,2})時(\d{1,2})分(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }) },
    // 午前X時半
    { pattern: /\s午前(\d{1,2})時半(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 30 }) },
    // 午前X時
    { pattern: /\s午前(\d{1,2})時(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 午後X時Y分
    { pattern: /\s午後(\d{1,2})時(\d{1,2})分(?:\s|$)/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h === 12 ? 12 : h + 12, minutes: parseInt(m[2], 10) }
    }},
    // 午後X時半
    { pattern: /\s午後(\d{1,2})時半(?:\s|$)/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h === 12 ? 12 : h + 12, minutes: 30 }
    }},
    // 午後X時
    { pattern: /\s午後(\d{1,2})時(?:\s|$)/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h === 12 ? 12 : h + 12, minutes: 0 }
    }},
    // 朝X時
    { pattern: /\s朝(\d{1,2})時(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 夜X時
    { pattern: /\s夜(\d{1,2})時(?:\s|$)/u, getTime: (m) => {
      const h = parseInt(m[1], 10)
      return { hours: h < 12 ? h + 12 : h, minutes: 0 }
    }},
    // 昼X時
    { pattern: /\s昼(\d{1,2})時(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
    // 正午
    { pattern: /\s正午(?:\s|$)/u, getTime: () => ({ hours: 12, minutes: 0 }) },
    // 深夜X時
    { pattern: /\s深夜(\d{1,2})時(?:\s|$)/u, getTime: (m) => ({ hours: parseInt(m[1], 10), minutes: 0 }) },
  ]

  for (const { pattern, getTime } of timePatterns) {
    const match = text.match(pattern)
    if (match) {
      const { hours, minutes } = getTime(match)
      // 時刻が有効範囲か確認
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        // dueDateがすでに設定されていれば時刻だけ更新、なければ今日の日付で設定
        if (dueDate) {
          const d = new Date(dueDate)
          d.setHours(hours, minutes, 0, 0)
          dueDate = d.getTime()
        } else {
          const d = new Date(now)
          d.setHours(hours, minutes, 0, 0)
          // 既に過ぎていたら明日にする
          if (d.getTime() < now.getTime()) {
            d.setDate(d.getDate() + 1)
          }
          dueDate = d.getTime()
          timeframe = 'today'
        }
        text = text.replace(pattern, ' ').trim()
      }
      break
    }
  }

  // 複数スペースを1つに
  text = text.replace(/\s+/g, ' ').trim()

  return {
    text: text || input.trim(),
    priority,
    timeframe,
    dueDate,
    labels,
    recurrence,
    estimatedMinutes: null,  // ローカルフォールバックでは推測しない
  }
}

/**
 * 繰り返しパターンから次回の日付を計算
 */
export function getNextRecurrenceDate(recurrence: RecurrencePattern, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate)
  next.setHours(23, 59, 59, 999)

  switch (recurrence.type) {
    case 'daily':
      next.setDate(next.getDate() + recurrence.interval)
      break

    case 'weekly':
      if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
        const currentDay = next.getDay()
        const sortedDays = [...recurrence.daysOfWeek].sort((a, b) => a - b)

        let nextDay = sortedDays.find(d => d > currentDay)
        if (nextDay !== undefined) {
          next.setDate(next.getDate() + (nextDay - currentDay))
        } else {
          nextDay = sortedDays[0]
          next.setDate(next.getDate() + (7 - currentDay + nextDay) + (recurrence.interval - 1) * 7)
        }
      } else {
        next.setDate(next.getDate() + recurrence.interval * 7)
      }
      break

    case 'monthly':
      if (recurrence.dayOfMonth) {
        next.setMonth(next.getMonth() + recurrence.interval)
        next.setDate(recurrence.dayOfMonth)
      } else {
        next.setMonth(next.getMonth() + recurrence.interval)
      }
      break

    case 'yearly':
      next.setFullYear(next.getFullYear() + recurrence.interval)
      break
  }

  return next
}

/**
 * 繰り返しパターンを人間が読める形式に変換
 */
export function formatRecurrence(recurrence: RecurrencePattern): string {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']

  switch (recurrence.type) {
    case 'daily':
      return recurrence.interval === 1 ? '毎日' : `${recurrence.interval}日ごと`

    case 'weekly':
      if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
        const days = recurrence.daysOfWeek.map(d => dayNames[d]).join('・')
        return recurrence.interval === 1 ? `毎週${days}` : `${recurrence.interval}週間ごと(${days})`
      }
      return recurrence.interval === 1 ? '毎週' : `${recurrence.interval}週間ごと`

    case 'monthly':
      if (recurrence.dayOfMonth) {
        return recurrence.interval === 1 ? `毎月${recurrence.dayOfMonth}日` : `${recurrence.interval}ヶ月ごと(${recurrence.dayOfMonth}日)`
      }
      return recurrence.interval === 1 ? '毎月' : `${recurrence.interval}ヶ月ごと`

    case 'yearly':
      return recurrence.interval === 1 ? '毎年' : `${recurrence.interval}年ごと`
  }
}
