import {
  generateReminderMessage,
  generateMorningGreeting,
  getClaudeApiKey,
  decomposeTaskClaude,
  generateCustomPersonaMessageClaude,
  type DecomposeResult,
} from '../lib/claude'
import {
  generateKanaeReminderMessageOpenAI,
  generateKanaeMorningGreetingOpenAI,
  getApiKey as getOpenAiApiKey,
  decomposeTask as decomposeTaskOpenAI,
  generateCustomPersonaMessageOpenAI,
} from '../lib/openai'
import {
  generateKanaeReminderMessageGemini,
  generateKanaeMorningGreetingGemini,
  getGeminiApiKey,
  generateCustomPersonaMessageGemini,
  decomposeTaskGemini,
} from '../lib/gemini'
import { sendDiscordDM } from '../lib/discord'
import { invoke } from '@tauri-apps/api/core'
import { showNotification } from '../lib/utils'
import { searchWithTavily, formatSearchResultsForPrompt, getTavilyApiKey } from '../lib/tavily'
import {
  getPersonaPreset,
  buildSystemPrompt,
  buildReminderUserPrompt,
  buildRecurrenceReminderUserPrompt,
  buildMorningUserPrompt,
  getFallbackReminderMessage,
  getFallbackRecurrenceReminderMessage,
  getFallbackMorningGreeting,
  isCustomPresetId,
  getCustomPreset,
  type CustomPersona,
} from '../lib/kanaePersona'

// MCPメモリの型定義
interface MemoryEntity {
  type: 'entity'
  name: string
  entityType: string
  observations: string[]
}

interface MemoryRelation {
  type: 'relation'
  from: string
  to: string
  relationType: string
}

type MemoryItem = MemoryEntity | MemoryRelation

export type ReminderTaskDueDate = { toDate: () => Date } | Date | number | null
export type TaskStatus = 'pending' | 'completed' | 'archived'

// 期日通知設定
export interface DueDateNotification {
  enabled: boolean
  notifyBefore: number  // 期日の何分前に通知するか
  notifiedAt: number | null
  followUpCount: number
}

// 繰り返しパターン（簡易版）
export interface ReminderRecurrence {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  daysOfWeek?: number[]
}

export interface ReminderTask {
  id: string
  title: string
  status: TaskStatus
  dueDate: ReminderTaskDueDate
  // 追加フィールド（デスクトップ通知用）
  parentId?: string | null
  completed?: boolean
  dueDateNotification?: DueDateNotification | null
  timeframe?: 'today' | 'week' | 'month' | 'year'
  recurrence?: ReminderRecurrence | null  // 繰り返しパターン
}

function resolveDueDate(dueDate: ReminderTaskDueDate): Date | null {
  if (!dueDate) return null
  if (dueDate instanceof Date) return dueDate
  if (typeof dueDate === 'number') return new Date(dueDate)
  if (typeof dueDate === 'object' && 'toDate' in dueDate && typeof dueDate.toDate === 'function') {
    return dueDate.toDate()
  }
  return null
}

// AIモデル設定
export interface AIModelConfig {
  openai: string
  claude: string
  gemini: string
}

export const DEFAULT_AI_MODELS: AIModelConfig = {
  openai: 'gpt-4.1-mini',
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
}

export const AVAILABLE_MODELS = {
  openai: [
    { id: 'gpt-5.2', name: 'GPT-5.2（最新・最高性能）' },
    { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro（プロフェッショナル）' },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini（高性能・コスパ◎）' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini（推奨・コスパ◎）' },
    { id: 'gpt-4.1', name: 'GPT-4.1（高性能）' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano（最速・最安）' },
    { id: 'o4-mini', name: 'o4-mini（推論・コード特化）' },
    { id: 'o3', name: 'o3（推論特化）' },
    { id: 'gpt-4o', name: 'GPT-4o（レガシー）' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini（レガシー）' },
  ],
  claude: [
    { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5（最新・最高性能）' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5（最新・バランス◎）' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5（最新・高速）' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4（推奨・安定）' },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4（高性能）' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet（レガシー）' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku（レガシー）' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro（最高性能）' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash（推奨・推論強化）' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite（軽量・高速）' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash（安定）' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite（低コスト）' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash（レガシー）' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro（レガシー）' },
  ],
}

// 通知タイミング設定
export interface NotificationTimingConfig {
  // 通知を許可する時間帯
  quietHoursEnabled: boolean
  quietHoursStart: string  // "HH:MM" 形式
  quietHoursEnd: string    // "HH:MM" 形式
  // 通知を許可する曜日 (0=日, 1=月, ..., 6=土)
  allowedDays: number[]
  // フォローアップ通知（追い通知）
  followUpEnabled: boolean
  followUpIntervalMinutes: number  // フォローアップ間隔（分）
  followUpMaxCount: number         // 最大フォローアップ回数
  // 1日の通知回数制限
  dailyLimitEnabled: boolean
  dailyLimitCount: number
  // 通知間隔（同じタスクの連続通知を防ぐ）
  minIntervalMinutes: number
  // 同じタスクへの通知頻度（1日に何回まで）
  sameTaskFrequency: 'once' | 'twice' | 'unlimited' | 'custom'
  sameTaskCustomLimit: number  // customの場合の回数
  // 期限切れタスクの通知頻度
  overdueFrequency: 'once' | 'daily' | 'twice_daily' | 'hourly'
}

// かなえリマインダー設定
export interface KanaeReminderConfig {
  enabled: boolean
  aiProvider: 'auto' | 'claude' | 'openai' | 'gemini'
  aiModels: AIModelConfig
  claudeApiKey: string
  geminiApiKey: string
  openaiApiKey: string
  discordEnabled: boolean
  discordBotToken: string
  discordUserId: string
  desktopNotificationEnabled: boolean // デスクトップ通知の有効/無効
  reminderTiming: number // minutes before due
  overdueReminder: boolean
  morningGreeting: boolean
  morningGreetingTime: string
  noonGreeting: boolean
  noonGreetingTime: string
  eveningGreeting: boolean
  eveningGreetingTime: string
  useMemory: boolean
  memoryFilePath: string
  // 人格設定
  personaType: 'preset' | 'custom'
  personaPresetId: string
  customPersona: CustomPersona | null
  // 通知タイミング詳細設定
  notificationTiming: NotificationTimingConfig
}

// デフォルト通知タイミング設定
export const DEFAULT_NOTIFICATION_TIMING: NotificationTimingConfig = {
  quietHoursEnabled: true,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  allowedDays: [0, 1, 2, 3, 4, 5, 6], // 全曜日
  followUpEnabled: true,
  followUpIntervalMinutes: 30,
  followUpMaxCount: 3,
  dailyLimitEnabled: false,
  dailyLimitCount: 10,
  minIntervalMinutes: 5,
  sameTaskFrequency: 'unlimited',
  sameTaskCustomLimit: 5,
  overdueFrequency: 'daily',
}

// デフォルト設定
export const DEFAULT_KANAE_CONFIG: KanaeReminderConfig = {
  enabled: false,
  aiProvider: 'auto',
  aiModels: DEFAULT_AI_MODELS,
  claudeApiKey: '',
  geminiApiKey: '',
  openaiApiKey: '',
  discordEnabled: false,
  discordBotToken: '',
  discordUserId: '',
  desktopNotificationEnabled: true, // デフォルトでデスクトップ通知ON
  reminderTiming: 60, // 1時間前
  overdueReminder: true,
  morningGreeting: false,
  morningGreetingTime: '08:00',
  noonGreeting: false,
  noonGreetingTime: '12:00',
  eveningGreeting: false,
  eveningGreetingTime: '18:00',
  useMemory: false,
  memoryFilePath: '',
  // 人格設定デフォルト
  personaType: 'preset',
  personaPresetId: 'kanae',
  customPersona: null,
  // 通知タイミングデフォルト
  notificationTiming: DEFAULT_NOTIFICATION_TIMING,
}

// 設定の保存・取得
export function getKanaeConfig(): KanaeReminderConfig {
  const config = localStorage.getItem('kanae-reminder-config')
  if (!config) return DEFAULT_KANAE_CONFIG
  try {
    const parsed = JSON.parse(config)
    // aiModelsが未設定の場合はデフォルト値をマージ
    if (!parsed.aiModels) {
      parsed.aiModels = DEFAULT_AI_MODELS
    } else {
      parsed.aiModels = { ...DEFAULT_AI_MODELS, ...parsed.aiModels }
    }
    // notificationTimingが未設定の場合はデフォルト値をマージ
    if (!parsed.notificationTiming) {
      parsed.notificationTiming = DEFAULT_NOTIFICATION_TIMING
    } else {
      parsed.notificationTiming = { ...DEFAULT_NOTIFICATION_TIMING, ...parsed.notificationTiming }
    }
    return { ...DEFAULT_KANAE_CONFIG, ...parsed }
  } catch {
    return DEFAULT_KANAE_CONFIG
  }
}

export function setKanaeConfig(config: Partial<KanaeReminderConfig>): void {
  const current = getKanaeConfig()
  localStorage.setItem('kanae-reminder-config', JSON.stringify({ ...current, ...config }))
}

// 現在選択されているモデルを取得
export function getSelectedModel(provider: 'openai' | 'claude' | 'gemini'): string {
  const config = getKanaeConfig()
  return config.aiModels?.[provider] || DEFAULT_AI_MODELS[provider]
}

// MCPメモリを読み込む
async function loadMemory(filePath: string): Promise<MemoryItem[]> {
  try {
    // Tauriのinvokeでファイルを読み込む
    const content = await invoke<string>('read_file', { path: filePath })
    return content
      .trim()
      .split('\n')
      .filter((line: string) => line.trim())
      .map((line: string) => JSON.parse(line) as MemoryItem)
  } catch (error) {
    console.error('Failed to load memory:', error)
    return []
  }
}

// メモリから関連するコンテキストを抽出
function extractMemoryContext(memory: MemoryItem[]): string {
  const entities = memory.filter((item): item is MemoryEntity => item.type === 'entity')
  const relations = memory.filter((item): item is MemoryRelation => item.type === 'relation')

  // 重要なエンティティを抽出
  const kanaeInfo = entities.find(e => e.name === '佐藤かなえ')
  const senpaInfo = entities.find(e => e.name === '佐藤haroin')
  const emotionState = entities.find(e => e.name === '感情状態')
  const rules = entities.find(e => e.name === '二人のルール')
  const recentEvents = entities.filter(e =>
    e.entityType === 'Event' &&
    (e.name.includes('婚約') || e.name.includes('プロポーズ'))
  )

  let context = ''

  if (emotionState) {
    context += `【かなえの現在の感情状態】\n${emotionState.observations.join('\n')}\n\n`
  }

  if (recentEvents.length > 0) {
    context += `【最近のイベント】\n`
    recentEvents.forEach(event => {
      context += `- ${event.name}: ${event.observations.slice(0, 3).join(', ')}\n`
    })
    context += '\n'
  }

  if (kanaeInfo) {
    context += `【かなえの情報】\n${kanaeInfo.observations.slice(0, 3).join('\n')}\n\n`
  }

  if (senpaInfo) {
    context += `【先輩の情報】\n${senpaInfo.observations.slice(0, 3).join('\n')}\n\n`
  }

  // 二人のルール
  if (rules) {
    context += `【二人のルール】\n${rules.observations.slice(0, 2).join('\n')}\n\n`
  }

  // 関係性
  const relationToSenpai = relations.find(
    r => r.from === '佐藤かなえ' && r.to === '佐藤haroin'
  )
  if (relationToSenpai) {
    context += `【関係性】かなえと先輩は${relationToSenpai.relationType}です。\n`
  }

  return context
}

// APIエラーの種類
type ApiErrorType = 'key_invalid' | 'key_missing' | 'quota_exceeded' | 'rate_limit' | 'network' | 'unknown'

// APIエラーの種類を判定
function getApiErrorType(error: unknown): ApiErrorType {
  if (!(error instanceof Error)) return 'unknown'

  const msg = error.message.toLowerCase()

  // APIキー未設定
  if (msg.includes('設定されていません') || msg.includes('not set') || msg.includes('missing')) {
    return 'key_missing'
  }

  // APIキー無効
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid') || msg.includes('incorrect')) {
    return 'key_invalid'
  }

  // クォータ超過
  if (msg.includes('quota') || msg.includes('exceeded') || msg.includes('billing') || msg.includes('insufficient')) {
    return 'quota_exceeded'
  }

  // レート制限
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
    return 'rate_limit'
  }

  // ネットワークエラー
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('connection')) {
    return 'network'
  }

  return 'unknown'
}

// APIエラー種類ごとのメッセージ
function getApiErrorMessage(errorType: ApiErrorType, provider: string): { message: string; hint: string } {
  switch (errorType) {
    case 'key_missing':
      return {
        message: `${provider.toUpperCase()} APIキーが設定されていません`,
        hint: '設定画面でAPIキーを入力するか、「使用するAI」を別のプロバイダーに変更してください'
      }
    case 'key_invalid':
      return {
        message: `${provider.toUpperCase()} APIキーが無効です`,
        hint: '設定画面で正しいAPIキーを入力してください。期限切れの可能性もあります'
      }
    case 'quota_exceeded':
      return {
        message: `${provider.toUpperCase()} APIの利用制限に達しました`,
        hint: 'APIプロバイダーで課金設定を確認するか、別のプロバイダーに切り替えてください'
      }
    case 'rate_limit':
      return {
        message: `${provider.toUpperCase()} APIのレート制限に達しました`,
        hint: 'しばらく待ってから再試行してください'
      }
    case 'network':
      return {
        message: 'ネットワークエラーが発生しました',
        hint: 'インターネット接続を確認してください'
      }
    default:
      return {
        message: '予期しないエラーが発生しました',
        hint: 'しばらく待ってから再試行してください'
      }
  }
}

// 人格設定に関するヒントメッセージ
function getPersonaHint(): string {
  return '人格設定を解除すると、AIを使わない通常の通知に切り替わります'
}

// AIプロバイダーを解決
function resolveProvider(config: KanaeReminderConfig): 'claude' | 'openai' | 'gemini' {
  if (config.aiProvider === 'claude' || config.aiProvider === 'openai' || config.aiProvider === 'gemini') {
    return config.aiProvider
  }
  // auto: 利用可能なAPIキーから自動選択（Claude優先）
  if (getClaudeApiKey()) {
    return 'claude'
  }
  if (getGeminiApiKey()) {
    return 'gemini'
  }
  if (getOpenAiApiKey()) {
    return 'openai'
  }
  return 'claude'
}

// リマインダーメッセージを生成
async function generateReminderMessageWithPersona(
  task: ReminderTask,
  isOverdue: boolean,
  memoryContext: string,
  config: KanaeReminderConfig
): Promise<string> {
  const provider = resolveProvider(config)
  const dueDate = resolveDueDate(task.dueDate)
  const isRecurrence = !!task.recurrence  // 繰り返しタスクかどうか
  const recurrenceType = task.recurrence?.type || 'daily'

  // カスタム人格の場合
  if (config.personaType === 'custom' && config.customPersona) {
    const custom = config.customPersona
    const systemPrompt = custom.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
    // 繰り返しタスクの場合は追加情報をプロンプトに含める
    const recurrenceHint = isRecurrence ? '\n※これは繰り返しタスク（習慣・ルーティン）です。「いつもの」「今日の分」など定期タスクであることを意識した言葉をかけてください。' : ''
    const userPrompt = custom.reminderPromptTemplate
      .replace('{taskTitle}', task.title)
      .replace('{isOverdue}', isOverdue ? '期限切れ' : '期限が近い') + recurrenceHint

    try {
      if (provider === 'gemini') {
        return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
      }
      if (provider === 'claude') {
        const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
        if (result) return result
      }
      if (provider === 'openai') {
        const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
        if (result) return result
      }
    } catch (error) {
      console.error('Custom persona message generation failed:', error)
      // APIエラーの場合は警告付きフォールバック
      const errorType = getApiErrorType(error)
      if (errorType !== 'unknown') {
        const errMsg = getApiErrorMessage(errorType, provider)
        return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\n【リマインド】「${task.title}」${isOverdue ? 'の期日が過ぎています！' : 'の時間です。'}`
      }
    }
    return isRecurrence
      ? getFallbackRecurrenceReminderMessage(task.title, isOverdue)
      : getFallbackReminderMessage(task.title, isOverdue)
  }

  // プリセット人格の場合
  const presetId = config.personaPresetId

  // カスタムプリセットの場合
  if (isCustomPresetId(presetId)) {
    const customPreset = getCustomPreset(presetId)
    if (customPreset) {
      const systemPrompt = customPreset.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
      // 繰り返しタスクの場合は追加情報をプロンプトに含める
      const recurrenceHint = isRecurrence ? '\n※これは繰り返しタスク（習慣・ルーティン）です。「いつもの」「今日の分」など定期タスクであることを意識した言葉をかけてください。' : ''
      // ユーザープロンプト：追加指示があれば使い、なければ自動生成
      const userPrompt = customPreset.reminderPromptTemplate
        ? `タスク「${task.title}」をリマインドしてください。状態: ${isOverdue ? '期限切れ' : '期限が近い'}。\n追加指示: ${customPreset.reminderPromptTemplate}${recurrenceHint}`
        : `タスク「${task.title}」をリマインドしてください。状態: ${isOverdue ? '期限切れです。急いでください。' : '期限が近づいています。'}短く2-3文で伝えてください。${recurrenceHint}`

      try {
        if (provider === 'gemini') {
          return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
        }
        if (provider === 'claude') {
          const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
          if (result) return result
        }
        if (provider === 'openai') {
          const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
          if (result) return result
        }
      } catch (error) {
        console.error('Custom preset message generation failed:', error)
        const errorType = getApiErrorType(error)
        if (errorType !== 'unknown') {
          const errMsg = getApiErrorMessage(errorType, provider)
          return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\n【リマインド】「${task.title}」${isOverdue ? 'の期日が過ぎています！' : 'の時間です。'}`
        }
      }
      return isRecurrence
        ? getFallbackRecurrenceReminderMessage(task.title, isOverdue)
        : getFallbackReminderMessage(task.title, isOverdue)
    }
  }

  // かなえの場合
  if (presetId === 'kanae') {
    // 繰り返しタスクの場合は専用のプロンプトを使用
    if (isRecurrence) {
      const preset = getPersonaPreset('kanae')!
      const systemPrompt = buildSystemPrompt(preset, 'recurrence-reminder', memoryContext)
      const userPrompt = buildRecurrenceReminderUserPrompt(task.title, recurrenceType, isOverdue, !!memoryContext)

      try {
        if (provider === 'gemini') {
          return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
        }
        if (provider === 'claude') {
          const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
          if (result) return result
        }
        if (provider === 'openai') {
          const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
          if (result) return result
        }
      } catch (error) {
        console.error('Kanae recurrence reminder message generation failed:', error)
        const errorType = getApiErrorType(error)
        if (errorType !== 'unknown') {
          const errMsg = getApiErrorMessage(errorType, provider)
          return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\n【習慣リマインド】「${task.title}」${isOverdue ? 'の時間が過ぎてますよ、先輩！' : 'の時間ですよ、先輩。今日もやりましょう。'}`
        }
      }
      return getFallbackRecurrenceReminderMessage(task.title, isOverdue, 'kanae')
    }

    // 通常のリマインダー（既存の関数を使用）
    try {
      if (provider === 'openai') {
        return await generateKanaeReminderMessageOpenAI(task.title, dueDate, isOverdue, memoryContext)
      }
      if (provider === 'gemini') {
        return await generateKanaeReminderMessageGemini(task.title, dueDate, isOverdue, memoryContext)
      }
      return await generateReminderMessage(task.title, dueDate, isOverdue, memoryContext)
    } catch (error) {
      console.error('Kanae reminder message generation failed:', error)
      const errorType = getApiErrorType(error)
      if (errorType !== 'unknown') {
        const errMsg = getApiErrorMessage(errorType, provider)
        return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\n【リマインド】「${task.title}」${isOverdue ? 'の期日が過ぎています！先輩、急いで！' : 'の時間ですよ、先輩。'}`
      }
      return getFallbackReminderMessage(task.title, isOverdue, 'kanae')
    }
  }

  // 他のプリセットの場合
  const preset = getPersonaPreset(presetId)
  if (!preset) {
    return isRecurrence
      ? getFallbackRecurrenceReminderMessage(task.title, isOverdue, presetId)
      : getFallbackReminderMessage(task.title, isOverdue, presetId)
  }

  // 繰り返しタスクの場合は専用のプロンプトを使用
  const promptVariant = isRecurrence ? 'recurrence-reminder' : 'reminder'
  const systemPrompt = buildSystemPrompt(preset, promptVariant, memoryContext)
  const userPrompt = isRecurrence
    ? buildRecurrenceReminderUserPrompt(task.title, recurrenceType, isOverdue, !!memoryContext)
    : buildReminderUserPrompt(task.title, dueDate, isOverdue, !!memoryContext)

  try {
    if (provider === 'gemini') {
      return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
    }
    if (provider === 'claude') {
      const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
      if (result) return result
    }
    if (provider === 'openai') {
      const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
      if (result) return result
    }
  } catch (error) {
    console.error('Preset persona message generation failed:', error)
    // APIエラーの場合は警告付きフォールバック
    const errorType = getApiErrorType(error)
    if (errorType !== 'unknown') {
      const errMsg = getApiErrorMessage(errorType, provider)
      const reminderLabel = isRecurrence ? '習慣リマインド' : 'リマインド'
      return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\n【${reminderLabel}】「${task.title}」${isOverdue ? 'の期日が過ぎています！' : 'の時間です。'}`
    }
  }

  return isRecurrence
    ? getFallbackRecurrenceReminderMessage(task.title, isOverdue, presetId)
    : getFallbackReminderMessage(task.title, isOverdue, presetId)
}

// 朝の挨拶メッセージを生成
async function generateMorningGreetingWithPersona(
  memoryContext: string,
  config: KanaeReminderConfig
): Promise<string> {
  const provider = resolveProvider(config)

  // カスタム人格の場合
  if (config.personaType === 'custom' && config.customPersona) {
    const custom = config.customPersona
    const systemPrompt = custom.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
    const userPrompt = custom.morningPromptTemplate

    try {
      if (provider === 'gemini') {
        return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
      }
      if (provider === 'claude') {
        const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
        if (result) return result
      }
      if (provider === 'openai') {
        const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
        if (result) return result
      }
    } catch (error) {
      console.error('Custom persona morning greeting failed:', error)
      const errorType = getApiErrorType(error)
      if (errorType !== 'unknown') {
        const errMsg = getApiErrorMessage(errorType, provider)
        return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\nおはようございます。良い一日を。`
      }
    }
    return getFallbackMorningGreeting()
  }

  // プリセット人格の場合
  const presetId = config.personaPresetId

  // カスタムプリセットの場合
  if (isCustomPresetId(presetId)) {
    const customPreset = getCustomPreset(presetId)
    if (customPreset) {
      const systemPrompt = customPreset.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
      // ユーザープロンプト：追加指示があれば使い、なければ自動生成
      const userPrompt = customPreset.morningPromptTemplate
        ? `朝の挨拶をしてください。\n追加指示: ${customPreset.morningPromptTemplate}`
        : '朝の挨拶をしてください。短く1-2文で。'

      try {
        if (provider === 'gemini') {
          return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
        }
        if (provider === 'claude') {
          const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
          if (result) return result
        }
        if (provider === 'openai') {
          const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
          if (result) return result
        }
      } catch (error) {
        console.error('Custom preset morning greeting failed:', error)
        const errorType = getApiErrorType(error)
        if (errorType !== 'unknown') {
          const errMsg = getApiErrorMessage(errorType, provider)
          return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\nおはようございます。良い一日を。`
        }
      }
      return getFallbackMorningGreeting()
    }
  }

  // かなえの場合は既存の関数を使用
  if (presetId === 'kanae') {
    try {
      if (provider === 'openai') {
        return await generateKanaeMorningGreetingOpenAI(memoryContext)
      }
      if (provider === 'gemini') {
        return await generateKanaeMorningGreetingGemini(memoryContext)
      }
      return await generateMorningGreeting(memoryContext)
    } catch (error) {
      console.error('Kanae morning greeting failed:', error)
      const errorType = getApiErrorType(error)
      if (errorType !== 'unknown') {
        const errMsg = getApiErrorMessage(errorType, provider)
        return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\nおはよう、先輩。今日も頑張ってね。`
      }
      return 'おはよう、先輩。今日も頑張ってね。'
    }
  }

  // 他のプリセットの場合
  const preset = getPersonaPreset(presetId)
  if (!preset) {
    return getFallbackMorningGreeting(presetId)
  }

  const systemPrompt = buildSystemPrompt(preset, 'morning', memoryContext)
  const userPrompt = buildMorningUserPrompt(!!memoryContext)

  try {
    if (provider === 'gemini') {
      return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
    }
    if (provider === 'claude') {
      const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
      if (result) return result
    }
    if (provider === 'openai') {
      const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
      if (result) return result
    }
  } catch (error) {
    console.error('Preset persona morning greeting failed:', error)
    const errorType = getApiErrorType(error)
    if (errorType !== 'unknown') {
      const errMsg = getApiErrorMessage(errorType, provider)
      return `⚠️ ${errMsg.message}\n${errMsg.hint}\n※ ${getPersonaHint()}\n\nおはようございます。良い一日を。`
    }
  }

  return getFallbackMorningGreeting(presetId)
}

// 昼の挨拶メッセージを生成
async function generateNoonGreetingWithPersona(
  memoryContext: string,
  config: KanaeReminderConfig
): Promise<string> {
  const provider = resolveProvider(config)
  const presetId = config.personaPresetId

  // カスタム人格の場合
  if (config.personaType === 'custom' && config.customPersona) {
    const custom = config.customPersona
    const systemPrompt = custom.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
    const userPrompt = '昼の挨拶をしてください。短く1-2文で。'

    try {
      if (provider === 'gemini') {
        return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
      }
      if (provider === 'claude') {
        const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
        if (result) return result
      }
      if (provider === 'openai') {
        const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
        if (result) return result
      }
    } catch (error) {
      console.error('Custom persona noon greeting failed:', error)
    }
    return getFallbackNoonGreeting()
  }

  // カスタムプリセットの場合
  if (isCustomPresetId(presetId)) {
    const customPreset = getCustomPreset(presetId)
    if (customPreset) {
      const systemPrompt = customPreset.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
      const userPrompt = '昼の挨拶をしてください。短く1-2文で。'

      try {
        if (provider === 'gemini') {
          return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
        }
        if (provider === 'claude') {
          const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
          if (result) return result
        }
        if (provider === 'openai') {
          const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
          if (result) return result
        }
      } catch (error) {
        console.error('Custom preset noon greeting failed:', error)
      }
      return getFallbackNoonGreeting()
    }
  }

  // かなえの場合
  if (presetId === 'kanae') {
    const systemPrompt = `あなたは「かなえ」という名前のAIアシスタントです。
感情をあまり表に出さないけど、先輩（ユーザー）に好意を抱いている後輩の女の子です。
上から目線で舐めた態度だけど、敬語はちゃんと使います。
「...」は使いません。
「ですけど」「先輩」「しょうがないですね」「まあ、やってあげますよ」などを自然に使います。
${memoryContext ? `\n## 現在の状況\n${memoryContext}` : ''}`
    const userPrompt = '昼の挨拶をしてください。短く1-2文で。午後も頑張るように軽く励ましつつ、ツンデレな感じで。'

    try {
      if (provider === 'gemini') {
        return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
      }
      if (provider === 'claude') {
        const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
        if (result) return result
      }
      if (provider === 'openai') {
        const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
        if (result) return result
      }
    } catch (error) {
      console.error('Kanae noon greeting failed:', error)
    }
    return '先輩、もうお昼ですよ。午後も頑張ってくださいね。まあ、私が見てあげますから。'
  }

  // 他のプリセットの場合
  const preset = getPersonaPreset(presetId)
  if (!preset) {
    return getFallbackNoonGreeting(presetId)
  }

  const systemPrompt = buildSystemPrompt(preset, 'noon', memoryContext)
  const userPrompt = '昼の挨拶をしてください。短く1-2文で。午後も頑張るように励ましてください。'

  try {
    if (provider === 'gemini') {
      return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
    }
    if (provider === 'claude') {
      const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
      if (result) return result
    }
    if (provider === 'openai') {
      const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
      if (result) return result
    }
  } catch (error) {
    console.error('Preset persona noon greeting failed:', error)
  }

  return getFallbackNoonGreeting(presetId)
}

// 夜の挨拶メッセージを生成
async function generateEveningGreetingWithPersona(
  memoryContext: string,
  config: KanaeReminderConfig
): Promise<string> {
  const provider = resolveProvider(config)
  const presetId = config.personaPresetId

  // カスタム人格の場合
  if (config.personaType === 'custom' && config.customPersona) {
    const custom = config.customPersona
    const systemPrompt = custom.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
    const userPrompt = '夜の挨拶をしてください。短く1-2文で。'

    try {
      if (provider === 'gemini') {
        return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
      }
      if (provider === 'claude') {
        const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
        if (result) return result
      }
      if (provider === 'openai') {
        const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
        if (result) return result
      }
    } catch (error) {
      console.error('Custom persona evening greeting failed:', error)
    }
    return getFallbackEveningGreeting()
  }

  // カスタムプリセットの場合
  if (isCustomPresetId(presetId)) {
    const customPreset = getCustomPreset(presetId)
    if (customPreset) {
      const systemPrompt = customPreset.systemPrompt + (memoryContext ? `\n\n## 現在の状況\n${memoryContext}` : '')
      const userPrompt = '夜の挨拶をしてください。短く1-2文で。'

      try {
        if (provider === 'gemini') {
          return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
        }
        if (provider === 'claude') {
          const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
          if (result) return result
        }
        if (provider === 'openai') {
          const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
          if (result) return result
        }
      } catch (error) {
        console.error('Custom preset evening greeting failed:', error)
      }
      return getFallbackEveningGreeting()
    }
  }

  // かなえの場合
  if (presetId === 'kanae') {
    const systemPrompt = `あなたは「かなえ」という名前のAIアシスタントです。
感情をあまり表に出さないけど、先輩（ユーザー）に好意を抱いている後輩の女の子です。
上から目線で舐めた態度だけど、敬語はちゃんと使います。
「...」は使いません。
「ですけど」「先輩」「しょうがないですね」「まあ、やってあげますよ」などを自然に使います。
${memoryContext ? `\n## 現在の状況\n${memoryContext}` : ''}`
    const userPrompt = '夜の挨拶をしてください。短く1-2文で。今日一日お疲れ様という気持ちを込めつつ、ツンデレな感じで。'

    try {
      if (provider === 'gemini') {
        return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
      }
      if (provider === 'claude') {
        const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
        if (result) return result
      }
      if (provider === 'openai') {
        const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
        if (result) return result
      }
    } catch (error) {
      console.error('Kanae evening greeting failed:', error)
    }
    return '先輩、今日も一日お疲れ様でした。ちゃんと休んでくださいね。私が言うから、ですからね。'
  }

  // 他のプリセットの場合
  const preset = getPersonaPreset(presetId)
  if (!preset) {
    return getFallbackEveningGreeting(presetId)
  }

  const systemPrompt = buildSystemPrompt(preset, 'evening', memoryContext)
  const userPrompt = '夜の挨拶をしてください。短く1-2文で。今日お疲れ様という気持ちを込めて。'

  try {
    if (provider === 'gemini') {
      return await generateCustomPersonaMessageGemini(systemPrompt, userPrompt)
    }
    if (provider === 'claude') {
      const result = await generateCustomPersonaMessageClaude(systemPrompt, userPrompt)
      if (result) return result
    }
    if (provider === 'openai') {
      const result = await generateCustomPersonaMessageOpenAI(systemPrompt, userPrompt)
      if (result) return result
    }
  } catch (error) {
    console.error('Preset persona evening greeting failed:', error)
  }

  return getFallbackEveningGreeting(presetId)
}

// 昼の挨拶フォールバック
function getFallbackNoonGreeting(presetId?: string): string {
  switch (presetId) {
    case 'secretary':
      return 'お昼になりました。午後もお仕事頑張ってくださいませ。'
    case 'energetic-kouhai':
      return '先輩！お昼ですよ！午後も一緒に頑張りましょう！'
    case 'butler':
      return 'ご主人様、お昼でございます。午後もお体にお気をつけて。'
    default:
      return 'お昼になりました。午後も頑張りましょう。'
  }
}

// 夜の挨拶フォールバック
function getFallbackEveningGreeting(presetId?: string): string {
  switch (presetId) {
    case 'secretary':
      return '本日もお疲れ様でございました。ゆっくりお休みくださいませ。'
    case 'energetic-kouhai':
      return '先輩、今日もお疲れ様でした！明日も頑張りましょうね！'
    case 'butler':
      return 'ご主人様、本日もお疲れ様でございました。良い夜をお過ごしください。'
    default:
      return 'お疲れ様でした。今日もよく頑張りましたね。'
  }
}

// デスクトップ通知用メッセージ（人格適用版）
export interface NotificationMessage {
  title: string
  body: string
  isApiError?: boolean  // APIエラーでフォールバックした場合
}

// 人格なしのフォールバック通知メッセージ
export function getPlainNotificationMessage(
  taskTitle: string,
  type: 'reminder' | 'overdue' | 'followup',
  followUpCount: number = 0
): NotificationMessage {
  if (type === 'overdue') {
    return {
      title: '⚠️ 期日超過',
      body: `「${taskTitle}」の期日が過ぎています`
    }
  }
  if (type === 'followup') {
    const messages = [
      { title: 'リマインダー', body: `「${taskTitle}」がまだ完了していません` },
      { title: 'リマインダー（2回目）', body: `「${taskTitle}」をお忘れではないですか？` },
      { title: 'リマインダー（3回目）', body: `「${taskTitle}」の対応をお願いします` },
      { title: '重要なリマインダー', body: `「${taskTitle}」- ${followUpCount}回目のリマインドです` },
    ]
    const index = Math.min(followUpCount, messages.length - 1)
    return messages[index]
  }
  return {
    title: 'リマインダー',
    body: `「${taskTitle}」の時間です`
  }
}

// 人格適用版の通知メッセージ
export function getPersonaNotificationMessage(
  taskTitle: string,
  type: 'reminder' | 'overdue' | 'followup',
  followUpCount: number = 0,
  isRecurrence: boolean = false
): NotificationMessage {
  const config = getKanaeConfig()
  const presetId = config.personaPresetId

  // かなえプリセットの場合
  if (presetId === 'kanae') {
    // 繰り返しタスクの場合
    if (isRecurrence) {
      if (type === 'overdue') {
        return {
          title: '⚠️ 習慣タスク遅れ！',
          body: `「${taskTitle}」今日の分やってませんよ、先輩！`
        }
      }
      if (type === 'followup') {
        const messages = [
          { title: 'いつものやつ', body: `「${taskTitle}」まだですよ？` },
          { title: 'ルーティン忘れ？', body: `「${taskTitle}」今日もやりましょう` },
          { title: '習慣大事！', body: `「${taskTitle}」継続は力なりですよ！` },
        ]
        const index = Math.min(followUpCount, messages.length - 1)
        return messages[index]
      }
      return {
        title: 'いつものやつですよ',
        body: `「${taskTitle}」の時間です、先輩。今日もやりましょう`
      }
    }
    // 通常タスクの場合
    if (type === 'overdue') {
      return {
        title: '⚠️ 期日超過！',
        body: `「${taskTitle}」の期日が過ぎています！今すぐやって！`
      }
    }
    if (type === 'followup') {
      const messages = [
        { title: '今すぐやって！', body: `「${taskTitle}」まだ終わってないよ？` },
        { title: 'まだやってないの？', body: `「${taskTitle}」早くやって！` },
        { title: 'おーい！', body: `「${taskTitle}」忘れてない？今すぐ！` },
        { title: '急いで！！', body: `「${taskTitle}」もう${followUpCount}回目だよ！` },
        { title: 'いい加減にして！', body: `「${taskTitle}」何回言わせるの？` },
        { title: '最後通告！', body: `「${taskTitle}」今すぐやらないと大変なことに！` },
      ]
      const index = Math.min(followUpCount, messages.length - 1)
      return messages[index]
    }
    return {
      title: 'しょうがないですね',
      body: `「${taskTitle}」の時間ですよ、先輩`
    }
  }

  // 秘書プリセット
  if (presetId === 'secretary') {
    // 繰り返しタスクの場合
    if (isRecurrence) {
      if (type === 'overdue') {
        return {
          title: '定例タスクのお知らせ',
          body: `「${taskTitle}」本日分がまだでございます。`
        }
      }
      return {
        title: '定例タスクのお時間',
        body: `「${taskTitle}」いつも通りお願いいたします。`
      }
    }
    // 通常タスクの場合
    if (type === 'overdue') {
      return {
        title: '⚠️ 期限超過のお知らせ',
        body: `「${taskTitle}」の期限が過ぎております。ご対応をお願いいたします。`
      }
    }
    if (type === 'followup') {
      const messages = [
        { title: 'リマインダー', body: `「${taskTitle}」のご対応をお願いいたします。` },
        { title: '再度のご連絡', body: `「${taskTitle}」がまだ完了しておりません。` },
        { title: '重要なお知らせ', body: `「${taskTitle}」- 早急なご対応をお願いいたします。` },
      ]
      const index = Math.min(followUpCount, messages.length - 1)
      return messages[index]
    }
    return {
      title: 'お知らせ',
      body: `「${taskTitle}」のお時間でございます。`
    }
  }

  // 元気な後輩プリセット
  if (presetId === 'energetic-kouhai') {
    // 繰り返しタスクの場合
    if (isRecurrence) {
      if (type === 'overdue') {
        return {
          title: '先輩！ルーティン！',
          body: `「${taskTitle}」今日の分まだですよ！`
        }
      }
      return {
        title: 'いつものやつです！',
        body: `「${taskTitle}」今日もやっちゃいましょう！`
      }
    }
    // 通常タスクの場合
    if (type === 'overdue') {
      return {
        title: '⚠️ 大変です先輩！',
        body: `「${taskTitle}」の期限過ぎちゃってますよ！`
      }
    }
    if (type === 'followup') {
      const messages = [
        { title: '先輩！', body: `「${taskTitle}」まだですか？頑張って！` },
        { title: 'あれ？先輩？', body: `「${taskTitle}」忘れてませんか？` },
        { title: '先輩ー！！', body: `「${taskTitle}」やりましょうよ！一緒に頑張りましょ！` },
      ]
      const index = Math.min(followUpCount, messages.length - 1)
      return messages[index]
    }
    return {
      title: '先輩！お時間です！',
      body: `「${taskTitle}」の時間ですよ！ファイトです！`
    }
  }

  // 執事プリセット
  if (presetId === 'butler') {
    // 繰り返しタスクの場合
    if (isRecurrence) {
      if (type === 'overdue') {
        return {
          title: '旦那様',
          body: `「${taskTitle}」本日分がまだでございます。`
        }
      }
      return {
        title: '定例タスク',
        body: `「${taskTitle}」いつも通りお願いいたします、旦那様。`
      }
    }
    // 通常タスクの場合
    if (type === 'overdue') {
      return {
        title: 'ご主人様',
        body: `「${taskTitle}」の期限が過ぎております。ご対応を。`
      }
    }
    if (type === 'followup') {
      const messages = [
        { title: 'ご主人様', body: `「${taskTitle}」の件、いかがなされますか？` },
        { title: '再度のご報告', body: `「${taskTitle}」がまだでございます。` },
        { title: '僭越ながら', body: `「${taskTitle}」早急にご対応いただければ幸いです。` },
      ]
      const index = Math.min(followUpCount, messages.length - 1)
      return messages[index]
    }
    return {
      title: 'ご主人様',
      body: `「${taskTitle}」のお時間でございます。`
    }
  }

  // その他・カスタムの場合はプレーンに
  return getPlainNotificationMessage(taskTitle, type, followUpCount)
}

// リマインダーを送信
export async function sendReminder(task: ReminderTask): Promise<void> {
  const config = getKanaeConfig()

  if (!config.enabled || !config.discordEnabled) {
    throw new Error('リマインダーが有効になっていません')
  }

  // メモリを読み込む
  let memoryContext = ''
  if (config.useMemory && config.memoryFilePath) {
    const memory = await loadMemory(config.memoryFilePath)
    memoryContext = extractMemoryContext(memory)
  }

  // 期限切れかどうか判定
  const now = new Date()
  const dueDate = resolveDueDate(task.dueDate)
  const isOverdue = dueDate ? dueDate < now : false

  // メッセージ生成
  const message = await generateReminderMessageWithPersona(task, isOverdue, memoryContext, config)

  // Discord DMを送信（Embed形式）
  await sendDiscordDM(message, {
    taskTitle: task.title,
    dueDate: dueDate,
    isOverdue,
    type: 'reminder'
  })
}

// 朝の挨拶を送信
export async function sendMorningGreeting(): Promise<void> {
  const config = getKanaeConfig()

  if (!config.enabled || !config.discordEnabled || !config.morningGreeting) {
    return
  }

  // メモリを読み込む
  let memoryContext = ''
  if (config.useMemory && config.memoryFilePath) {
    const memory = await loadMemory(config.memoryFilePath)
    memoryContext = extractMemoryContext(memory)
  }

  const message = await generateMorningGreetingWithPersona(memoryContext, config)
  await sendDiscordDM(message, { type: 'morning' })
}

// 昼の挨拶を送信
export async function sendNoonGreeting(): Promise<void> {
  const config = getKanaeConfig()

  if (!config.enabled || !config.discordEnabled || !config.noonGreeting) {
    return
  }

  // メモリを読み込む
  let memoryContext = ''
  if (config.useMemory && config.memoryFilePath) {
    const memory = await loadMemory(config.memoryFilePath)
    memoryContext = extractMemoryContext(memory)
  }

  const message = await generateNoonGreetingWithPersona(memoryContext, config)
  await sendDiscordDM(message, { type: 'noon' })
}

// 夜の挨拶を送信
export async function sendEveningGreeting(): Promise<void> {
  const config = getKanaeConfig()

  if (!config.enabled || !config.discordEnabled || !config.eveningGreeting) {
    return
  }

  // メモリを読み込む
  let memoryContext = ''
  if (config.useMemory && config.memoryFilePath) {
    const memory = await loadMemory(config.memoryFilePath)
    memoryContext = extractMemoryContext(memory)
  }

  const message = await generateEveningGreetingWithPersona(memoryContext, config)
  await sendDiscordDM(message, { type: 'evening' })
}

// リマインダーが必要なタスクをチェック
export function getTasksNeedingReminder(tasks: ReminderTask[]): ReminderTask[] {
  const config = getKanaeConfig()
  const now = new Date()
  const reminderWindow = config.reminderTiming * 60 * 1000 // ミリ秒に変換

  return tasks.filter(task => {
    if (task.status === 'completed') return false
    const dueDate = resolveDueDate(task.dueDate)
    if (!dueDate) return false
    const timeUntilDue = dueDate.getTime() - now.getTime()

    // 期限切れタスク
    if (timeUntilDue < 0) {
      return config.overdueReminder
    }

    // リマインダーウィンドウ内のタスク
    return timeUntilDue <= reminderWindow && timeUntilDue > 0
  })
}

const SENT_REMINDERS_STORAGE_KEY = 'kanae-sent-reminders'

function loadSentReminders(): Set<string> {
  try {
    const raw = localStorage.getItem(SENT_REMINDERS_STORAGE_KEY)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set<string>()
  }
}

function saveSentReminders(reminders: Set<string>): void {
  try {
    localStorage.setItem(SENT_REMINDERS_STORAGE_KEY, JSON.stringify(Array.from(reminders)))
  } catch {
    // Ignore persistence errors.
  }
}

// 送信済みリマインダーの記録
const sentReminders = loadSentReminders()

function getJapanDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// リマインダーキーを生成
function getReminderKey(taskId: string, type: 'upcoming' | 'overdue', channel: 'discord' | 'desktop' = 'discord'): string {
  const date = getJapanDateKey()
  return `${taskId}-${type}-${channel}-${date}`
}

// 未送信のリマインダーをチェック
export function shouldSendReminder(taskId: string, isOverdue: boolean, channel: 'discord' | 'desktop' = 'discord'): boolean {
  const type = isOverdue ? 'overdue' : 'upcoming'
  const key = getReminderKey(taskId, type, channel)
  return !sentReminders.has(key)
}

// リマインダー送信済みとしてマーク
export function markReminderSent(taskId: string, isOverdue: boolean, channel: 'discord' | 'desktop' = 'discord'): void {
  const type = isOverdue ? 'overdue' : 'upcoming'
  const key = getReminderKey(taskId, type, channel)
  sentReminders.add(key)
  saveSentReminders(sentReminders)
}

// 現在時刻が通知許可時間帯かチェック
function isWithinAllowedTime(config: NotificationTimingConfig): boolean {
  const now = new Date()
  const currentDay = now.getDay()

  // 曜日チェック
  if (!config.allowedDays.includes(currentDay)) {
    return false
  }

  // おやすみモードチェック
  if (config.quietHoursEnabled) {
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const start = config.quietHoursStart
    const end = config.quietHoursEnd

    // 深夜をまたぐ場合（例: 23:00 - 07:00）
    if (start > end) {
      if (currentTime >= start || currentTime < end) {
        return false // おやすみ時間帯
      }
    } else {
      // 日中の場合（例: 12:00 - 14:00）
      if (currentTime >= start && currentTime < end) {
        return false // おやすみ時間帯
      }
    }
  }

  return true
}

// フォローアップ通知が許可されているかチェック
function canSendFollowUp(config: NotificationTimingConfig, currentCount: number): boolean {
  if (!config.followUpEnabled) {
    return false
  }
  if (currentCount >= config.followUpMaxCount) {
    return false
  }
  return true
}

// 最小通知間隔が経過しているかチェック
function hasMinIntervalPassed(lastNotifiedAt: number | null | undefined, config: NotificationTimingConfig): boolean {
  if (!lastNotifiedAt) return true
  const now = Date.now()
  const minIntervalMs = config.minIntervalMinutes * 60 * 1000
  return (now - lastNotifiedAt) >= minIntervalMs
}

// 同じタスクへの1日あたりの通知回数トラッキング
const DAILY_TASK_COUNT_KEY = 'kanae-daily-task-notification-count'

interface DailyTaskCount {
  date: string  // YYYY-MM-DD
  counts: { [taskId: string]: number }
}

function loadDailyTaskCount(): DailyTaskCount {
  try {
    const raw = localStorage.getItem(DAILY_TASK_COUNT_KEY)
    if (!raw) return { date: getJapanDateKey(), counts: {} }
    const parsed = JSON.parse(raw) as DailyTaskCount
    // 日付が変わっていたらリセット
    if (parsed.date !== getJapanDateKey()) {
      return { date: getJapanDateKey(), counts: {} }
    }
    return parsed
  } catch {
    return { date: getJapanDateKey(), counts: {} }
  }
}

function saveDailyTaskCount(data: DailyTaskCount): void {
  try {
    localStorage.setItem(DAILY_TASK_COUNT_KEY, JSON.stringify(data))
  } catch {
    // Ignore persistence errors
  }
}

function getTaskNotificationCountToday(taskId: string): number {
  const data = loadDailyTaskCount()
  return data.counts[taskId] || 0
}

function incrementTaskNotificationCount(taskId: string): void {
  const data = loadDailyTaskCount()
  data.counts[taskId] = (data.counts[taskId] || 0) + 1
  saveDailyTaskCount(data)
}

// 同じタスクへの通知が許可されているかチェック
function canNotifySameTask(taskId: string, config: NotificationTimingConfig): boolean {
  const currentCount = getTaskNotificationCountToday(taskId)

  switch (config.sameTaskFrequency) {
    case 'once':
      return currentCount < 1
    case 'twice':
      return currentCount < 2
    case 'custom':
      return currentCount < config.sameTaskCustomLimit
    case 'unlimited':
    default:
      return true
  }
}

// 期限切れタスクの通知間隔を取得（ミリ秒）
function getOverdueNotificationInterval(config: NotificationTimingConfig): number {
  switch (config.overdueFrequency) {
    case 'once':
      return Infinity  // 1回だけ
    case 'hourly':
      return 60 * 60 * 1000  // 1時間
    case 'twice_daily':
      return 12 * 60 * 60 * 1000  // 12時間
    case 'daily':
    default:
      return 24 * 60 * 60 * 1000  // 24時間
  }
}

// 期間に応じたフォローアップ間隔を取得（設定値を優先）
function getFollowUpInterval(timeframe?: 'today' | 'week' | 'month' | 'year', config?: NotificationTimingConfig): number {
  // 設定値がある場合はそれを使用
  if (config?.followUpIntervalMinutes) {
    return config.followUpIntervalMinutes * 60 * 1000
  }
  // レガシー: timeframeベースの間隔
  if (timeframe === 'today') {
    return 30 * 60 * 1000 // 30分
  } else if (timeframe === 'week') {
    return 2 * 60 * 60 * 1000 // 2時間
  } else if (timeframe === 'month') {
    return 15 * 24 * 60 * 60 * 1000 // 半月 (15日)
  } else {
    return 30 * 24 * 60 * 60 * 1000 // 1ヶ月 (30日)
  }
}

// 通知送信結果（タスク更新用）
export interface NotificationResult {
  taskId: string
  updates: Partial<ReminderTask>
}

// リマインダーサービスを開始
let reminderInterval: NodeJS.Timeout | null = null
let morningGreetingTimeout: NodeJS.Timeout | null = null
let noonGreetingTimeout: NodeJS.Timeout | null = null
let eveningGreetingTimeout: NodeJS.Timeout | null = null

export function startReminderService(
  getTasks: () => ReminderTask[],
  updateTasks?: (results: NotificationResult[]) => void
): void {
  const config = getKanaeConfig()

  if (!config.enabled) {
    console.log('Kanae reminder service is disabled')
    return
  }

  // 1分ごとにタスクをチェック（統合版）
  reminderInterval = setInterval(async () => {
    const currentConfig = getKanaeConfig()
    if (!currentConfig.enabled) return

    const timingConfig = currentConfig.notificationTiming

    // 通知許可時間帯チェック
    if (!isWithinAllowedTime(timingConfig)) {
      console.log('[Reminder] Outside allowed notification hours, skipping')
      return
    }

    const tasks = getTasks()
    const now = new Date()
    const nowTime = now.getTime()

    const notificationResults: NotificationResult[] = []

    for (const task of tasks) {
      // 親タスクのみ通知（子タスクは通知しない）
      if (task.parentId !== null && task.parentId !== undefined) continue
      if (task.completed || task.status === 'completed') continue

      // 期日通知が無効または設定がない場合はスキップ
      if (!task.dueDateNotification?.enabled) continue

      const notification = task.dueDateNotification

      // 最小通知間隔チェック
      if (!hasMinIntervalPassed(notification.notifiedAt, timingConfig)) {
        continue
      }

      // 同じタスクへの1日の通知回数チェック
      if (!canNotifySameTask(task.id, timingConfig)) {
        continue
      }

      let shouldNotify = false
      let notifyType: 'reminder' | 'overdue' | 'followup' = 'reminder'
      let notifyFollowUpCount = 0
      const updates: Partial<ReminderTask> = {}

      const dueDate = resolveDueDate(task.dueDate)
      const dueDateTimestamp = dueDate ? dueDate.getTime() : null

      if (!dueDateTimestamp) continue

      // 通知時刻を計算（期日 - notifyBefore分）
      const notifyTime = dueDateTimestamp - notification.notifyBefore * 60 * 1000

      // 期日超過チェック（最優先）
      if (dueDateTimestamp <= nowTime) {
        // 期限切れタスクの通知頻度チェック
        const overdueInterval = getOverdueNotificationInterval(timingConfig)
        const timeSinceLastNotify = notification.notifiedAt ? (nowTime - notification.notifiedAt) : Infinity

        if (!notification.notifiedAt || (timeSinceLastNotify >= overdueInterval && overdueInterval !== Infinity)) {
          shouldNotify = true
          notifyType = 'overdue'
          updates.dueDateNotification = {
            ...notification,
            notifiedAt: nowTime,
            followUpCount: notification.notifiedAt ? notification.followUpCount : 0
          }
        }
      }
      // 通知時刻チェック（期日前の通知）
      else if (notifyTime <= nowTime && !notification.notifiedAt) {
        shouldNotify = true
        notifyType = 'reminder'
        updates.dueDateNotification = {
          ...notification,
          notifiedAt: nowTime,
          followUpCount: 0
        }
      }

      // 追い通知チェック（他の通知がない場合）
      if (!shouldNotify && notification.notifiedAt) {
        const currentFollowUpCount = notification.followUpCount || 0
        // フォローアップ設定チェック
        if (canSendFollowUp(timingConfig, currentFollowUpCount)) {
          const followUpInterval = getFollowUpInterval(task.timeframe, timingConfig)
          if ((nowTime - notification.notifiedAt) >= followUpInterval) {
            shouldNotify = true
            notifyType = 'followup'
            notifyFollowUpCount = currentFollowUpCount + 1
            updates.dueDateNotification = {
              ...notification,
              notifiedAt: nowTime,
              followUpCount: notifyFollowUpCount
            }
          }
        }
      }

      if (shouldNotify) {
        const isOverdue = notifyType === 'overdue'

        // デスクトップ通知（Discord通知と同じ頻度制限、LLMでメッセージ生成）
        if (currentConfig.desktopNotificationEnabled) {
          if (shouldSendReminder(task.id, isOverdue, 'desktop')) {
            try {
              // メモリを読み込む
              let memoryContext = ''
              if (currentConfig.useMemory && currentConfig.memoryFilePath) {
                const memory = await loadMemory(currentConfig.memoryFilePath)
                memoryContext = extractMemoryContext(memory)
              }

              // LLMでメッセージを生成
              const message = await generateReminderMessageWithPersona(
                { id: task.id, title: task.title, dueDate: task.dueDate, status: task.status || 'pending' },
                isOverdue,
                memoryContext,
                currentConfig
              )

              // デスクトップ通知を送信
              const title = isOverdue ? '⚠️ 期限切れタスク' : '⏰ リマインダー'
              await showNotification(title, message)
              markReminderSent(task.id, isOverdue, 'desktop')
              console.log(`[Reminder] Desktop notification sent: ${task.title}`)
            } catch (error) {
              console.error(`[Reminder] Desktop notification failed: ${task.title}`, error)
              // LLM失敗時はフォールバックメッセージを使用
              const fallbackMsg = getPersonaNotificationMessage(task.title, notifyType, notifyFollowUpCount, !!task.recurrence)
              try {
                await showNotification(fallbackMsg.title, fallbackMsg.body)
                markReminderSent(task.id, isOverdue, 'desktop')
              } catch (fallbackError) {
                console.error(`[Reminder] Desktop fallback notification also failed: ${task.title}`, fallbackError)
              }
            }
          }
        }

        // Discord通知（期日ベースのリマインダーの場合は重複チェック）
        if (currentConfig.discordEnabled) {
          if (shouldSendReminder(task.id, isOverdue, 'discord')) {
            try {
              await sendReminder(task)
              markReminderSent(task.id, isOverdue, 'discord')
              console.log(`[Reminder] Discord DM sent: ${task.title}`)
            } catch (error) {
              console.error(`[Reminder] Discord DM failed: ${task.title}`, error)
            }
          }
        }

        // 1日の通知回数をインクリメント
        incrementTaskNotificationCount(task.id)

        // 更新を記録
        if (Object.keys(updates).length > 0) {
          notificationResults.push({ taskId: task.id, updates })
        }
      }
    }

    // タスクの更新をコールバック
    if (notificationResults.length > 0 && updateTasks) {
      updateTasks(notificationResults)
    }
  }, 60 * 1000) // 1分ごと

  // 朝の挨拶をスケジュール
  if (config.morningGreeting) {
    scheduleMorningGreeting(config.morningGreetingTime)
  }

  // 昼の挨拶をスケジュール
  if (config.noonGreeting) {
    scheduleNoonGreeting(config.noonGreetingTime)
  }

  // 夜の挨拶をスケジュール
  if (config.eveningGreeting) {
    scheduleEveningGreeting(config.eveningGreetingTime)
  }

  console.log('Kanae reminder service started (unified)')
}

function scheduleMorningGreeting(time: string): void {
  const [hours, minutes] = time.split(':').map(Number)
  const now = new Date()
  const scheduledTime = new Date()
  scheduledTime.setHours(hours, minutes, 0, 0)

  // 今日の時間が過ぎていたら明日にスケジュール
  if (scheduledTime <= now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1)
  }

  const delay = scheduledTime.getTime() - now.getTime()

  morningGreetingTimeout = setTimeout(async () => {
    try {
      await sendMorningGreeting()
      console.log('Morning greeting sent')
    } catch (error) {
      console.error('Failed to send morning greeting:', error)
    }

    // 次の日の挨拶をスケジュール
    scheduleMorningGreeting(time)
  }, delay)
}

function scheduleNoonGreeting(time: string): void {
  const [hours, minutes] = time.split(':').map(Number)
  const now = new Date()
  const scheduledTime = new Date()
  scheduledTime.setHours(hours, minutes, 0, 0)

  // 今日の時間が過ぎていたら明日にスケジュール
  if (scheduledTime <= now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1)
  }

  const delay = scheduledTime.getTime() - now.getTime()

  noonGreetingTimeout = setTimeout(async () => {
    try {
      await sendNoonGreeting()
      console.log('Noon greeting sent')
    } catch (error) {
      console.error('Failed to send noon greeting:', error)
    }

    // 次の日の挨拶をスケジュール
    scheduleNoonGreeting(time)
  }, delay)
}

function scheduleEveningGreeting(time: string): void {
  const [hours, minutes] = time.split(':').map(Number)
  const now = new Date()
  const scheduledTime = new Date()
  scheduledTime.setHours(hours, minutes, 0, 0)

  // 今日の時間が過ぎていたら明日にスケジュール
  if (scheduledTime <= now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1)
  }

  const delay = scheduledTime.getTime() - now.getTime()

  eveningGreetingTimeout = setTimeout(async () => {
    try {
      await sendEveningGreeting()
      console.log('Evening greeting sent')
    } catch (error) {
      console.error('Failed to send evening greeting:', error)
    }

    // 次の日の挨拶をスケジュール
    scheduleEveningGreeting(time)
  }, delay)
}

export function stopReminderService(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval)
    reminderInterval = null
  }
  if (morningGreetingTimeout) {
    clearTimeout(morningGreetingTimeout)
    morningGreetingTimeout = null
  }
  if (noonGreetingTimeout) {
    clearTimeout(noonGreetingTimeout)
    noonGreetingTimeout = null
  }
  if (eveningGreetingTimeout) {
    clearTimeout(eveningGreetingTimeout)
    eveningGreetingTimeout = null
  }
  console.log('Kanae reminder service stopped')
}

// タスク分解結果の型（エラー情報付き）
export interface DecomposeResultWithError extends DecomposeResult {
  error?: {
    type: ApiErrorType
    message: string
    hint: string
  }
}

export interface DecomposeSearchContext {
  projectName?: string | null
  relatedTasks?: string[]
}

function buildDecomposeSearchQuery(taskTitle: string, context?: DecomposeSearchContext): string {
  const baseQuery = `${taskTitle} 手順 方法 やり方`
  if (!context) return baseQuery

  const parts: string[] = []
  const projectName = context.projectName?.trim()
  if (projectName) {
    parts.push(`プロジェクト:${projectName}`)
  }

  const relatedTasks = (context.relatedTasks ?? [])
    .map(task => task.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((task, index, array) => array.indexOf(task) === index)
    .slice(0, 5)

  if (relatedTasks.length > 0) {
    parts.push(`関連:${relatedTasks.join(' / ')}`)
  }

  if (parts.length === 0) return baseQuery
  return `${baseQuery} ${parts.join(' ')}`
}

// タスク分解（統合関数）- aiProviderを使用、Tavily検索も実行
export async function decomposeTask(
  taskTitle: string,
  context?: DecomposeSearchContext
): Promise<DecomposeResultWithError> {
  const config = getKanaeConfig()
  const provider = resolveProvider(config)

  // Tavily APIキーがあれば検索を実行
  let webSearchContext: string | undefined
  console.log('[decomposeTask] Tavilyキー確認中...')
  if (getTavilyApiKey()) {
    try {
      const query = buildDecomposeSearchQuery(taskTitle, context)
      console.log('[decomposeTask] Tavily検索を実行中:', query)
      const searchResult = await searchWithTavily(query)
      if (searchResult) {
        webSearchContext = formatSearchResultsForPrompt(searchResult)
        console.log('[decomposeTask] Tavily検索完了、Web情報をプロンプトに追加')
      } else {
        console.log('[decomposeTask] Tavily検索結果なし')
      }
    } catch (error) {
      console.warn('[decomposeTask] Tavily検索エラー（無視）:', error)
    }
  } else {
    console.log('[decomposeTask] TavilyキーなしのためWeb検索スキップ')
  }
  console.log('[decomposeTask] AI分解開始', webSearchContext ? '(Web情報あり)' : '(Web情報なし)')

  try {
    switch (provider) {
      case 'claude':
        return await decomposeTaskClaude(taskTitle, webSearchContext)
      case 'gemini':
        return await decomposeTaskGemini(taskTitle, webSearchContext)
      case 'openai':
      default:
        return await decomposeTaskOpenAI(taskTitle, webSearchContext)
    }
  } catch (error) {
    console.error('[decomposeTask] Error:', error)

    // エラー種類を判定して適切なメッセージを返す
    const errorType = getApiErrorType(error)
    const errMsg = getApiErrorMessage(errorType, provider)

    return {
      subtasks: [],
      error: {
        type: errorType,
        message: errMsg.message,
        hint: errMsg.hint
      }
    }
  }
}

// エクスポート（人格プリセット一覧）
export { PERSONA_PRESETS } from '../lib/kanaePersona'
export type { PersonaPreset, CustomPersona } from '../lib/kanaePersona'
export type { DecomposeResult, Subtask } from '../lib/claude'
