import { useState, useEffect, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { showNotification } from '@/lib/utils'
import { getClaudeApiKey, setClaudeApiKey, clearClaudeApiKey } from '@/lib/claude'
import { setGeminiApiKey, getGeminiApiKey, clearGeminiApiKey } from '@/lib/gemini'
import { getApiKey as getOpenAiApiKey, setApiKey as setOpenAiApiKey, clearApiKey as clearOpenAiApiKey } from '@/lib/openai'
import { getTavilyApiKey, setTavilyApiKey, clearTavilyApiKey } from '@/lib/tavily'
import { setDiscordSettings, testDiscordConnection, sendTestDiscordDM } from '@/lib/discord'
import {
  getKanaeConfig,
  setKanaeConfig,
  KanaeReminderConfig,
  DEFAULT_KANAE_CONFIG,
  DEFAULT_NOTIFICATION_TIMING,
  PERSONA_PRESETS,
  AVAILABLE_MODELS,
  DEFAULT_AI_MODELS,
  type AIModelConfig,
  type NotificationTimingConfig,
} from '@/services/reminder'
import {
  getCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  isCustomPresetId,
  type CustomPersona,
} from '@/lib/kanaePersona'

interface KanaeReminderSettingsProps {
  onClose?: () => void
  onSaved?: () => void
  embedded?: boolean
  saveRef?: React.MutableRefObject<(() => void) | null>
}

export function KanaeReminderSettings({ onClose, onSaved, embedded = false, saveRef }: KanaeReminderSettingsProps) {
  const [config, setLocalConfig] = useState<KanaeReminderConfig>(DEFAULT_KANAE_CONFIG)
  const [claudeApiKey, setLocalClaudeApiKey] = useState('')
  const [geminiApiKey, setLocalGeminiApiKey] = useState('')
  const [openaiApiKey, setLocalOpenaiApiKey] = useState('')
  const [tavilyApiKey, setLocalTavilyApiKey] = useState('')
  const [discordBotToken, setDiscordBotToken] = useState('')
  const [discordUserId, setDiscordUserId] = useState('')
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testMessage, setTestMessage] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [isAddingPreset, setIsAddingPreset] = useState(false)
  const [customPresets, setCustomPresets] = useState<CustomPersona[]>([])
  const [newPreset, setNewPreset] = useState<CustomPersona>({
    name: '',
    systemPrompt: '',
    reminderPromptTemplate: '',
    morningPromptTemplate: '',
  })
  const [aiModels, setAiModels] = useState<AIModelConfig>(DEFAULT_AI_MODELS)
  const [notificationTiming, setNotificationTiming] = useState<NotificationTimingConfig>(DEFAULT_NOTIFICATION_TIMING)
  const [settingsTab, setSettingsTab] = useState<'general' | 'notification'>('general')

  useEffect(() => {
    const savedConfig = getKanaeConfig()
    setLocalConfig(savedConfig)
    setLocalClaudeApiKey(savedConfig.claudeApiKey || getClaudeApiKey() || '')
    setLocalGeminiApiKey(savedConfig.geminiApiKey || getGeminiApiKey() || '')
    setLocalOpenaiApiKey(savedConfig.openaiApiKey || getOpenAiApiKey() || '')
    setLocalTavilyApiKey(getTavilyApiKey() || '')
    setDiscordBotToken(savedConfig.discordBotToken || '')
    setDiscordUserId(savedConfig.discordUserId || '')
    setCustomPresets(getCustomPresets())
    setAiModels(savedConfig.aiModels || DEFAULT_AI_MODELS)
    setNotificationTiming(savedConfig.notificationTiming || DEFAULT_NOTIFICATION_TIMING)
  }, [])

  useEffect(() => {
    if (saveRef) {
      saveRef.current = handleSave
    }
    return () => {
      if (saveRef) {
        saveRef.current = null
      }
    }
  })

  // 外部リンクをブラウザで開く
  const openExternalLink = useCallback((url: string) => {
    open(url).catch(err => {
      console.error('Failed to open URL:', err)
      // フォールバック: window.openを試す
      window.open(url, '_blank')
    })
  }, [])

  // プリセットに応じた説明文を取得
  const getDescriptionByPreset = useCallback(() => {
    if (isAddingPreset) {
      return 'カスタムプリセットを追加します。お好みの人格を設定してください。'
    }
    // カスタムプリセットの場合
    if (isCustomPresetId(config.personaPresetId)) {
      const custom = customPresets.find(p => p.id === config.personaPresetId)
      if (custom) {
        return `${custom.name}の設定で動作中です。`
      }
    }
    switch (config.personaPresetId) {
      case 'kanae':
        return 'しょうがないですね、先輩のために設定してあげますよ。APIキーを入力すれば、タスク分解もリマインダーも使えるようになりますから。'
      case 'secretary':
        return 'AI設定画面でございます。APIキーをご入力いただければ、タスク分解およびリマインダー機能がご利用いただけます。'
      case 'energetic-kouhai':
        return '先輩！AI設定ですよ！APIキーを入れれば、タスク分解もリマインダーも使えるようになります！一緒に頑張りましょう！'
      case 'butler':
        return 'ご主人様、AI設定画面にございます。APIキーをご登録いただければ、タスク分解およびリマインダー機能をご利用いただけます。'
      default:
        return 'AI設定画面です。APIキーを入力すると、タスク分解やリマインダー機能が利用できます。'
    }
  }, [config.personaPresetId, isAddingPreset, customPresets])

  // カスタムプリセットを追加
  const handleAddCustomPreset = () => {
    if (!newPreset.name.trim()) {
      setTestResult('error')
      setTestMessage('プリセット名を入力してください')
      return
    }
    const id = saveCustomPreset(newPreset)
    setCustomPresets(getCustomPresets())
    setLocalConfig({ ...config, personaPresetId: id, personaType: 'preset' })
    setIsAddingPreset(false)
    setNewPreset({
      name: '',
      systemPrompt: '',
      reminderPromptTemplate: '',
      morningPromptTemplate: '',
    })
    setTestResult('success')
    setTestMessage('プリセットを追加しました')
    setTimeout(() => {
      setTestResult(null)
      setTestMessage('')
    }, 3000)
  }

  // カスタムプリセットを削除
  const handleDeleteCustomPreset = (id: string) => {
    deleteCustomPreset(id)
    setCustomPresets(getCustomPresets())
    // 削除したプリセットが選択中だった場合はデフォルトに戻す
    if (config.personaPresetId === id) {
      setLocalConfig({ ...config, personaPresetId: 'kanae' })
    }
    setTestResult('success')
    setTestMessage('プリセットを削除しました')
    setTimeout(() => {
      setTestResult(null)
      setTestMessage('')
    }, 3000)
  }

  // プリセット選択変更時
  const handlePresetChange = (value: string) => {
    if (value === '__add_new__') {
      setIsAddingPreset(true)
    } else {
      setIsAddingPreset(false)
      setLocalConfig({ ...config, personaPresetId: value, personaType: 'preset' })
    }
  }

  const handleSave = () => {
    // APIキーが空の場合は削除、値がある場合は保存
    if (claudeApiKey.trim()) {
      setClaudeApiKey(claudeApiKey.trim())
    } else {
      clearClaudeApiKey()
    }
    if (geminiApiKey.trim()) {
      setGeminiApiKey(geminiApiKey.trim())
    } else {
      clearGeminiApiKey()
    }
    if (openaiApiKey.trim()) {
      setOpenAiApiKey(openaiApiKey.trim())
    } else {
      clearOpenAiApiKey()
    }
    if (tavilyApiKey.trim()) {
      setTavilyApiKey(tavilyApiKey.trim())
    } else {
      clearTavilyApiKey()
    }

    // 使えるAPIが一つもない場合は警告
    const hasAnyApiKey = claudeApiKey.trim() || geminiApiKey.trim() || openaiApiKey.trim()
    if (!hasAnyApiKey) {
      setTestResult('error')
      setTestMessage('AI APIキーが1つも設定されていません。タスク分解やリマインダー機能を使用するには、少なくとも1つのAPIキーを設定してください。')
      // configは保存するが、警告は出す
    }

    setDiscordSettings({
      botToken: discordBotToken.trim(),
      userId: discordUserId.trim(),
      enabled: config.discordEnabled,
    })
    setKanaeConfig({
      ...config,
      claudeApiKey: claudeApiKey.trim(),
      geminiApiKey: geminiApiKey.trim(),
      openaiApiKey: openaiApiKey.trim(),
      discordBotToken: discordBotToken.trim(),
      discordUserId: discordUserId.trim(),
      personaType: 'preset',
      customPersona: null,
      aiModels,
      notificationTiming,
    })

    // APIがある場合のみ成功メッセージ
    if (hasAnyApiKey) {
      setTestResult('success')
      setTestMessage('設定を保存しました')
      setTimeout(() => {
        setTestResult(null)
        setTestMessage('')
      }, 3000)
    }
    onSaved?.()
  }

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    setTestMessage('')
    try {
      setDiscordSettings({
        botToken: discordBotToken.trim(),
        userId: discordUserId.trim(),
        enabled: true,
      })
      await testDiscordConnection()
      setTestResult('success')
      setTestMessage('Discord接続テスト成功！DMを送信できます')
    } catch (error) {
      setTestResult('error')
      setTestMessage(error instanceof Error ? error.message : '接続テストに失敗しました')
    } finally {
      setIsTesting(false)
    }
  }

  const handleSendTestMessage = async () => {
    setIsSendingTest(true)
    setTestResult(null)
    setTestMessage('')
    try {
      setDiscordSettings({
        botToken: discordBotToken.trim(),
        userId: discordUserId.trim(),
        enabled: true,
      })
      await sendTestDiscordDM()
      setTestResult('success')
      setTestMessage('テストメッセージを送信しました！Discordを確認してください')
    } catch (error) {
      setTestResult('error')
      setTestMessage(error instanceof Error ? error.message : 'テスト送信に失敗しました')
    } finally {
      setIsSendingTest(false)
    }
  }

  return (
    <div className="kanae-settings">
      <h3>AI設定</h3>
      <p className="modal-description">
        {getDescriptionByPreset()}
      </p>

      {/* タブナビゲーション */}
      <div className="settings-tabs">
        <button
          className={`settings-tab ${settingsTab === 'general' ? 'active' : ''}`}
          onClick={() => setSettingsTab('general')}
        >
          一般
        </button>
        <button
          className={`settings-tab ${settingsTab === 'notification' ? 'active' : ''}`}
          onClick={() => setSettingsTab('notification')}
        >
          通知
        </button>
      </div>

      {/* 一般タブ */}
      {settingsTab === 'general' && (
        <>
      {/* 人格設定（最上部） */}
      <div className="settings-subsection persona-top">
        <h4>人格</h4>
        <div className="settings-row-inline">
          <span>プリセット</span>
          <select
            className={`preset-select ${isAddingPreset ? 'adding-preset' : ''}`}
            value={isAddingPreset ? '__add_new__' : config.personaPresetId}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            {PERSONA_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
            {customPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
            <option value="__add_new__" className="add-preset-option">+ プリセットを追加</option>
          </select>
        </div>

        {/* プリセット説明文と削除ボタン */}
        {!isAddingPreset && (
          <>
            {isCustomPresetId(config.personaPresetId) ? (
              <div className="preset-info">
                <p className="persona-description">
                  {customPresets.find(p => p.id === config.personaPresetId)?.systemPrompt?.slice(0, 100)}...
                </p>
                <button
                  type="button"
                  className="delete-preset-btn"
                  onClick={() => handleDeleteCustomPreset(config.personaPresetId)}
                >
                  削除
                </button>
              </div>
            ) : (
              <p className="persona-description">
                {PERSONA_PRESETS.find(p => p.id === config.personaPresetId)?.description}
              </p>
            )}
          </>
        )}

        {/* カスタムプリセット追加フォーム */}
        {isAddingPreset && (
          <div className="custom-persona-form settings-subsection">
            <h4>新しいプリセットを追加</h4>
            <div className="settings-label-block">
              <span>プリセット名</span>
              <input
                type="text"
                className="api-key-input"
                placeholder="例: マイアシスタント"
                value={newPreset.name}
                onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
              />
            </div>
            <div className="settings-label-block">
              <span>人格設定（システムプロンプト）</span>
              <textarea
                className="api-key-input prompt-textarea"
                placeholder="あなたは〇〇です。以下の性格で話してください..."
                value={newPreset.systemPrompt}
                onChange={(e) => setNewPreset({ ...newPreset, systemPrompt: e.target.value })}
              />
              <span className="settings-hint">人格の性格や口調を自由に記述してください</span>
            </div>
            <div className="settings-label-block">
              <span>リマインド時の追加指示（任意）</span>
              <textarea
                className="api-key-input prompt-textarea small"
                placeholder="例: 厳しめに言って、でも最後は励まして"
                value={newPreset.reminderPromptTemplate}
                onChange={(e) => setNewPreset({ ...newPreset, reminderPromptTemplate: e.target.value })}
              />
              <span className="settings-hint">自由に記述できます。空欄の場合は人格設定のみで生成します</span>
            </div>
            <div className="settings-label-block">
              <span>朝の挨拶の追加指示（任意）</span>
              <textarea
                className="api-key-input prompt-textarea small"
                placeholder="例: 今日の予定を確認して、応援して"
                value={newPreset.morningPromptTemplate}
                onChange={(e) => setNewPreset({ ...newPreset, morningPromptTemplate: e.target.value })}
              />
              <span className="settings-hint">自由に記述できます。空欄でもOK</span>
            </div>
            <div className="preset-form-actions">
              <button
                type="button"
                className="modal-btn secondary"
                onClick={() => {
                  setIsAddingPreset(false)
                  setNewPreset({
                    name: '',
                    systemPrompt: '',
                    reminderPromptTemplate: '',
                    morningPromptTemplate: '',
                  })
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="modal-btn primary"
                onClick={handleAddCustomPreset}
              >
                追加
              </button>
            </div>
          </div>
        )}
      </div>

      {/* APIキー設定 */}
      <div className="settings-subsection api-keys-top">
        <h4>APIキー</h4>
        <div className="settings-row-inline">
          <span>使用するAI</span>
          <select
            value={config.aiProvider}
            onChange={(e) =>
              setLocalConfig({ ...config, aiProvider: e.target.value as KanaeReminderConfig['aiProvider'] })
            }
          >
            <option value="auto">自動</option>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <p className="settings-hint">
          タスク分解とリマインダー生成で使用するAIを選択します。「自動」は利用可能なキーから選択します。
        </p>
        <div className="settings-label-block">
          <span>OpenAI APIキー</span>
          <input
            type="password"
            className="api-key-input"
            placeholder="sk-..."
            value={openaiApiKey}
            onChange={(e) => setLocalOpenaiApiKey(e.target.value)}
          />
          <button type="button" className="api-key-link" onClick={() => openExternalLink('https://platform.openai.com/api-keys')}>
            OpenAI Platformで取得 →
          </button>
        </div>
        <div className="settings-label-block">
          <span>Claude APIキー</span>
          <input
            type="password"
            className="api-key-input"
            placeholder="sk-ant-api..."
            value={claudeApiKey}
            onChange={(e) => setLocalClaudeApiKey(e.target.value)}
          />
          <button type="button" className="api-key-link" onClick={() => openExternalLink('https://console.anthropic.com/settings/keys')}>
            Anthropic Consoleで取得 →
          </button>
        </div>
        <div className="settings-label-block">
          <span>Gemini APIキー</span>
          <input
            type="password"
            className="api-key-input"
            placeholder="AIza..."
            value={geminiApiKey}
            onChange={(e) => setLocalGeminiApiKey(e.target.value)}
          />
          <button type="button" className="api-key-link" onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')}>
            Google AI Studioで取得 →
          </button>
        </div>
        <div className="settings-label-block">
          <span>Tavily APIキー（ウェブ検索）</span>
          <input
            type="password"
            className="api-key-input"
            placeholder="tvly-..."
            value={tavilyApiKey}
            onChange={(e) => setLocalTavilyApiKey(e.target.value)}
          />
          <button type="button" className="api-key-link" onClick={() => openExternalLink('https://tavily.com/')}>
            Tavilyで取得 →
          </button>
          <span className="settings-hint">計画生成時にウェブ検索で情報を補完します（任意）</span>
        </div>
      </div>

      {/* モデル設定 */}
      <div className="settings-subsection">
        <h4>モデル設定</h4>
        <p className="settings-hint">各プロバイダーで使用するモデルを選択します。<br />計画やタスク分割で高精度な結果を得たい場合は上位モデルを選択してください。</p>
        <div className="settings-label-block">
          <span>OpenAI モデル</span>
          <select
            value={aiModels.openai}
            onChange={(e) => setAiModels({ ...aiModels, openai: e.target.value })}
          >
            {AVAILABLE_MODELS.openai.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-label-block">
          <span>Claude モデル</span>
          <select
            value={aiModels.claude}
            onChange={(e) => setAiModels({ ...aiModels, claude: e.target.value })}
          >
            {AVAILABLE_MODELS.claude.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-label-block">
          <span>Gemini モデル</span>
          <select
            value={aiModels.gemini}
            onChange={(e) => setAiModels({ ...aiModels, gemini: e.target.value })}
          >
            {AVAILABLE_MODELS.gemini.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      </div>
        </>
      )}

      {/* 通知タブ */}
      {settingsTab === 'notification' && (
        <>
      {/* リマインダー設定 */}
      <div className="settings-subsection">
        <h4>リマインダー</h4>

        {/* 重要な注意事項 */}
        <div className="startup-warning">
          <div className="warning-icon">⚠️</div>
          <div className="warning-content">
            <strong>通知を受け取るには、アプリを常に起動しておく必要があります</strong>
            <p>
              アプリを閉じると通知が届きません。
              Windowsのスタートアップに登録して自動起動させることをおすすめします。
            </p>
            <details className="startup-help">
              <summary>スタートアップへの登録方法</summary>
              <ol>
                <li><kbd>Win</kbd> + <kbd>R</kbd> を押して「ファイル名を指定して実行」を開く</li>
                <li><code>shell:startup</code> と入力してEnter</li>
                <li>開いたフォルダに、このアプリのショートカットをコピー</li>
              </ol>
              <p className="startup-tip">
                ※ ショートカットは、アプリの実行ファイル（.exe）を右クリック →「ショートカットの作成」で作れます
              </p>
            </details>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setLocalConfig({ ...config, enabled: e.target.checked })}
            />
            リマインダーを有効にする
          </label>
          <span className="settings-hint">デスクトップ通知のオン/オフを切り替えます</span>
        </div>

        {config.enabled && (
          <>
            {/* Discord設定 */}
            <div className="discord-section">
              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={config.discordEnabled}
                  onChange={(e) => setLocalConfig({ ...config, discordEnabled: e.target.checked })}
                />
                Discord DMを有効にする
              </label>

              {config.discordEnabled && (
                <>
                  <div className="settings-label-block">
                    <span>Bot Token</span>
                    <input
                      type="password"
                      className="api-key-input"
                      placeholder="Discord Bot Token"
                      value={discordBotToken}
                      onChange={(e) => setDiscordBotToken(e.target.value)}
                    />
                    <button type="button" className="api-key-link" onClick={() => openExternalLink('https://discord.com/developers/applications')}>
                      Discord Developer Portalで取得 →
                    </button>
                  </div>
                  <div className="settings-label-block">
                    <span>User ID</span>
                    <input
                      type="text"
                      className="api-key-input"
                      placeholder="あなたのDiscord User ID"
                      value={discordUserId}
                      onChange={(e) => setDiscordUserId(e.target.value)}
                    />
                    <button type="button" className="api-key-link" onClick={() => openExternalLink('https://support.discord.com/hc/ja/articles/206346498')}>
                      User IDの取得方法を見る →
                    </button>
                    <span className="api-key-hint">
                      開発者モードをON → 自分のアイコンを右クリック →「IDをコピー」
                    </span>
                  </div>
                  <div className="discord-test-btns">
                    <button
                      className="modal-btn secondary"
                      onClick={handleTestConnection}
                      disabled={isTesting || isSendingTest || !discordBotToken || !discordUserId}
                    >
                      {isTesting ? 'テスト中...' : '接続テスト'}
                    </button>
                    <button
                      className="modal-btn primary"
                      onClick={handleSendTestMessage}
                      disabled={isTesting || isSendingTest || !discordBotToken || !discordUserId}
                    >
                      {isSendingTest ? '送信中...' : 'テスト送信'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* リマインダータイミング */}
            <div className="timing-section">
              <div className="settings-row-inline">
                <span>リマインドタイミング</span>
                <select
                  value={config.reminderTiming}
                  onChange={(e) => setLocalConfig({ ...config, reminderTiming: Number(e.target.value) })}
                >
                  <option value={15}>15分前</option>
                  <option value={30}>30分前</option>
                  <option value={60}>1時間前</option>
                  <option value={180}>3時間前</option>
                  <option value={1440}>1日前</option>
                </select>
              </div>

              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={config.overdueReminder}
                  onChange={(e) => setLocalConfig({ ...config, overdueReminder: e.target.checked })}
                />
                期限切れタスクもリマインドする
              </label>

              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={config.morningGreeting}
                  onChange={(e) => setLocalConfig({ ...config, morningGreeting: e.target.checked })}
                />
                朝の挨拶を送る
              </label>

              {config.morningGreeting && (
                <div className="settings-row-inline">
                  <span>挨拶時間</span>
                  <input
                    type="time"
                    value={config.morningGreetingTime}
                    onChange={(e) => setLocalConfig({ ...config, morningGreetingTime: e.target.value })}
                  />
                </div>
              )}

              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={config.noonGreeting}
                  onChange={(e) => setLocalConfig({ ...config, noonGreeting: e.target.checked })}
                />
                昼の挨拶を送る
              </label>

              {config.noonGreeting && (
                <div className="settings-row-inline">
                  <span>挨拶時間</span>
                  <input
                    type="time"
                    value={config.noonGreetingTime}
                    onChange={(e) => setLocalConfig({ ...config, noonGreetingTime: e.target.value })}
                  />
                </div>
              )}

              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={config.eveningGreeting}
                  onChange={(e) => setLocalConfig({ ...config, eveningGreeting: e.target.checked })}
                />
                夜の挨拶を送る
              </label>

              {config.eveningGreeting && (
                <div className="settings-row-inline">
                  <span>挨拶時間</span>
                  <input
                    type="time"
                    value={config.eveningGreetingTime}
                    onChange={(e) => setLocalConfig({ ...config, eveningGreetingTime: e.target.value })}
                  />
                </div>
              )}
            </div>

            {/* メモリ設定 */}
            <div className="memory-section">
              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={config.useMemory}
                  onChange={(e) => setLocalConfig({ ...config, useMemory: e.target.checked })}
                />
                MCPメモリを参照する
              </label>
              {config.useMemory && (
                <>
                  <input
                    type="text"
                    className="api-key-input"
                    placeholder="例: C:\Users\user\.claude\memory.json"
                    value={config.memoryFilePath}
                    onChange={(e) => setLocalConfig({ ...config, memoryFilePath: e.target.value })}
                  />
                  <p className="settings-hint mcp-help">
                    MCP Memory Serverのメモリファイルパスを指定します。
                    <br />
                    <strong>設定例:</strong> Claude Codeで <code>@anthropic/claude-code-mcp-memory</code> を使用している場合、
                    <code>~/.claude/memory.json</code> がデフォルトパスです。
                  </p>
                </>
              )}
              <p className="settings-hint">
                メモリを参照すると、関係性を踏まえたパーソナライズされたリマインドを生成できます。
              </p>
            </div>

            {/* 通知タイミング詳細設定 */}
            <div className="timing-detail-section">
              <h5>通知タイミング詳細</h5>

              {/* おやすみモード */}
              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={notificationTiming.quietHoursEnabled}
                  onChange={(e) => setNotificationTiming({ ...notificationTiming, quietHoursEnabled: e.target.checked })}
                />
                おやすみモード（指定時間帯は通知しない）
              </label>
              {notificationTiming.quietHoursEnabled && (
                <div className="quiet-hours-inputs">
                  <div className="settings-row-inline">
                    <span>開始</span>
                    <input
                      type="time"
                      value={notificationTiming.quietHoursStart}
                      onChange={(e) => setNotificationTiming({ ...notificationTiming, quietHoursStart: e.target.value })}
                    />
                  </div>
                  <div className="settings-row-inline">
                    <span>終了</span>
                    <input
                      type="time"
                      value={notificationTiming.quietHoursEnd}
                      onChange={(e) => setNotificationTiming({ ...notificationTiming, quietHoursEnd: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* 曜日指定 */}
              <div className="allowed-days-section">
                <span className="settings-label-text">通知する曜日</span>
                <div className="days-checkboxes">
                  {['日', '月', '火', '水', '木', '金', '土'].map((day, index) => (
                    <label key={index} className="day-checkbox">
                      <input
                        type="checkbox"
                        checked={notificationTiming.allowedDays.includes(index)}
                        onChange={(e) => {
                          const newDays = e.target.checked
                            ? [...notificationTiming.allowedDays, index].sort()
                            : notificationTiming.allowedDays.filter(d => d !== index)
                          setNotificationTiming({ ...notificationTiming, allowedDays: newDays })
                        }}
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>

              {/* フォローアップ（追い通知） */}
              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={notificationTiming.followUpEnabled}
                  onChange={(e) => setNotificationTiming({ ...notificationTiming, followUpEnabled: e.target.checked })}
                />
                フォローアップ通知（追い通知）
              </label>
              {notificationTiming.followUpEnabled && (
                <div className="followup-inputs">
                  <div className="settings-row-inline">
                    <span>間隔</span>
                    <select
                      value={notificationTiming.followUpIntervalMinutes}
                      onChange={(e) => setNotificationTiming({ ...notificationTiming, followUpIntervalMinutes: Number(e.target.value) })}
                    >
                      <option value={15}>15分</option>
                      <option value={30}>30分</option>
                      <option value={60}>1時間</option>
                      <option value={120}>2時間</option>
                      <option value={180}>3時間</option>
                      <option value={360}>6時間</option>
                      <option value={720}>12時間</option>
                    </select>
                  </div>
                  <div className="settings-row-inline">
                    <span>最大回数</span>
                    <select
                      value={notificationTiming.followUpMaxCount}
                      onChange={(e) => setNotificationTiming({ ...notificationTiming, followUpMaxCount: Number(e.target.value) })}
                    >
                      <option value={1}>1回</option>
                      <option value={2}>2回</option>
                      <option value={3}>3回</option>
                      <option value={5}>5回</option>
                      <option value={10}>10回</option>
                      <option value={99}>無制限</option>
                    </select>
                  </div>
                </div>
              )}

              {/* 最小通知間隔 */}
              <div className="settings-row-inline">
                <span>最小通知間隔</span>
                <select
                  value={notificationTiming.minIntervalMinutes}
                  onChange={(e) => setNotificationTiming({ ...notificationTiming, minIntervalMinutes: Number(e.target.value) })}
                >
                  <option value={1}>1分</option>
                  <option value={5}>5分</option>
                  <option value={10}>10分</option>
                  <option value={15}>15分</option>
                  <option value={30}>30分</option>
                  <option value={60}>1時間</option>
                </select>
              </div>
              <p className="settings-hint">同じタスクへの連続通知を防ぎます</p>

              {/* 1日の通知回数制限 */}
              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={notificationTiming.dailyLimitEnabled}
                  onChange={(e) => setNotificationTiming({ ...notificationTiming, dailyLimitEnabled: e.target.checked })}
                />
                1日の通知回数を制限
              </label>
              {notificationTiming.dailyLimitEnabled && (
                <div className="settings-row-inline">
                  <span>上限</span>
                  <select
                    value={notificationTiming.dailyLimitCount}
                    onChange={(e) => setNotificationTiming({ ...notificationTiming, dailyLimitCount: Number(e.target.value) })}
                  >
                    <option value={5}>5回</option>
                    <option value={10}>10回</option>
                    <option value={15}>15回</option>
                    <option value={20}>20回</option>
                    <option value={30}>30回</option>
                    <option value={50}>50回</option>
                  </select>
                </div>
              )}

              {/* 同じタスクへの通知頻度 */}
              <div className="settings-row-inline">
                <span>同じタスクへの通知（1日）</span>
                <select
                  value={notificationTiming.sameTaskFrequency}
                  onChange={(e) => setNotificationTiming({
                    ...notificationTiming,
                    sameTaskFrequency: e.target.value as 'once' | 'twice' | 'unlimited' | 'custom'
                  })}
                >
                  <option value="once">1回のみ</option>
                  <option value="twice">2回まで</option>
                  <option value="custom">カスタム</option>
                  <option value="unlimited">無制限</option>
                </select>
              </div>
              {notificationTiming.sameTaskFrequency === 'custom' && (
                <div className="settings-row-inline custom-limit-row">
                  <span>カスタム上限</span>
                  <select
                    value={notificationTiming.sameTaskCustomLimit}
                    onChange={(e) => setNotificationTiming({ ...notificationTiming, sameTaskCustomLimit: Number(e.target.value) })}
                  >
                    <option value={3}>3回</option>
                    <option value={5}>5回</option>
                    <option value={10}>10回</option>
                    <option value={15}>15回</option>
                    <option value={20}>20回</option>
                  </select>
                </div>
              )}
              <p className="settings-hint">同じタスクに対して1日に何回まで通知するか</p>

              {/* 期限切れタスクの通知頻度 */}
              <div className="settings-row-inline">
                <span>期限切れタスクの通知</span>
                <select
                  value={notificationTiming.overdueFrequency}
                  onChange={(e) => setNotificationTiming({
                    ...notificationTiming,
                    overdueFrequency: e.target.value as 'once' | 'daily' | 'twice_daily' | 'hourly'
                  })}
                >
                  <option value="once">1回のみ</option>
                  <option value="daily">1日1回</option>
                  <option value="twice_daily">1日2回</option>
                  <option value="hourly">1時間ごと</option>
                </select>
              </div>
              <p className="settings-hint">期限が切れたタスクをどのくらいの頻度で通知するか</p>
            </div>

            {/* デスクトップ通知テスト */}
            <div className="desktop-notification-test">
              <h5>デスクトップ通知テスト</h5>
              <p className="settings-hint">デスクトップ通知が正しく動作するかテストします</p>
              <button
                className="modal-btn secondary"
                onClick={() => {
                  showNotification('テスト通知', '通知が正常に動作しています！')
                  setTestResult('success')
                  setTestMessage('デスクトップ通知を送信しました')
                  setTimeout(() => {
                    setTestResult(null)
                    setTestMessage('')
                  }, 3000)
                }}
              >
                デスクトップ通知テスト
              </button>
            </div>
          </>
        )}
      </div>
        </>
      )}

      {testResult && (
        <div className={`test-result ${testResult}`}>
          {testMessage}
        </div>
      )}

      {!embedded && (
        <div className="modal-actions">
          {onClose && (
            <button className="modal-btn secondary" onClick={onClose}>
              閉じる
            </button>
          )}
          <button className="modal-btn primary" onClick={handleSave}>
            保存
          </button>
        </div>
      )}

      <style>{`
        .kanae-settings {
          text-align: left;
        }
        .settings-tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 16px;
          border-bottom: 2px solid var(--border-color, #d6d3d1);
        }
        .settings-tab {
          padding: 10px 20px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .settings-tab:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }
        .settings-tab.active {
          color: var(--accent-primary, #e07b39);
          border-bottom-color: var(--accent-primary, #e07b39);
        }
        .settings-row {
          margin: 12px 0;
        }
        .settings-row-inline {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 8px 0;
          font-size: 14px;
        }
        .settings-row-inline select,
        .settings-row-inline input[type="time"] {
          padding: 6px 10px;
          background: var(--bg-secondary);
          border: 2px solid var(--border-color, #d6d3d1);
          border-radius: 6px;
          color: var(--text-primary);
          min-width: 140px;
        }
        .preset-select {
          max-width: 200px;
          border: 2px solid var(--accent-primary, #e07b39);
          background: var(--bg-elevated, #ffffff);
        }
        .preset-select:hover {
          border-color: var(--accent-secondary, #c96a2e);
          box-shadow: 0 0 0 2px rgba(224, 123, 57, 0.1);
        }
        .preset-select:focus {
          border-color: var(--accent-primary, #e07b39);
          box-shadow: 0 0 0 3px rgba(224, 123, 57, 0.2);
          outline: none;
        }
        .preset-select.adding-preset {
          border: 2px solid var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(224, 123, 57, 0.15);
          background: rgba(224, 123, 57, 0.05);
        }
        .preset-select option.add-preset-option {
          color: var(--accent-primary);
          font-weight: 600;
        }
        .persona-description {
          font-size: 12px;
          color: var(--text-tertiary);
          margin: 4px 0 0 0;
          font-style: italic;
        }
        .settings-label {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 8px 0;
          font-size: 14px;
        }
        .settings-label input[type="checkbox"] {
          width: 16px;
          height: 16px;
        }
        .settings-label-block {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 8px 0;
          font-size: 14px;
        }
        .settings-label-block select {
          padding: 8px 12px;
          background: var(--bg-secondary);
          border: 2px solid var(--border-color, #d6d3d1);
          border-radius: 6px;
          color: var(--text-primary);
          font-size: 14px;
        }
        .settings-label-block select:focus {
          outline: none;
          border-color: var(--accent-primary, #e07b39);
          box-shadow: 0 0 0 2px rgba(224, 123, 57, 0.1);
        }
        .settings-subsection {
          margin: 16px 0;
          padding: 12px;
          background: var(--bg-tertiary);
          border-radius: 8px;
        }
        .settings-subsection h4 {
          margin: 0 0 8px 0;
          font-size: 14px;
          color: var(--text-secondary);
        }
        .api-keys-top {
          background: var(--bg-secondary);
          border: 1px solid var(--accent-color);
        }
        .settings-hint {
          font-size: 12px;
          color: var(--text-tertiary);
          margin: 4px 0 8px 0;
        }
        .api-key-hint {
          font-size: 11px;
          color: var(--text-tertiary);
          display: block;
          margin-top: 4px;
        }
        .api-key-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          margin-top: 6px;
          background: transparent;
          color: #78716c;
          border: 1px solid #d6d3d1;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          text-decoration: none;
        }
        .api-key-link:hover {
          background: #f5f5f4;
          border-color: #a8a29e;
          color: #57534e;
        }
        .api-key-link:active {
          background: #e7e5e4;
        }
        .persona-section,
        .discord-section,
        .timing-section,
        .memory-section,
        .timing-detail-section {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color);
        }
        .timing-detail-section h5 {
          margin: 0 0 12px 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .quiet-hours-inputs {
          margin-left: 24px;
          margin-bottom: 12px;
        }
        .allowed-days-section {
          margin: 12px 0;
        }
        .settings-label-text {
          display: block;
          font-size: 14px;
          margin-bottom: 8px;
        }
        .days-checkboxes {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .day-checkbox {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .day-checkbox:has(input:checked) {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          color: white;
        }
        .day-checkbox input {
          width: 12px;
          height: 12px;
          margin: 0;
        }
        .followup-inputs {
          margin-left: 24px;
          margin-bottom: 12px;
        }
        .custom-limit-row {
          margin-left: 24px;
        }
        .discord-test-btns {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        .test-result {
          padding: 8px 12px;
          border-radius: 4px;
          margin: 12px 0;
          font-size: 14px;
        }
        .test-result.success {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
        }
        .test-result.error {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }
        .custom-persona-form {
          margin-top: 12px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
        }
        .custom-persona-form h4 {
          color: var(--accent-primary);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .prompt-textarea {
          min-height: 100px;
          font-family: inherit;
          resize: vertical;
          margin-bottom: 0;
        }
        .prompt-textarea.small {
          min-height: 60px;
        }
        .preset-info {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }
        .preset-info .persona-description {
          flex: 1;
        }
        .delete-preset-btn {
          padding: 4px 8px;
          font-size: 11px;
          background: transparent;
          color: #ef4444;
          border: 1px solid #ef4444;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .delete-preset-btn:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        .preset-form-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 12px;
        }
        .mcp-help {
          margin-top: 8px;
          padding: 8px;
          background: var(--bg-tertiary);
          border-radius: 4px;
        }
        .mcp-help code {
          background: var(--bg-secondary);
          padding: 2px 4px;
          border-radius: 2px;
          font-size: 11px;
        }
        .desktop-notification-test {
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color);
        }
        .desktop-notification-test h5 {
          margin: 0 0 8px 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .desktop-notification-test button {
          margin-top: 8px;
        }
        .startup-warning {
          display: flex;
          gap: 12px;
          padding: 12px;
          margin-bottom: 16px;
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.15) 100%);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 8px;
          border-left: 4px solid #f59e0b;
        }
        .warning-icon {
          font-size: 20px;
          flex-shrink: 0;
        }
        .warning-content {
          flex: 1;
          font-size: 13px;
          line-height: 1.5;
        }
        .warning-content strong {
          display: block;
          color: #b45309;
          margin-bottom: 4px;
        }
        .warning-content p {
          margin: 0;
          color: var(--text-secondary);
        }
        .startup-help {
          margin-top: 10px;
          padding: 10px;
          background: var(--bg-secondary);
          border-radius: 6px;
        }
        .startup-help summary {
          cursor: pointer;
          font-weight: 500;
          color: var(--accent-primary);
          padding: 4px 0;
        }
        .startup-help summary:hover {
          text-decoration: underline;
        }
        .startup-help ol {
          margin: 10px 0;
          padding-left: 20px;
        }
        .startup-help li {
          margin: 6px 0;
          line-height: 1.6;
        }
        .startup-help kbd {
          display: inline-block;
          padding: 2px 6px;
          font-size: 11px;
          font-family: var(--font-mono, monospace);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 3px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        .startup-help code {
          background: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
        }
        .startup-tip {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-tertiary);
          font-style: italic;
        }
      `}</style>
    </div>
  )
}
