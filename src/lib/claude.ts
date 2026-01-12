import { fetch } from '@tauri-apps/plugin-http'
import {
  buildKanaeSystemPrompt,
  buildKanaeReminderUserPrompt,
  buildKanaeMorningUserPrompt,
  getFallbackReminderMessage,
  getFallbackMorningGreeting,
} from './kanaePersona'
import { DECOMPOSE_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from './prompts'
import type { PlanResult, PlanError } from './openai'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

// モデル取得関数（循環参照を避けるためlocalStorageから直接取得）
function getClaudeModel(): string {
  try {
    const config = localStorage.getItem('kanae-reminder-config')
    if (config) {
      const parsed = JSON.parse(config)
      if (parsed.aiModels?.claude) {
        return parsed.aiModels.claude
      }
    }
  } catch {
    // ignore
  }
  return 'claude-sonnet-4-20250514'
}

export interface ReminderMessage {
  message: string
}

export function getClaudeApiKey(): string | null {
  return localStorage.getItem('claude-api-key')
}

export function setClaudeApiKey(key: string): void {
  localStorage.setItem('claude-api-key', key)
}

export function clearClaudeApiKey(): void {
  localStorage.removeItem('claude-api-key')
}

async function requestClaudeMessage(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string | null> {
  const apiKey = getClaudeApiKey()

  if (!apiKey) {
    return null
  }

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getClaudeModel(),
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.content[0]?.text || null
  } catch {
    return null
  }
}

export async function generateReminderMessage(
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

  const content = await requestClaudeMessage(systemPrompt, userPrompt, 256)
  return content || getFallbackReminderMessage(taskTitle, isOverdue)
}

export async function generateMorningGreeting(memoryContext?: string): Promise<string> {
  const systemPrompt = buildKanaeSystemPrompt('morning', memoryContext)
  const userPrompt = buildKanaeMorningUserPrompt(Boolean(memoryContext))

  const content = await requestClaudeMessage(systemPrompt, userPrompt, 128)
  return content || getFallbackMorningGreeting()
}

// カスタム人格でメッセージ生成（Claude版）
export async function generateCustomPersonaMessageClaude(
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  return await requestClaudeMessage(systemPrompt, userPrompt, 256)
}

export interface Subtask {
  title: string
  priority: 'high' | 'medium' | 'low'
  estimatedMinutes?: number
}

export interface DecomposeResult {
  subtasks: Subtask[]
}

function isPlanError(result: PlanResult | PlanError): result is PlanError {
  return typeof (result as PlanError).error === 'string'
}

export async function generatePlanClaude(goal: string, webSearchContext?: string): Promise<PlanResult> {
  const apiKey = getClaudeApiKey()

  if (!apiKey) {
    throw new Error('Claude APIキーが設定されていません')
  }

  const today = new Date()
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']
  const dayOfWeek = dayNames[today.getDay()]

  let userPrompt = `## 達成したい目標
${goal}

## 現在の状況
- 今日: ${today.toLocaleDateString('ja-JP')}（${dayOfWeek}曜日）
- 作業可能時間: 1日あたり2?4時間`

  if (webSearchContext) {
    userPrompt += `

## ウェブ検索で得た参考情報
以下の情報を参考にして、より具体的で実践的な計画を立ててください。

${webSearchContext}`
  }

  userPrompt += `

この目標を達成するための計画をJSON形式で作成してください。`

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getClaudeModel(),
        max_tokens: 2048,
        system: PLAN_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || '計画の生成に失敗しました')
    }

    const data = await response.json()
    const content = data.content[0]?.text

    if (!content) {
      throw new Error('AIからの応答がありません')
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('無効な応答形式')
    }

    const result = JSON.parse(jsonMatch[0]) as PlanResult | PlanError

    if (isPlanError(result)) {
      throw new Error(result.error)
    }

    if (!result.tasks || !Array.isArray(result.tasks)) {
      throw new Error('無効な応答形式')
    }

    result.tasks = result.tasks.map(task => ({ ...task, selected: true, editing: false }))

    return result
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('AI応答の解析に失敗しました')
    }
    throw error
  }
}

export async function decomposeTaskClaude(taskTitle: string, webSearchContext?: string): Promise<DecomposeResult> {
  const apiKey = getClaudeApiKey()

  if (!apiKey) {
    throw new Error('Claude APIキーが設定されていません')
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

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getClaudeModel(),
        max_tokens: 1024,
        system: DECOMPOSE_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'タスクの分解に失敗しました')
    }

    const data = await response.json()
    const content = data.content[0]?.text

    if (!content) {
      throw new Error('AIからの応答がありません')
    }

    // JSONを抽出（```json ... ``` でラップされている可能性を考慮）
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('無効な応答形式')
    }

    const result = JSON.parse(jsonMatch[0]) as DecomposeResult

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
