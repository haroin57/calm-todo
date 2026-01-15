import { useState } from 'react'
import {
  loadActivityLog,
  saveActivityLog,
  loadKarma,
  saveKarma,
  calculateLevel,
  getLevelName,
  getPointsForNextLevel,
  getPointsForCurrentLevel,
  PRIORITY_POINTS,
  getDifficultyBonus,
  LEVEL_THRESHOLDS,
} from '@/lib/storage'
import type { ActivityLog, KarmaStats, Priority, Todo } from '@/types/todo'

export function useKarma() {
  const [activityLog, setActivityLog] = useState<ActivityLog[]>(loadActivityLog)
  const [karma, setKarma] = useState<KarmaStats>(loadKarma)

  // アクティビティログ追加ヘルパー
  const addActivityLog = (log: Omit<ActivityLog, 'id' | 'timestamp'>) => {
    const newLog: ActivityLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }
    setActivityLog(prev => {
      const updated = [...prev, newLog]
      saveActivityLog(updated)
      return updated
    })
  }

  // カルマ更新ヘルパー（タスク完了時）
  const updateKarmaOnComplete = (taskPriority: Priority, estimatedMinutes: number | null = null) => {
    setKarma(prev => {
      const today = new Date().toISOString().slice(0, 10)
      const isNewDay = prev.lastCompletedDate !== today
      const newStreak = isNewDay ? (prev.lastCompletedDate === new Date(Date.now() - 86400000).toISOString().slice(0, 10) ? prev.streak + 1 : 1) : prev.streak

      // 優先度に応じたポイント (P1=10, P2=7, P3=5, P4=3)
      const basePoints = PRIORITY_POINTS[taskPriority]
      // ストリークボーナス（最大7）
      const streakBonus = Math.min(newStreak, 7)
      // 困難度ボーナス（所要時間に応じて）
      const difficultyBonus = getDifficultyBonus(estimatedMinutes)
      const totalPointsEarned = basePoints + streakBonus + difficultyBonus

      const newTotalPoints = prev.totalPoints + totalPointsEarned
      const newLevel = calculateLevel(newTotalPoints)

      const updated: KarmaStats = {
        totalPoints: newTotalPoints,
        level: newLevel,
        streak: newStreak,
        longestStreak: Math.max(prev.longestStreak, newStreak),
        tasksCompleted: prev.tasksCompleted + 1,
        tasksCompletedToday: isNewDay ? 1 : prev.tasksCompletedToday + 1,
        lastCompletedDate: today
      }
      saveKarma(updated)
      return updated
    })
  }

  // カルマ更新ヘルパー（タスク完了取り消し時）
  const updateKarmaOnUncomplete = (taskPriority: Priority, estimatedMinutes: number | null = null) => {
    setKarma(prev => {
      // 優先度に応じたポイント
      const basePoints = PRIORITY_POINTS[taskPriority]
      // ストリークボーナスは完了時と同じ計算（最大7）
      const streakBonus = Math.min(prev.streak, 7)
      // 困難度ボーナス
      const difficultyBonus = getDifficultyBonus(estimatedMinutes)
      const totalPointsToRemove = basePoints + streakBonus + difficultyBonus

      const newTotalPoints = Math.max(0, prev.totalPoints - totalPointsToRemove)
      const newLevel = calculateLevel(newTotalPoints)

      const updated: KarmaStats = {
        ...prev,
        totalPoints: newTotalPoints,
        level: newLevel,
        tasksCompleted: Math.max(0, prev.tasksCompleted - 1),
        tasksCompletedToday: Math.max(0, prev.tasksCompletedToday - 1)
      }
      saveKarma(updated)
      return updated
    })
  }

  // GitHub-style contribution graph helpers
  const getContributionData = (todos: Todo[]) => {
    const today = new Date()
    const data: { date: Date; count: number }[] = []

    // 過去365日分のデータを生成
    for (let i = 364; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const dayStart = date.getTime()
      const dayEnd = dayStart + 24 * 60 * 60 * 1000

      // その日に完了したタスク数をカウント（completedAtを優先、なければdueDate/createdAtで推定）
      const completedCount = todos.filter(t => {
        if (!t.completed) return false
        // completedAtがある場合はそれを使用
        if (t.completedAt && t.completedAt >= dayStart && t.completedAt < dayEnd) return true
        // 旧データ互換: completedAtがない場合はdueDate/createdAtで推定
        if (!t.completedAt) {
          if (t.dueDate && t.dueDate >= dayStart && t.dueDate < dayEnd) return true
          if (t.createdAt >= dayStart && t.createdAt < dayEnd) return true
        }
        return false
      }).length

      data.push({ date, count: completedCount })
    }
    return data
  }

  const getContributionLevel = (count: number) => {
    if (count === 0) return 0
    if (count <= 2) return 1
    if (count <= 4) return 2
    if (count <= 6) return 3
    return 4
  }

  return {
    // 状態
    karma,
    setKarma,
    activityLog,
    setActivityLog,

    // 関数
    addActivityLog,
    updateKarmaOnComplete,
    updateKarmaOnUncomplete,
    getContributionData,
    getContributionLevel,

    // 再エクスポート（便利なユーティリティ）
    calculateLevel,
    getLevelName,
    getPointsForNextLevel,
    getPointsForCurrentLevel,
    PRIORITY_POINTS,
    getDifficultyBonus,
    LEVEL_THRESHOLDS,
  }
}

export type KarmaState = ReturnType<typeof useKarma>
