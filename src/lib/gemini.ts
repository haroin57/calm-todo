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

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// モデル取得関数（循環参照を避けるためlocalStorageから直接取得）
function getGeminiModel(): string {
  try {
    const config = localStorage.getItem('kanae-reminder-config')
    if (config) {
      const parsed = JSON.parse(config)
      if (parsed.aiModels?.gemini) {
        return parsed.aiModels.gemini
      }
    }
  } catch {
    // ignore
  }
  return 'gemini-2.0-flash'
}

// Gemini API Key管理
export function getGeminiApiKey(): string | null {
  return localStorage.getItem('gemini-api-key')
}

export function setGeminiApiKey(key: string): void {
  localStorage.setItem('gemini-api-key', key)
}

export function clearGeminiApiKey(): void {
  localStorage.removeItem('gemini-api-key')
}

// Gemini APIリクエスト
interface GeminiContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

interface GeminiRequest {
  contents: GeminiContent[]
  systemInstruction?: {
    parts: { text: string }[]
  }
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    topP?: number
    topK?: number
  }
}

interface GeminiResponse {
  candidates?: {
    content: {
      parts: { text: string }[]
    }
  }[]
  error?: {
    message: string
  }
}

async function callGeminiAPI(
  systemPrompt: string,
  userPrompt: string,
  apiKey?: string
): Promise<string> {
  const key = apiKey || getGeminiApiKey()
  if (!key) {
    throw new Error('Gemini APIキーが設定されていません')
  }

  const request: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 256,
      topP: 0.9,
      topK: 40,
    },
  }

  console.log('[Gemini] Calling API...')
  const response = await fetch(
    `${GEMINI_API_URL}/${getGeminiModel()}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }
  )

  console.log('[Gemini] Response status:', response.status)

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Gemini] API error:', errorText)
    throw new Error(`Gemini API error: ${response.status}`)
  }

  const data: GeminiResponse = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Gemini APIからの応答が空です')
  }

  console.log('[Gemini] Generated message:', text)
  return text.trim()
}

// かなえリマインダーメッセージ生成（Gemini版）
export async function generateKanaeReminderMessageGemini(
  taskTitle: string,
  dueDate: Date | null,
  isOverdue: boolean,
  memoryContext?: string
): Promise<string> {
  try {
    const systemPrompt = buildKanaeSystemPrompt('reminder', memoryContext)
    const userPrompt = buildKanaeReminderUserPrompt(
      taskTitle,
      dueDate,
      isOverdue,
      !!memoryContext
    )

    return await callGeminiAPI(systemPrompt, userPrompt)
  } catch (error) {
    console.error('[Gemini] Reminder generation failed, using fallback:', error)
    return getFallbackReminderMessage(taskTitle, isOverdue)
  }
}

// かなえ朝の挨拶生成（Gemini版）
export async function generateKanaeMorningGreetingGemini(
  memoryContext?: string
): Promise<string> {
  try {
    const systemPrompt = buildKanaeSystemPrompt('morning', memoryContext)
    const userPrompt = buildKanaeMorningUserPrompt(!!memoryContext)

    return await callGeminiAPI(systemPrompt, userPrompt)
  } catch (error) {
    console.error('[Gemini] Morning greeting generation failed, using fallback:', error)
    return getFallbackMorningGreeting()
  }
}

// カスタム人格でメッセージ生成
export async function generateCustomPersonaMessageGemini(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  return await callGeminiAPI(systemPrompt, userPrompt)
}

// 接続テスト
export async function testGeminiConnection(): Promise<boolean> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません')
  }

  try {
    const response = await fetch(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )

    console.log('[Gemini] Connection test status:', response.status)
    return response.ok
  } catch (error) {
    console.error('[Gemini] Connection test failed:', error)
    throw error
  }
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

export async function generatePlanGemini(goal: string, webSearchContext?: string): Promise<PlanResult> {
  const apiKey = getGeminiApiKey()

  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません')
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
    const request: GeminiRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: PLAN_SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 16384,  // 推論トークンを消費するため大きめに設定
        topP: 0.9,
        topK: 40,
      },
    }

    const model = getGeminiModel()
    console.log('[Gemini Plan] Using model:', model)
    console.log('[Gemini Plan] Request:', JSON.stringify(request, null, 2))

    const response = await fetch(
      `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }
    )

    console.log('[Gemini Plan] Response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gemini Plan] API error:', errorText)
      throw new Error(`Gemini API error: ${response.status}`)
    }

    const data: GeminiResponse = await response.json()
    console.log('[Gemini Plan] Full response:', JSON.stringify(data, null, 2))

    if (data.error) {
      console.error('[Gemini Plan] Error in response:', data.error)
      throw new Error(data.error.message)
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    console.log('[Gemini Plan] Raw content:', content)

    if (!content) {
      console.error('[Gemini Plan] No content found. candidates:', data.candidates)
      throw new Error('AIからの応答がありません')
    }

    // ```json ... ``` で囲まれている場合は中身を抽出
    let jsonContent = content
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonContent = codeBlockMatch[1].trim()
      console.log('[Gemini Plan] Extracted from code block')
    }

    const jsonMatch = jsonContent.match(/\{[\s\S]*\}/)
    console.log('[Gemini Plan] JSON match result:', jsonMatch ? jsonMatch[0].substring(0, 200) + '...' : 'null')

    if (!jsonMatch) {
      console.error('[Gemini Plan] No JSON found in content')
      throw new Error('無効な応答形式')
    }

    console.log('[Gemini Plan] Attempting to parse JSON...')
    const result = JSON.parse(jsonMatch[0]) as PlanResult | PlanError
    console.log('[Gemini Plan] Parsed result:', JSON.stringify(result, null, 2).substring(0, 500) + '...')

    if (isPlanError(result)) {
      throw new Error(result.error)
    }

    if (!result.tasks || !Array.isArray(result.tasks)) {
      throw new Error('無効な応答形式')
    }

    result.tasks = result.tasks.map(task => ({ ...task, selected: true, editing: false }))

    return result
  } catch (error) {
    console.error('[Gemini Plan] Error caught:', error)
    if (error instanceof SyntaxError) {
      console.error('[Gemini Plan] SyntaxError - JSON parse failed:', error.message)
      throw new Error('AI応答の解析に失敗しました')
    }
    throw error
  }
}

export async function decomposeTaskGemini(taskTitle: string, webSearchContext?: string): Promise<DecomposeResult> {
  const apiKey = getGeminiApiKey()

  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません')
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
    const request: GeminiRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: DECOMPOSE_SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,  // 推論トークンを消費するため大きめに設定
        topP: 0.9,
        topK: 40,
      },
    }

    console.log('[Gemini] Decomposing task...')
    const response = await fetch(
      `${GEMINI_API_URL}/${getGeminiModel()}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gemini] API error:', errorText)
      throw new Error(`Gemini API error: ${response.status}`)
    }

    const data: GeminiResponse = await response.json()

    if (data.error) {
      throw new Error(data.error.message)
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      throw new Error('AIからの応答がありません')
    }

    // ```json ... ``` で囲まれている場合は中身を抽出
    let jsonContent = content
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonContent = codeBlockMatch[1].trim()
    }

    const jsonMatch = jsonContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('無効な応答形式')
    }

    const result = JSON.parse(jsonMatch[0]) as DecomposeResult

    if (!result.subtasks || !Array.isArray(result.subtasks)) {
      throw new Error('無効な応答形式')
    }

    console.log('[Gemini] Decomposition result:', result)
    return result
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('AI応答の解析に失敗しました')
    }
    throw error
  }
}
