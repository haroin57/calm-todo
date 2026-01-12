import { fetch } from '@tauri-apps/plugin-http'

const DISCORD_API_URL = 'https://discord.com/api/v10'

export interface DiscordSettings {
  botToken: string
  userId: string
  enabled: boolean
}

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: { name: string; value: string; inline?: boolean }[]
  footer?: { text: string; icon_url?: string }
  timestamp?: string
  thumbnail?: { url: string }
  author?: { name: string; icon_url?: string; url?: string }
}

export function getDiscordSettings(): DiscordSettings | null {
  const settings = localStorage.getItem('discord-settings')
  console.log('[Discord] getDiscordSettings:', settings ? 'found' : 'not found')
  if (!settings) return null
  try {
    const parsed = JSON.parse(settings) as DiscordSettings
    console.log('[Discord] Settings parsed:', {
      hasToken: !!parsed.botToken,
      tokenLength: parsed.botToken?.length,
      userId: parsed.userId,
      enabled: parsed.enabled
    })
    return parsed
  } catch (e) {
    console.error('[Discord] Failed to parse settings:', e)
    return null
  }
}

export function setDiscordSettings(settings: DiscordSettings): void {
  console.log('[Discord] setDiscordSettings called')
  localStorage.setItem('discord-settings', JSON.stringify(settings))
}

export function clearDiscordSettings(): void {
  localStorage.removeItem('discord-settings')
}

// DMチャンネルを作成または取得
async function createDMChannel(botToken: string, userId: string): Promise<string> {
  console.log('[Discord] createDMChannel - userId:', userId)
  console.log('[Discord] createDMChannel - API URL:', `${DISCORD_API_URL}/users/@me/channels`)

  try {
    const response = await fetch(`${DISCORD_API_URL}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        recipient_id: userId,
      }),
    })

    console.log('[Discord] createDMChannel - response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Discord] createDMChannel - error response:', errorText)
      try {
        const error = JSON.parse(errorText)
        throw new Error(error.message || `DMチャンネルの作成に失敗しました (${response.status})`)
      } catch {
        throw new Error(`DMチャンネルの作成に失敗しました (${response.status}): ${errorText}`)
      }
    }

    const data = await response.json()
    console.log('[Discord] createDMChannel - success, channelId:', data.id)
    return data.id
  } catch (error) {
    console.error('[Discord] createDMChannel - fetch error:', error)
    throw error
  }
}

// DMを送信（Embed形式）
export async function sendDiscordDM(message: string, options?: {
  taskTitle?: string
  dueDate?: Date | null
  isOverdue?: boolean
  type?: 'reminder' | 'morning' | 'noon' | 'evening' | 'dueDate'
}): Promise<void> {
  console.log('[Discord] sendDiscordDM called')
  const settings = getDiscordSettings()

  if (!settings || !settings.enabled) {
    console.error('[Discord] sendDiscordDM - settings not configured or disabled')
    throw new Error('Discord通知が設定されていません')
  }

  const { botToken, userId } = settings

  if (!botToken || !userId) {
    console.error('[Discord] sendDiscordDM - missing token or userId')
    throw new Error('Discord Bot TokenまたはユーザーIDが設定されていません')
  }

  try {
    console.log('[Discord] sendDiscordDM - creating DM channel...')
    const channelId = await createDMChannel(botToken, userId)

    // Embed色を決定
    const getEmbedColor = () => {
      if (options?.isOverdue) return 0xED4245 // 赤
      switch (options?.type) {
        case 'morning': return 0x57F287 // 緑
        case 'noon': return 0xFEE75C // 黄色
        case 'evening': return 0x9B59B6 // 紫
        default: return 0x5865F2 // 青
      }
    }

    // Embed作成
    const embed: DiscordEmbed = {
      description: message,
      color: getEmbedColor(),
      timestamp: new Date().toISOString(),
      footer: { text: 'Calm Todo' },
    }

    // タイトル設定
    if (options?.type === 'morning') {
      embed.title = '🌅 おはようございます'
    } else if (options?.type === 'noon') {
      embed.title = '☀️ お昼です'
    } else if (options?.type === 'evening') {
      embed.title = '🌙 お疲れ様でした'
    } else if (options?.type === 'dueDate') {
      embed.title = options?.isOverdue ? '⚠️ 期限切れタスク' : '📅 期日のお知らせ'
    } else if (options?.type === 'reminder') {
      embed.title = options?.isOverdue ? '⏰ リマインダー（期限切れ）' : '⏰ リマインダー'
    }

    // タスク情報をフィールドに追加
    if (options?.taskTitle) {
      embed.fields = embed.fields || []
      embed.fields.push({ name: 'タスク', value: options.taskTitle, inline: true })
      if (options.dueDate) {
        const dateStr = options.dueDate.toLocaleString('ja-JP', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        embed.fields.push({ name: '期日', value: dateStr, inline: true })
      }
    }

    console.log('[Discord] sendDiscordDM - sending embed to channel:', channelId)
    const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    })

    console.log('[Discord] sendDiscordDM - response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Discord] sendDiscordDM - error response:', errorText)
      try {
        const error = JSON.parse(errorText)
        throw new Error(error.message || `DMの送信に失敗しました (${response.status})`)
      } catch {
        throw new Error(`DMの送信に失敗しました (${response.status}): ${errorText}`)
      }
    }

    console.log('[Discord] sendDiscordDM - success!')
  } catch (error) {
    console.error('[Discord] sendDiscordDM - error:', error)
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Discord通知の送信に失敗しました')
  }
}

// テストメッセージ送信（Embed形式）
export async function sendTestDiscordDM(): Promise<void> {
  console.log('[Discord] sendTestDiscordDM called')
  const settings = getDiscordSettings()

  if (!settings) {
    throw new Error('Discord設定がありません')
  }

  const { botToken, userId } = settings

  try {
    const channelId = await createDMChannel(botToken, userId)
    console.log('[Discord] sendTestDiscordDM - sending to channel:', channelId)

    const embed: DiscordEmbed = {
      title: '✅ 接続テスト成功',
      description: '先輩、テスト送信ですよ。ちゃんと届いてますか？',
      color: 0x57F287, // 緑
      timestamp: new Date().toISOString(),
      footer: { text: 'Calm Todo' },
      fields: [
        { name: 'ステータス', value: '正常に接続されています', inline: true },
      ]
    }

    const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    })

    console.log('[Discord] sendTestDiscordDM - response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Discord] sendTestDiscordDM - error:', errorText)
      throw new Error(`テストメッセージの送信に失敗しました (${response.status})`)
    }

    console.log('[Discord] sendTestDiscordDM - success!')
  } catch (error) {
    console.error('[Discord] sendTestDiscordDM - error:', error)
    throw error
  }
}

// 接続テスト
export async function testDiscordConnection(): Promise<boolean> {
  console.log('[Discord] testDiscordConnection called')
  const settings = getDiscordSettings()

  if (!settings) {
    console.error('[Discord] testDiscordConnection - no settings')
    throw new Error('Discord設定がありません')
  }

  const { botToken, userId } = settings
  console.log('[Discord] testDiscordConnection - token length:', botToken?.length, 'userId:', userId)

  try {
    console.log('[Discord] testDiscordConnection - fetching bot info...')
    const botResponse = await fetch(`${DISCORD_API_URL}/users/@me`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    })

    console.log('[Discord] testDiscordConnection - bot info status:', botResponse.status)

    if (!botResponse.ok) {
      const errorText = await botResponse.text()
      console.error('[Discord] testDiscordConnection - bot info error:', errorText)
      throw new Error(`Bot Tokenが無効です (${botResponse.status})`)
    }

    const botInfo = await botResponse.json()
    console.log('[Discord] testDiscordConnection - bot info:', botInfo)

    console.log('[Discord] testDiscordConnection - creating DM channel...')
    await createDMChannel(botToken, userId)

    console.log('[Discord] testDiscordConnection - success!')
    return true
  } catch (error) {
    console.error('[Discord] testDiscordConnection - error:', error)
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Discord接続テストに失敗しました')
  }
}
