const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const SYSTEM_PROMPT = `あなたはタスク分解アシスタントです。大きく複雑なタスクを、小さく実行可能なサブタスクに分解し、優先度を割り当てます。

## ガイドライン

1. **実行可能**: 各サブタスクは1回の作業セッション（4時間以内）で完了できる具体的なアクションにする
2. **順序**: サブタスクは論理的な順序で並べる
3. **具体的**: 曖昧な表現を避け、具体的な技術、方法、成果物を含める
4. **完全**: サブタスクの合計で元のタスクが達成される
5. **適切な数**: 3〜7個のサブタスクを生成
6. **優先度**: 各サブタスクに優先度を割り当てる
   - high: 他のタスクの前提となる、クリティカルパス上、または期限が迫っている
   - medium: 重要だが他に依存しない通常のタスク
   - low: 後回しにできる、またはオプショナルなタスク

## 出力形式

以下のJSON形式のみで回答:
{
  "subtasks": [
    { "title": "サブタスクのタイトル", "priority": "high" | "medium" | "low" }
  ]
}

JSON以外のテキストを含めないでください。`

export interface Subtask {
  title: string
  priority: "high" | "medium" | "low"
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

export async function decomposeTask(taskTitle: string): Promise<DecomposeResult> {
  const apiKey = getApiKey()

  if (!apiKey) {
    throw new Error('OpenAI APIキーが設定されていません')
  }

  const userPrompt = `以下のタスクを実行可能なサブタスクに分解し、優先度を付けてください：

タスク: ${taskTitle}

サブタスクをJSON形式で返してください。`

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
