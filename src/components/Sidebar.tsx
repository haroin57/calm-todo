import type {
  Todo,
  Project,
  LabelDefinition,
  CustomFilter,
  KarmaStats,
  ViewTimeframe
} from '@/types/todo'

interface SidebarProps {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  activeView: 'inbox' | 'label' | 'filter' | 'project'
  setActiveView: (v: 'inbox' | 'label' | 'filter' | 'project') => void
  currentTimeframe: ViewTimeframe
  setCurrentTimeframe: (v: ViewTimeframe) => void
  selectedLabel: string | null
  setSelectedLabel: (v: string | null) => void
  labelFilter: string | null
  setLabelFilter: (v: string | null) => void
  selectedProjectId: string | null
  setSelectedProjectId: (v: string | null) => void
  todos: Todo[]
  projects: Project[]
  allLabels: string[]
  labelDefinitions: LabelDefinition[]
  customFilters: CustomFilter[]
  activeCustomFilter: string | null
  karma: KarmaStats
  // 関数props
  setShowKarmaModal: (v: boolean) => void
  setShowProjectModal: (v: boolean) => void
  setShowLabelModal: (v: boolean) => void
  setShowFilterModal: (v: boolean) => void
  setShowCalendar: (v: boolean) => void
  setShowActivityModal: (v: boolean) => void
  setShowSettings: (v: boolean) => void
  setShowHelp: (v: boolean) => void
  setNewProjectParentId: (v: string | null) => void
  toggleProjectFavorite: (id: string) => void
  deleteProject: (id: string) => void
  deleteCustomFilter: (id: string) => void
  applyCustomFilter: (filter: CustomFilter | null) => void
  getFavoriteProjects: () => Project[]
  getSubProjects: (parentId: string | null) => Project[]
  getLevelName: (level: number) => string
}

export default function Sidebar({
  sidebarCollapsed,
  setSidebarCollapsed,
  activeView,
  setActiveView,
  currentTimeframe: _currentTimeframe,
  setCurrentTimeframe,
  selectedLabel,
  setSelectedLabel,
  labelFilter: _labelFilter,
  setLabelFilter,
  selectedProjectId,
  setSelectedProjectId,
  todos,
  projects,
  allLabels,
  labelDefinitions,
  customFilters,
  activeCustomFilter,
  karma,
  setShowKarmaModal,
  setShowProjectModal,
  setShowLabelModal,
  setShowFilterModal,
  setShowCalendar,
  setShowActivityModal,
  setShowSettings,
  setShowHelp,
  setNewProjectParentId,
  toggleProjectFavorite,
  deleteProject,
  deleteCustomFilter,
  applyCustomFilter,
  getFavoriteProjects,
  getSubProjects,
  getLevelName,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? '展開' : '折りたたむ'}>
          {sidebarCollapsed ? '→' : '←'}
        </button>
        {!sidebarCollapsed && <h1 className="app-logo" onClick={() => { setActiveView('inbox'); setCurrentTimeframe('today'); setSelectedLabel(null); setLabelFilter(null); }} style={{ cursor: 'pointer' }}>Calm Todo</h1>}
      </div>

      {!sidebarCollapsed && (
        <>
          {/* ナビゲーション（固定） */}
          <nav className="sidebar-nav">
            <button className={'nav-item' + (activeView === 'inbox' ? ' active' : '')} onClick={() => { setActiveView('inbox'); setCurrentTimeframe('today'); setSelectedLabel(null); setLabelFilter(null); }}>
              <span className="nav-icon">📥</span>
              <span className="nav-label">タスク</span>
              <span className="nav-count">{todos.filter(t => t.parentId === null && !t.completed).length}</span>
            </button>
          </nav>

          {/* スクロール可能エリア */}
          <div className="sidebar-content">
          {/* お気に入りセクション */}
          {getFavoriteProjects().length > 0 && (
            <div className="sidebar-section">
              <div className="section-header">
                <span className="section-title">⭐ お気に入り</span>
              </div>
              <div className="project-list">
                {getFavoriteProjects().map(project => (
                  <div key={project.id} className={'project-item' + (activeView === 'project' && selectedProjectId === project.id ? ' active' : '')}>
                    <button className="project-item-btn" onClick={() => { setActiveView('project'); setSelectedProjectId(project.id); }}>
                      <span className="project-dot" style={{ backgroundColor: project.color }}></span>
                      <span className="project-name">{project.name}</span>
                      <span className="project-count">{todos.filter(t => t.projectId === project.id && !t.completed).length}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* カルマセクション */}
          <div className="sidebar-section karma-section">
            <button className="karma-display" onClick={() => setShowKarmaModal(true)}>
              <span className="karma-level">Lv.{karma.level}</span>
              <span className="karma-title">{getLevelName(karma.level)}</span>
              <span className="karma-points">{karma.totalPoints}pt</span>
              {karma.streak > 0 && <span className="karma-streak">🔥{karma.streak}</span>}
            </button>
          </div>

          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">プロジェクト</span>
              <button className="section-add" onClick={() => setShowProjectModal(true)} title="プロジェクト追加">+</button>
            </div>
            <div className="project-list">
              {/* ルートプロジェクト（parentId === null）のみ表示、アーカイブ除く */}
              {getSubProjects(null).map(project => (
                <div key={project.id}>
                  <div className={'project-item' + (activeView === 'project' && selectedProjectId === project.id ? ' active' : '')}>
                    <button className="project-item-btn" onClick={() => { setActiveView('project'); setSelectedProjectId(project.id); }}>
                      <span className="project-dot" style={{ backgroundColor: project.color }}></span>
                      <span className="project-name">{project.name}</span>
                      <span className="project-count">{todos.filter(t => t.projectId === project.id && !t.completed).length}</span>
                    </button>
                    <button className="project-fav" onClick={(e) => { e.stopPropagation(); toggleProjectFavorite(project.id); }} title={project.isFavorite ? 'お気に入り解除' : 'お気に入り'}>{project.isFavorite ? '★' : '☆'}</button>
                    <button className="project-sub-add" onClick={(e) => { e.stopPropagation(); setNewProjectParentId(project.id); setShowProjectModal(true); }} title="サブプロジェクト追加">+</button>
                    <button className="project-delete" onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }} title="削除">×</button>
                  </div>
                  {/* サブプロジェクト */}
                  {getSubProjects(project.id).map(subProject => (
                    <div key={subProject.id} className={'project-item sub-project' + (activeView === 'project' && selectedProjectId === subProject.id ? ' active' : '')}>
                      <button className="project-item-btn" onClick={() => { setActiveView('project'); setSelectedProjectId(subProject.id); }}>
                        <span className="project-indent">└</span>
                        <span className="project-dot" style={{ backgroundColor: subProject.color }}></span>
                        <span className="project-name">{subProject.name}</span>
                        <span className="project-count">{todos.filter(t => t.projectId === subProject.id && !t.completed).length}</span>
                      </button>
                      <button className="project-fav" onClick={(e) => { e.stopPropagation(); toggleProjectFavorite(subProject.id); }} title={subProject.isFavorite ? 'お気に入り解除' : 'お気に入り'}>{subProject.isFavorite ? '★' : '☆'}</button>
                      <button className="project-delete" onClick={(e) => { e.stopPropagation(); deleteProject(subProject.id); }} title="削除">×</button>
                    </div>
                  ))}
                </div>
              ))}
              {projects.filter(p => !p.isArchived).length === 0 && (
                <div className="empty-projects">プロジェクトなし</div>
              )}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">ラベル</span>
              <button className="section-add" onClick={() => setShowLabelModal(true)} title="ラベル追加">+</button>
            </div>
            <div className="label-list">
              {allLabels.map(label => {
                const labelDef = labelDefinitions.find(ld => ld.name === label)
                const labelColor = labelDef?.color || '#e07b39'
                return (
                <button key={label} className={'label-item' + (activeView === 'label' && selectedLabel === label ? ' active' : '')} onClick={() => {
                  if (activeView === 'label' && selectedLabel === label) {
                    setActiveView('inbox')
                    setSelectedLabel(null)
                    setLabelFilter(null)
                  } else {
                    setActiveView('label')
                    setSelectedLabel(label)
                    setLabelFilter(label)
                  }
                }}>
                  <span className="label-dot" style={{ backgroundColor: labelColor }}></span>
                  <span className="label-name">{label}</span>
                  <span className="label-count">{todos.filter(t => t.labels.includes(label) && !t.completed && !t.archived).length}</span>
                </button>
                )
              })}
              {allLabels.length === 0 && (
                <div className="empty-labels">ラベルなし</div>
              )}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">フィルター</span>
              <button className="section-add" onClick={() => setShowFilterModal(true)} title="フィルター追加">+</button>
            </div>
            <div className="filter-list">
              {customFilters.map(cf => (
                <div key={cf.id} className={'filter-item' + (activeCustomFilter === cf.id ? ' active' : '')}>
                  <button className="filter-item-btn" onClick={() => applyCustomFilter(cf)}>
                    <span className="filter-icon">⚡</span>
                    <span className="filter-name">{cf.name}</span>
                  </button>
                  <button className="filter-delete" onClick={(e) => { e.stopPropagation(); deleteCustomFilter(cf.id); }} title="削除">×</button>
                </div>
              ))}
            </div>
          </div>

          </div>
          <div className="sidebar-footer">
            <button className="sidebar-btn" onClick={() => setShowCalendar(true)} title="カレンダー">
              <span className="nav-icon">🗓️</span>
              <span className="nav-label">カレンダー</span>
            </button>
            <button className="sidebar-btn" onClick={() => setShowActivityModal(true)} title="アクティビティ">
              <span className="nav-icon">📊</span>
              <span className="nav-label">履歴</span>
            </button>
            <button className="sidebar-btn" onClick={() => setShowSettings(true)} title="設定">
              <span className="nav-icon">⚙️</span>
              <span className="nav-label">設定</span>
            </button>
            <button className="sidebar-btn" onClick={() => setShowHelp(true)} title="ヘルプ">
              <span className="nav-icon">❓</span>
              <span className="nav-label">ヘルプ</span>
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
