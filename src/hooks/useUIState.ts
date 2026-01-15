import { useState } from 'react'
import type { ViewTimeframe } from '@/types/todo'
import { loadViewMode, saveViewMode } from '@/lib/storage'
import { INTRO_SEEN_KEY } from '@/lib/storage'

export function useUIState() {
  // モーダル表示状態
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showSectionModal, setShowSectionModal] = useState(false)
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [showLabelModal, setShowLabelModal] = useState(false)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [showDueDateModal, setShowDueDateModal] = useState(false)
  const [showDurationModal, setShowDurationModal] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [showKarmaModal, setShowKarmaModal] = useState(false)
  const [showDecomposeModal, setShowDecomposeModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem(INTRO_SEEN_KEY))

  // サイドバー・ビュー状態
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'upcoming'>(loadViewMode)
  const [activeView, setActiveView] = useState<'inbox' | 'label' | 'filter' | 'project'>('inbox')
  const [currentTimeframe, setCurrentTimeframe] = useState<ViewTimeframe>('today')

  // 選択状態
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [activeCustomFilter, setActiveCustomFilter] = useState<string | null>(null)
  const [labelFilter, setLabelFilter] = useState<string | null>(null)

  // ビューモード変更
  const changeViewMode = (mode: 'list' | 'board' | 'upcoming') => {
    setViewMode(mode)
    saveViewMode(mode)
  }

  return {
    // モーダル表示状態
    showSettings,
    setShowSettings,
    showHelp,
    setShowHelp,
    showSectionModal,
    setShowSectionModal,
    showFilterModal,
    setShowFilterModal,
    showLabelModal,
    setShowLabelModal,
    showProjectModal,
    setShowProjectModal,
    showDueDateModal,
    setShowDueDateModal,
    showDurationModal,
    setShowDurationModal,
    showCommentModal,
    setShowCommentModal,
    showActivityModal,
    setShowActivityModal,
    showKarmaModal,
    setShowKarmaModal,
    showDecomposeModal,
    setShowDecomposeModal,
    showImportModal,
    setShowImportModal,
    showCalendar,
    setShowCalendar,
    showIntro,
    setShowIntro,

    // サイドバー・ビュー状態
    sidebarCollapsed,
    setSidebarCollapsed,
    viewMode,
    setViewMode,
    activeView,
    setActiveView,
    currentTimeframe,
    setCurrentTimeframe,

    // 選択状態
    selectedLabel,
    setSelectedLabel,
    selectedProjectId,
    setSelectedProjectId,
    activeCustomFilter,
    setActiveCustomFilter,
    labelFilter,
    setLabelFilter,

    // 関数
    changeViewMode,
  }
}

export type UIState = ReturnType<typeof useUIState>
