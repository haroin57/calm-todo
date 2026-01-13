import { fetch } from '@tauri-apps/plugin-http'
import {
  buildKanaeSystemPrompt,
  buildKanaeReminderUserPrompt,
  buildKanaeMorningUserPrompt,
  getFallbackReminderMessage,
  getFallbackMorningGreeting,
} from './kanaePersona'
import { DECOMPOSE_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from './prompts'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

// モデル取得関数（循環参照を避けるためlocalStorageから直接取得）
function getOpenAIModel(): string {
  try {
    const config = localStorage.getItem('kanae-reminder-config')
    if (config) {
      const parsed = JSON.parse(config)
      if (parsed.aiModels?.openai) {
        return parsed.aiModels.openai
      }
    }
  } catch {
    // ignore
  }
  return 'gpt-4.1-mini'
}

export interface Subtask {
  title: string
  priority: "high" | "medium" | "low"
  estimatedMinutes?: number
}

export interface DecomposeResult {
  subtasks: Subtask[]
}

export function getApiKey(): string | null {
  return localStorage.getItem('openai-api-key')
}

export function setApiKey(key: string): void {
  localStorage.setItem('openai-api-key', key)
}

export function clearApiKey(): void {
  localStorage.removeItem('openai-api-key')
}

// GPT-5系など新しいモデルはmax_completion_tokensを使用
function isNewModelFormat(model: string): boolean {
  return model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o4')
}

async function requestOpenAIMessage(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string | null> {
  const apiKey = getApiKey()

  if (!apiKey) {
    return null
  }

  const model = getOpenAIModel()
  // GPT-5系は推論トークンを消費するため、より大きな上限が必要
  const adjustedTokens = isNewModelFormat(model) ? maxTokens * 4 : maxTokens
  const tokenParam = isNewModelFormat(model)
    ? { max_completion_tokens: adjustedTokens }
    : { max_tokens: adjustedTokens }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        ...tokenParam,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || null
  } catch {
    return null
  }
}

export async function generateKanaeReminderMessageOpenAI(
  taskTitle: string,
  dueDate: Date | null,
  isOverdue: boolean,
  memoryContext?: string
): Promise<string> {
  const systemPrompt = buildKanaeSystemPrompt('reminder', memoryContext)
  const userPrompt = buildKanaeReminderUserPrompt(
    taskTitle,
    dueDate,
    isOverdue,
    Boolean(memoryContext)
  )

  const content = await requestOpenAIMessage(systemPrompt, userPrompt, 256)
  return content || getFallbackReminderMessage(taskTitle, isOverdue)
}

export async function generateKanaeMorningGreetingOpenAI(memoryContext?: string): Promise<string> {
  const systemPrompt = buildKanaeSystemPrompt('morning', memoryContext)
  const userPrompt = buildKanaeMorningUserPrompt(Boolean(memoryContext))

  const content = await requestOpenAIMessage(systemPrompt, userPrompt, 128)
  return content || getFallbackMorningGreeting()
}

// カスタム人格でメッセージ生成（OpenAI版）
export async function generateCustomPersonaMessageOpenAI(
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  return await requestOpenAIMessage(systemPrompt, userPrompt, 256)
}

export interface PlanTask {
  title: string
  description: string
  priority: "high" | "medium" | "low"
  daysFromStart: number
  estimatedMinutes: number
  recurrence?: {
    type: "daily" | "weekly" | "monthly" | "yearly"
    interval: number
    // weekly用: 曜日 (0=日曜, 1=月曜, ...)
    dayOfWeek?: number
    // monthly用: 日付 (1-31)
    dayOfMonth?: number
    // yearly用: 月と日
    monthOfYear?: number
    dayOfYear?: number
  } | null
  selected?: boolean  // UI用
  editing?: boolean   // UI用
}

export interface PlanFeasibility {
  verdict: "FEASIBLE" | "CHALLENGING" | "INFEASIBLE"
  availableHours: number
  requiredHours: number
  calculation: string
  adjustment?: string
}

export interface PlanResource {
  name: string
  type: "book" | "website" | "tool" | "service" | "community"
  description: string
  cost: string
}

export interface PlanResult {
  currentState?: string  // 現在地点
  goalState?: string     // 到達目標
  gap?: string           // ギャップ分析
  feasibility?: PlanFeasibility  // 達成可能性チェック
  risks?: string[]       // リスク
  costs?: string[]       // コスト
  summary: string
  estimatedDays: number
  tasks: PlanTask[]
  resources?: PlanResource[]  // 推奨リソース
  tips: string[]
}

export interface PlanError {
  error: string
  code?: string
}

function isPlanError(result: PlanResult | PlanError): result is PlanError {
  return typeof (result as PlanError).error === 'string'
}

export async function generatePlan(goal: string, webSearchContext?: string): Promise<PlanResult> {
  const apiKey = getApiKey()

  if (!apiKey) {
    throw new Error('OpenAI APIキーが設定されていません')
  }

  const today = new Date()
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']
  const dayOfWeek = dayNames[today.getDay()]

  let userPrompt = `## 達成したい目標
${goal}

## 現在の状況
- 今日: ${today.toLocaleDateString('ja-JP')}（${dayOfWeek}曜日）
- 作業可能時間: 1日あたり2〜4時間`

  if (webSearchContext) {
    userPrompt += `

## ウェブ検索で得た参考情報
以下の情報を参考にして、より具体的で実践的な計画を立ててください。

${webSearchContext}`
  }

  userPrompt += `

この目標を達成するための計画をJSON形式で作成してください。`

  const model = getOpenAIModel()
  // GPT-5系は推論トークンを消費するため、より大きな上限が必要
  const tokenParam = isNewModelFormat(model)
    ? { max_completion_tokens: 16384 }
    : { max_tokens: 2048 }

  console.log('[OpenAI Plan] Using model:', model)
  console.log('[OpenAI Plan] Token param:', tokenParam)

  try {
    const requestBody = {
      model,
      temperature: 0.5,
      ...tokenParam,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PLAN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }
    console.log('[OpenAI Plan] Request body:', JSON.stringify(requestBody, null, 2))

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(requestBody),
    })

    console.log('[OpenAI Plan] Response status:', response.status)

    if (!response.ok) {
      const error = await response.json()
      console.error('[OpenAI Plan] Error response:', error)
      throw new Error(error.error?.message || '計画の生成に失敗しました')
    }

    const data = await response.json()
    console.log('[OpenAI Plan] Full response data:', JSON.stringify(data, null, 2))

    const content = data.choices?.[0]?.message?.content
    console.log('[OpenAI Plan] Extracted content:', content)

    if (!content) {
      console.error('[OpenAI Plan] No content found. choices:', data.choices)
      throw new Error('AIからの応答がありません')
    }

    const result = JSON.parse(content) as PlanResult | PlanError

    if (isPlanError(result)) {
      throw new Error(result.error)
    }

    if (!result.tasks || !Array.isArray(result.tasks)) {
      throw new Error('無効な応答形式')
    }

    // 全タスクをデフォルトで選択状態にする
    result.tasks = result.tasks.map(task => ({ ...task, selected: true, editing: false }))

    return result
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('AI応答の解析に失敗しました')
    }
    throw error
  }
}

export async function decomposeTask(taskTitle: string, webSearchContext?: string): Promise<DecomposeResult> {
  const apiKey = getApiKey()

  if (!apiKey) {
    throw new Error('OpenAI APIキーが設定されていません')
  }

  let userPrompt = `以下のタスクを実行可能なサブタスクに分解し、優先度を付けてください：

タスク: ${taskTitle}`

  if (webSearchContext) {
    userPrompt += `

## ウェブ検索で得た参考情報
以下の情報を参考にして、より具体的で実践的なサブタスクを生成してください。

${webSearchContext}`
  }

  userPrompt += `

サブタスクをJSON形式で返してください。`

  const model = getOpenAIModel()
  // GPT-5系は推論トークンを消費するため、より大きな上限が必要
  const tokenParam = isNewModelFormat(model)
    ? { max_completion_tokens: 8192 }
    : { max_tokens: 1024 }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        ...tokenParam,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: DECOMPOSE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'タスクの分解に失敗しました')
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      throw new Error('AIからの応答がありません')
    }

    const result = JSON.parse(content) as DecomposeResult

    if (!result.subtasks || !Array.isArray(result.subtasks)) {
      throw new Error('無効な応答形式')
    }

    return result
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('AI応答の解析に失敗しました')
    }
    throw error
  }
}
