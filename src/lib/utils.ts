import { invoke } from '@tauri-apps/api/core'
import type { Todo, Timeframe, AutoReminderConfig } from '@/types/todo'

// Check if running in Tauri environment
export const isTauri = () => {
  return typeof window !== 'undefined' &&
    (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function requestNotificationPermission(): Promise<boolean> {
  // Tauri notifications don't require permission on Windows
  return true
}

export async function showNotification(title: string, body: string) {
  console.log('showNotification called, isTauri:', isTauri())
  if (isTauri()) {
    try {
      const result = await invoke<string>('show_notification', { title, body })
      console.log('Notification result:', result)
    } catch (e) {
      console.error('Notification error:', e)
    }
  } else {
    console.log('Not in Tauri environment')
  }
}

// 期間に基づいた自動リマインダー設定を生成
// 今日: 当日の12:00と18:00
// 1週間: 毎日12:00と18:00
// 1ヶ月: 毎日12:00
export function getAutoReminderConfig(timeframe: Timeframe): AutoReminderConfig {
  const allDays = [0, 1, 2, 3, 4, 5, 6] // 毎日
  const today = new Date().getDay()

  if (timeframe === 'today') {
    // 今日: 当日の12:00と18:00
    return { times: ['12:00', '18:00'], days: [today] }
  } else if (timeframe === 'week') {
    // 1週間: 毎日12:00と18:00
    return { times: ['12:00', '18:00'], days: allDays }
  } else {
    // 1ヶ月: 毎日12:00
    return { times: ['12:00'], days: allDays }
  }
}

export async function saveBackup(todos: Todo[], collapsed: Set<string>) {
  if (!isTauri()) return
  // 空のデータでバックアップを上書きしない（データ消失防止）
  if (todos.length === 0) {
    console.log('[Backup] Skipped: todos is empty')
    return
  }
  try {
    const content = JSON.stringify({ todos, collapsed: [...collapsed], savedAt: new Date().toISOString() })
    await invoke('save_backup', { content })
  } catch (e) {
    console.warn('Backup failed:', e)
  }
}

export async function loadBackup(): Promise<{ todos: Todo[], collapsed: string[] } | null> {
  if (!isTauri()) return null
  try {
    const content = await invoke<string>('load_backup')
    return JSON.parse(content)
  } catch (e) {
    console.warn('Load backup failed:', e)
  }
  return null
}
