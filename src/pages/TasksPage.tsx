import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { useTaskStore } from '@/stores/taskStore'
import { useProjectStore } from '@/stores/projectStore'
import { TaskList } from '@/components/tasks/TaskList'
import { TaskInput } from '@/components/tasks/TaskInput'
import { EmptyState } from '@/components/ui/EmptyState'
import styles from './TasksPage.module.css'

interface TasksPageProps {
  focusMode?: boolean
}

export function TasksPage({ focusMode = false }: TasksPageProps) {
  const { projectId } = useParams()
  const { user } = useAuthStore()
  const { tasks, loading, subscribeToTasks, getTodayTasks, getTasksByProject } = useTaskStore()
  const { subscribeToProjects, getProjectById } = useProjectStore()

  // Subscribe to data
  useEffect(() => {
    if (!user) return

    const unsubscribeTasks = subscribeToTasks(user.uid)
    const unsubscribeProjects = subscribeToProjects(user.uid)

    return () => {
      unsubscribeTasks()
      unsubscribeProjects()
    }
  }, [user])

  // Get filtered tasks
  const filteredTasks = focusMode
    ? getTodayTasks()
    : projectId
      ? getTasksByProject(projectId)
      : tasks.filter((t) => t.projectId === 'inbox' && !t.parentId)

  // Group tasks by status
  const pendingTasks = filteredTasks.filter((t) => t.status === 'pending')
  const completedTasks = filteredTasks.filter((t) => t.status === 'completed')

  // Get page title
  const getTitle = () => {
    if (focusMode) return 'Focus'
    if (projectId) {
      const project = getProjectById(projectId)
      return project?.name || 'Project'
    }
    return 'Inbox'
  }

  // Get subtitle
  const getSubtitle = () => {
    if (focusMode) {
      return `${pendingTasks.length} remaining`
    }
    return null
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingBar} />
      </div>
    )
  }

  return (
    <motion.div
      className={`${styles.container} ${focusMode ? styles.focusMode : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>{getTitle()}</h1>
        {getSubtitle() && (
          <span className={styles.subtitle}>{getSubtitle()}</span>
        )}
      </header>

      {/* Task Input */}
      {!focusMode && (
        <TaskInput projectId={projectId || 'inbox'} />
      )}

      {/* Task Lists */}
      {filteredTasks.length === 0 ? (
        <EmptyState
          type={focusMode ? 'focus-done' : 'no-tasks'}
          completedCount={completedTasks.length}
        />
      ) : (
        <div className={styles.lists}>
          {/* Pending Tasks */}
          {pendingTasks.length > 0 && (
            <section className={styles.section}>
              {!focusMode && (
                <h2 className={styles.sectionTitle}>
                  {focusMode ? 'Today' : 'Tasks'}
                </h2>
              )}
              <TaskList tasks={pendingTasks} />
            </section>
          )}

          {/* Completed Tasks */}
          {!focusMode && completedTasks.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                Completed
                <span className={styles.count}>{completedTasks.length}</span>
              </h2>
              <TaskList tasks={completedTasks} />
            </section>
          )}
        </div>
      )}

      {/* Focus mode hint */}
      {focusMode && (
        <p className={styles.hint}>
          <kbd>esc</kbd> to exit
        </p>
      )}
    </motion.div>
  )
}
