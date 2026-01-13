import { getKanaeConfig, type KanaeReminderConfig } from './reminder'
import { getClaudeApiKey, generatePlanClaude } from '../lib/claude'
import { getGeminiApiKey, generatePlanGemini } from '../lib/gemini'
import { getApiKey as getOpenAiApiKey, generatePlan as generatePlanOpenAI } from '../lib/openai'
import type { PlanResult, PlanTask } from '../lib/openai'

type PlanProvider = 'claude' | 'openai' | 'gemini'

function resolvePlanProvider(config: KanaeReminderConfig): PlanProvider {
  if (config.aiProvider === 'claude' || config.aiProvider === 'openai' || config.aiProvider === 'gemini') {
    return config.aiProvider
  }
  if (getClaudeApiKey()) {
    return 'claude'
  }
  if (getGeminiApiKey()) {
    return 'gemini'
  }
  if (getOpenAiApiKey()) {
    return 'openai'
  }
  return 'claude'
}

export async function generatePlan(goal: string, targetDays: number, webSearchContext?: string): Promise<PlanResult> {
  const config = getKanaeConfig()
  const provider = resolvePlanProvider(config)

  if (provider === 'claude') {
    return await generatePlanClaude(goal, targetDays, webSearchContext)
  }
  if (provider === 'gemini') {
    return await generatePlanGemini(goal, targetDays, webSearchContext)
  }
  return await generatePlanOpenAI(goal, targetDays, webSearchContext)
}

export type { PlanResult, PlanTask }
