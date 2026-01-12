import { fetch } from '@tauri-apps/plugin-http'

const DISCORD_API_URL = 'https://discord.com/api/v10'

export interface DiscordSettings {
  botToken: string
  userId: string
  enabled: boolean
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

// DMを送信
export async function sendDiscordDM(message: string): Promise<void> {
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

    console.log('[Discord] sendDiscordDM - sending message to channel:', channelId)
    const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        content: message,
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

// テストメッセージ送信
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

    const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        content: '先輩、テスト送信ですよ。ちゃんと届いてますか？',
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
