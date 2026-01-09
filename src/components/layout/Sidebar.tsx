import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useProjectStore } from '@/stores/projectStore'
import { useTaskStore } from '@/stores/taskStore'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { WeeklyHeatmap } from '@/components/ui/WeeklyHeatmap'
import {
  InboxIcon,
  FolderIcon,
  PlusIcon,
  FocusIcon,
} from '@/components/icons'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const location = useLocation()
  const { projects, createProject } = useProjectStore()
  const { getTodayStats, getStreak } = useTaskStore()

  const activeProjects = projects.filter((p) => !p.isArchived)
  const todayStats = getTodayStats()
  const streak = getStreak()

  const handleAddProject = () => {
    const name = prompt('New project name:')
    if (name?.trim()) {
      createProject({ name: name.trim() })
    }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.content}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
              <rect
                x="8"
                y="8"
                width="32"
                height="32"
                rx="8"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M16 24L22 30L32 18"
                stroke="var(--amber-glow)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className={styles.logoText}>Calm Todo</span>
        </div>

        {/* Today's Progress */}
        <div className={styles.progressSection}>
          <ProgressRing
            completed={todayStats.completed}
            total={todayStats.total}
          />
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          <NavLink
            to="/"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive && location.pathname === '/' ? styles.active : ''}`
            }
          >
            <InboxIcon className={styles.navIcon} />
            <span>Inbox</span>
          </NavLink>

          <NavLink
            to="/focus"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <FocusIcon className={styles.navIcon} />
            <span>Focus</span>
          </NavLink>
        </nav>

        {/* Projects */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Projects</h3>
            <button
              className={styles.addButton}
              onClick={handleAddProject}
              aria-label="Add project"
            >
              <PlusIcon />
            </button>
          </div>

          <div className={styles.projectList}>
            {activeProjects.map((project) => (
              <NavLink
                key={project.id}
                to={`/project/${project.id}`}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.active : ''}`
                }
              >
                <FolderIcon
                  className={styles.navIcon}
                  style={{ color: project.color || 'var(--text-tertiary)' }}
                />
                <span>{project.name}</span>
              </NavLink>
            ))}

            {activeProjects.length === 0 && (
              <p className={styles.emptyText}>No projects yet</p>
            )}
          </div>
        </div>

        {/* Bottom section */}
        <div className={styles.bottomSection}>
          <WeeklyHeatmap />

          {streak > 0 && (
            <motion.div
              className={styles.streak}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <span className={styles.streakIcon}>◇</span>
              <span>{streak} day streak</span>
            </motion.div>
          )}
        </div>
      </div>
    </aside>
  )
}
