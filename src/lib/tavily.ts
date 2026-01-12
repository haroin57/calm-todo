import { invoke } from '@tauri-apps/api/core'

const TAVILY_API_KEY = 'tavily-api-key'

type CharClass = 'latin' | 'hiragana' | 'katakana' | 'kanji'

const isAsciiOrFullwidthAlnum = (code: number): boolean => {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xff10 && code <= 0xff19) ||
    (code >= 0xff21 && code <= 0xff3a) ||
    (code >= 0xff41 && code <= 0xff5a)
  )
}

const isHiragana = (code: number): boolean => code >= 0x3040 && code <= 0x309f

const isKatakana = (code: number): boolean => {
  return (code >= 0x30a0 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff)
}

const isKanji = (code: number): boolean => {
  return (
    code === 0x3005 ||
    code === 0x3006 ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  )
}

const charClass = (code: number): CharClass | null => {
  if (isAsciiOrFullwidthAlnum(code)) return 'latin'
  if (isHiragana(code)) return 'hiragana'
  if (isKatakana(code)) return 'katakana'
  if (isKanji(code)) return 'kanji'
  return null
}

const isAsciiConnector = (char: string): boolean => {
  return char === '+' || char === '#' || char === '-' || char === '_' || char === '.' || char === ':' || char === '/' || char === '@'
}

const splitQueryTokens = (query: string): string[] => {
  const chars = Array.from(query)
  const tokens: string[] = []
  let current = ''
  let currentClass: CharClass | null = null

  const flush = () => {
    if (current) {
      tokens.push(current)
      current = ''
    }
    currentClass = null
  }

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]
    if (/\s/.test(char)) {
      flush()
      continue
    }

    const code = char.codePointAt(0)
    if (code === undefined) {
      flush()
      continue
    }

    const next = chars[i + 1]
    const nextCode = next ? next.codePointAt(0) : undefined

    const cls = charClass(code)
    if (cls) {
      if (currentClass === cls) {
        current += char
      } else {
        flush()
        current = char
        currentClass = cls
      }
      continue
    }

    if (currentClass === 'latin' && isAsciiConnector(char)) {
      if (char === '+' || char === '#') {
        current += char
        continue
      }
      if (nextCode !== undefined && isAsciiOrFullwidthAlnum(nextCode)) {
        current += char
        continue
      }
    }

    flush()
  }

  flush()
  return tokens
}

const optimizeSearchQuery = (query: string): string => {
  const trimmed = query.trim()
  if (!trimmed) return trimmed

  const tokens = splitQueryTokens(trimmed).map(token => token.trim()).filter(Boolean)
  if (tokens.length === 0) return trimmed

  const seen = new Set<string>()
  const unique: string[] = []
  for (const token of tokens) {
    if (seen.has(token)) continue
    seen.add(token)
    unique.push(token)
  }

  return unique.join(' ')
}

export interface TavilySearchResult {
  title: string
  url: string
  content: string
  score: number
  raw_content?: string  // 詳細なページコンテンツ
}

export interface TavilySearchResponse {
  answer: string | null
  results: TavilySearchResult[]
}

export function getTavilyApiKey(): string | null {
  const key = localStorage.getItem(TAVILY_API_KEY)
  console.log('[Tavily] APIキー取得:', key ? '設定済み' : '未設定')
  return key
}

export function setTavilyApiKey(key: string): void {
  localStorage.setItem(TAVILY_API_KEY, key)
}

export function clearTavilyApiKey(): void {
  localStorage.removeItem(TAVILY_API_KEY)
}

export async function searchWithTavily(query: string): Promise<TavilySearchResponse | null> {
  const optimizedQuery = optimizeSearchQuery(query)
  console.log('[Tavily] 検索開始:', optimizedQuery)
  if (optimizedQuery !== query) {
    console.log('[Tavily] Original query:', query)
  }
  const apiKey = getTavilyApiKey()

  if (!apiKey) {
    console.log('[Tavily] APIキーがないため検索スキップ')
    return null
  }

  try {
    console.log('[Tavily] Tauri invoke呼び出し中...')
    const response = await invoke<TavilySearchResponse>('tavily_search', {
      apiKey,
      query: optimizedQuery,
    })
    console.log('[Tavily] 検索成功:', {
      answer: response.answer ? `${response.answer.substring(0, 100)}...` : null,
      resultCount: response.results.length,
      results: response.results.map(r => ({ title: r.title, score: r.score }))
    })
    return response
  } catch (error) {
    console.error('[Tavily] 検索エラー:', error)
    return null
  }
}

export function formatSearchResultsForPrompt(response: TavilySearchResponse): string {
  console.log('[Tavily] プロンプト用にフォーマット開始')
  let context = ''

  if (response.answer) {
    console.log('[Tavily] 要約を追加:', response.answer.substring(0, 50) + '...')
    context += `## 検索結果の要約（AI分析）\n${response.answer}\n\n`
  }

  if (response.results.length > 0) {
    console.log('[Tavily] 参考情報を追加:', response.results.length, '件')
    context += '## 詳細な参考情報\n'
    context += '以下の情報から、具体的な手順、所要時間、推奨リソース、よくある失敗例を抽出してください。\n\n'

    response.results.forEach((result, index) => {
      console.log(`[Tavily]   ${index + 1}. ${result.title} (score: ${result.score})`)
      context += `\n### ${index + 1}. ${result.title}\n`
      context += `**URL**: ${result.url}\n`
      context += `**スコア**: ${result.score.toFixed(2)}\n\n`

      // contentは常に含める（要約された内容）
      context += `**概要**:\n${result.content}\n\n`

      // raw_contentがあれば、より詳細な情報を追加（最大2000文字）
      if (result.raw_content) {
        const rawContentTrimmed = result.raw_content.substring(0, 2000)
        console.log(`[Tavily]   raw_content: ${rawContentTrimmed.length} 文字`)
        context += `**詳細内容**:\n${rawContentTrimmed}${result.raw_content.length > 2000 ? '...(省略)' : ''}\n\n`
      }
    })
  }

  console.log('[Tavily] フォーマット完了 (文字数:', context.length, ')')
  return context
}
