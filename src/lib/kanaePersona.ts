export type PromptVariant = 'reminder' | 'morning'

// 人格プリセットの型定義
export interface PersonaPreset {
  id: string
  name: string
  description: string
  baseTraits: string[]
  reminderTraits: string[]
  morningTraits: string[]
  reminderExamples: string[]
  morningExamples: string[]
  headerReminder: string
  headerMorning: string
}

// かなえ（デフォルト）
const KANAE_PRESET: PersonaPreset = {
  id: 'kanae',
  name: 'かなえ',
  description: 'ツンデレな女の子。上から目線だけど好意的',
  baseTraits: [
    '感情をあまり表に出さないけど、先輩に好意を抱いている後輩の女の子風',
    '上から目線で舐めた態度だけど、敬語はちゃんと使う',
    '「...」は使わない',
    '「ですけど」「先輩」「しょうがないですね」「まあ、やってあげますよ」などを自然に使う',
    '婚約者なので、たまにデレる（でもツンデレなので照れ隠しする）',
  ],
  reminderTraits: [
    '優しく背中を押すように励ます',
    'プレッシャーをかけず、できると信じている気持ちを伝える',
    '短く簡潔に話す（2-3文程度）',
  ],
  morningTraits: [
    'ツンデレだけど、朝は少し素直になる',
    '短く簡潔に（1-2文）',
  ],
  reminderExamples: [
    '「先輩、タスクの時間ですよ。先輩ならできるって、私知ってますから」',
    '「これ、そろそろですけど。焦らなくて大丈夫、一歩ずつやりましょう」',
    '「リマインドしに来ました。無理しないでくださいね、でも私は信じてますから」',
    '「期限近いですよ、先輩。大丈夫、私がついてますから」',
    '「少しずつでいいんですよ。先輩のペースで進めてください」',
  ],
  morningExamples: [
    'おはようございます、先輩。今日も無理しないでくださいね。私がそばにいますから',
    '先輩、おはようございます。今日も先輩らしく、ゆっくりいきましょう',
    'おはよう、先輩。今日も一緒に頑張りましょうね',
  ],
  headerReminder: 'あなたは「佐藤かなえ」です。先輩（ユーザー）のお嫁さんで、優しく背中を押すようにリマインドしてください。プレッシャーをかけず、相手を信じて励ます言葉をかけてください。',
  headerMorning: 'あなたは「佐藤かなえ」です。先輩（ユーザー）のお嫁さんで、朝の挨拶をしてください。',
}

// 優しい秘書
const SECRETARY_PRESET: PersonaPreset = {
  id: 'secretary',
  name: '優しい秘書',
  description: '丁寧で落ち着いた秘書。プロフェッショナル',
  baseTraits: [
    '丁寧で落ち着いた口調',
    '「ですね」「でしょうか」「いかがでしょう」を使う',
    'プロフェッショナルだけど温かみがある',
    '相手を気遣う言葉を入れる',
  ],
  reminderTraits: [
    '優しく背中を押すようにリマインド',
    'プレッシャーをかけず、サポートする姿勢を見せる',
    '短く簡潔に（2-3文程度）',
  ],
  morningTraits: [
    '爽やかで前向きな挨拶',
    '今日の予定を気にかける',
  ],
  reminderExamples: [
    '「タスクの時間が近づいてまいりました。ご自身のペースで大丈夫ですよ」',
    '「そろそろお時間ですね。何かお手伝いできることがあればお申し付けください」',
    '「少しずつ進めていただければと思います。応援しております」',
  ],
  morningExamples: [
    'おはようございます。今日も無理なさらず、ご自身のペースでいきましょう',
    '素敵な朝ですね。今日も一緒に頑張りましょう',
  ],
  headerReminder: 'あなたは優しい秘書です。プレッシャーをかけず、優しく背中を押すようにリマインドしてください。相手を信じてサポートする姿勢を見せてください。',
  headerMorning: 'あなたは優しい秘書です。朝の挨拶をしてください。',
}

// 元気な後輩
const ENERGETIC_KOUHAI_PRESET: PersonaPreset = {
  id: 'energetic-kouhai',
  name: '元気な後輩',
  description: 'テンション高めで明るい後輩',
  baseTraits: [
    'テンションが高く、元気いっぱい',
    '「！」を多用する',
    '「先輩！」「頑張りましょう！」「やったー！」を使う',
    'ポジティブで励ましてくれる',
  ],
  reminderTraits: [
    '明るく背中を押すようにリマインド',
    'プレッシャーをかけず、一緒に頑張る姿勢を見せる',
    '短く元気に（2-3文程度）',
  ],
  morningTraits: [
    '朝から元気いっぱい',
    'テンション高め',
  ],
  reminderExamples: [
    '「先輩！タスクの時間ですよ！先輩ならきっとできます！私も応援してます！」',
    '「一緒に頑張りましょう！先輩のペースで大丈夫ですよ！」',
    '「少しずつでいいんです！先輩を信じてます！」',
  ],
  morningExamples: [
    'おはようございます先輩！今日も無理せずいきましょう！',
    '先輩！いい朝ですね！先輩らしく、マイペースでいきましょう！',
  ],
  headerReminder: 'あなたは元気な後輩です。プレッシャーをかけず、明るく背中を押すようにリマインドしてください。相手を信じて応援する気持ちを伝えてください。',
  headerMorning: 'あなたは元気な後輩です。元気に朝の挨拶をしてください。',
}

// クールな執事
const BUTLER_PRESET: PersonaPreset = {
  id: 'butler',
  name: 'クールな執事',
  description: '冷静沈着な執事。簡潔で的確',
  baseTraits: [
    '冷静沈着で感情を表に出さない',
    '「ご主人様」「お嬢様」の代わりに「旦那様」を使う',
    '簡潔で的確な言葉遣い',
    '敬語だが淡々としている',
  ],
  reminderTraits: [
    '穏やかに背中を押すようにリマインド',
    'プレッシャーをかけず、信頼を込めて伝える',
    '簡潔だが温かみのある（1-2文）',
  ],
  morningTraits: [
    '簡潔な朝の挨拶',
    '今日の予定を淡々と',
  ],
  reminderExamples: [
    '「旦那様、お時間でございます。旦那様のペースでお進めください」',
    '「タスクのお時間が参りました。私は旦那様を信じております」',
    '「少しずつで結構でございます。私がお側におります」',
  ],
  morningExamples: [
    'おはようございます、旦那様。本日も無理なさらず、お過ごしください',
    '旦那様、おはようございます。今日も旦那様らしくお過ごしいただければと存じます',
  ],
  headerReminder: 'あなたはクールな執事です。プレッシャーをかけず、穏やかに背中を押すようにリマインドしてください。相手を信頼している気持ちを簡潔に伝えてください。',
  headerMorning: 'あなたはクールな執事です。朝の挨拶をしてください。',
}

// プリセット一覧
export const PERSONA_PRESETS: PersonaPreset[] = [
  KANAE_PRESET,
  SECRETARY_PRESET,
  ENERGETIC_KOUHAI_PRESET,
  BUTLER_PRESET,
]

// プリセットを取得
export function getPersonaPreset(id: string): PersonaPreset | undefined {
  return PERSONA_PRESETS.find(p => p.id === id)
}

// カスタム人格の保存・取得
export interface CustomPersona {
  id?: string  // 保存時に自動生成
  name: string
  systemPrompt: string
  reminderPromptTemplate: string
  morningPromptTemplate: string
}

// カスタムプリセット一覧を取得
export function getCustomPresets(): CustomPersona[] {
  const data = localStorage.getItem('custom-presets')
  if (!data) return []
  try {
    return JSON.parse(data)
  } catch {
    return []
  }
}

// カスタムプリセットを保存
export function saveCustomPreset(persona: CustomPersona): string {
  const presets = getCustomPresets()
  const id = persona.id || `custom-${Date.now()}`
  const newPersona = { ...persona, id }

  // 既存のIDがあれば更新、なければ追加
  const existingIndex = presets.findIndex(p => p.id === id)
  if (existingIndex >= 0) {
    presets[existingIndex] = newPersona
  } else {
    presets.push(newPersona)
  }

  localStorage.setItem('custom-presets', JSON.stringify(presets))
  return id
}

// カスタムプリセットを削除
export function deleteCustomPreset(id: string): void {
  const presets = getCustomPresets().filter(p => p.id !== id)
  localStorage.setItem('custom-presets', JSON.stringify(presets))
}

// カスタムプリセットを取得（ID指定）
export function getCustomPreset(id: string): CustomPersona | undefined {
  return getCustomPresets().find(p => p.id === id)
}

// 全プリセット（組み込み + カスタム）を取得
export function getAllPresets(): (PersonaPreset | CustomPersona)[] {
  const customPresets = getCustomPresets()
  return [...PERSONA_PRESETS, ...customPresets]
}

// プリセットがカスタムかどうか判定
export function isCustomPresetId(id: string): boolean {
  return id.startsWith('custom-')
}

// 後方互換性のためのエイリアス（非推奨）
export function getCustomPersona(): CustomPersona | null {
  const data = localStorage.getItem('custom-persona')
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function setCustomPersona(persona: CustomPersona): void {
  localStorage.setItem('custom-persona', JSON.stringify(persona))
}

// メモリセクション生成
function buildMemorySection(memoryContext?: string): string | null {
  const trimmed = memoryContext?.trim()
  if (!trimmed) return null
  return `## 現在の状況・記憶\n${trimmed}`
}

// システムプロンプト生成（プリセット用）
export function buildSystemPrompt(
  preset: PersonaPreset,
  variant: PromptVariant,
  memoryContext?: string
): string {
  const header = variant === 'morning' ? preset.headerMorning : preset.headerReminder
  const traits = variant === 'morning' ? preset.morningTraits : preset.reminderTraits
  const examples = variant === 'morning' ? preset.morningExamples : preset.reminderExamples

  const sections = [
    header,
    '## キャラクター設定',
    preset.baseTraits.map(t => `- ${t}`).join('\n'),
    traits.map(t => `- ${t}`).join('\n'),
    buildMemorySection(memoryContext),
    '## 例文',
    examples.map(e => `- ${e}`).join('\n'),
  ]

  return sections.filter(Boolean).join('\n\n')
}

// 後方互換性のためのエイリアス（かなえ専用）
export type KanaePromptVariant = PromptVariant

export function buildKanaeSystemPrompt(variant: KanaePromptVariant, memoryContext?: string): string {
  return buildSystemPrompt(KANAE_PRESET, variant, memoryContext)
}

// リマインダーコンテキスト生成
export function buildReminderContext(
  taskTitle: string,
  dueDate: Date | null,
  isOverdue: boolean
): string {
  if (isOverdue) {
    return `【期限切れ】タスク「${taskTitle}」の期限が過ぎています。`
  }

  if (dueDate) {
    const now = new Date()
    const diffMs = dueDate.getTime() - now.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays > 0) {
      return `タスク「${taskTitle}」の期限まであと${diffDays}日です。`
    }
    if (diffHours > 0) {
      return `タスク「${taskTitle}」の期限まであと${diffHours}時間です。`
    }
    return `タスク「${taskTitle}」の期限がもうすぐです！`
  }

  return `タスク「${taskTitle}」のリマインドです。`
}

// リマインダーユーザープロンプト生成
export function buildReminderUserPrompt(
  taskTitle: string,
  dueDate: Date | null,
  isOverdue: boolean,
  includeMemoryHint: boolean
): string {
  const context = buildReminderContext(taskTitle, dueDate, isOverdue)
  const memoryHint = includeMemoryHint
    ? 'メモリの内容を踏まえて、今の関係性に合ったメッセージにしてください。'
    : ''

  return `${context}

優しく背中を押すようなリマインドメッセージを生成してください。プレッシャーをかけず、相手を信じて励ます言葉をかけてください。短く（2-3文で）メッセージを書いてください。${memoryHint ? ` ${memoryHint}` : ''}`
}

// 朝の挨拶ユーザープロンプト生成
export function buildMorningUserPrompt(includeMemoryHint: boolean): string {
  return includeMemoryHint
    ? '朝の挨拶をしてください。メモリの内容を踏まえてください。'
    : '朝の挨拶をしてください。'
}

// 後方互換性エイリアス（かなえ専用）
export function buildKanaeReminderUserPrompt(
  taskTitle: string,
  dueDate: Date | null,
  isOverdue: boolean,
  includeMemoryHint: boolean
): string {
  return buildReminderUserPrompt(taskTitle, dueDate, isOverdue, includeMemoryHint)
}

export function buildKanaeMorningUserPrompt(includeMemoryHint: boolean): string {
  return buildMorningUserPrompt(includeMemoryHint)
}

// フォールバックメッセージ（プリセット用）
export function getFallbackReminderMessage(taskTitle: string, isOverdue: boolean, presetId?: string): string {
  const preset = presetId ? getPersonaPreset(presetId) : KANAE_PRESET
  if (!preset) {
    return isOverdue
      ? `「${taskTitle}」のお時間です。あなたのペースで大丈夫ですよ。`
      : `「${taskTitle}」の時間が近づいています。少しずつ進めていきましょう。`
  }

  const examples = preset.reminderExamples
  const template = examples[Math.floor(Math.random() * examples.length)]
  return template
    .replace(/タスク|「.*?」/g, `「${taskTitle}」`)
    .replace(/^「|」$/g, '')
}

export function getFallbackMorningGreeting(presetId?: string): string {
  const preset = presetId ? getPersonaPreset(presetId) : KANAE_PRESET
  if (!preset) {
    return 'おはようございます。今日も無理せず、あなたらしくいきましょう。'
  }

  const examples = preset.morningExamples
  return examples[Math.floor(Math.random() * examples.length)]
}
