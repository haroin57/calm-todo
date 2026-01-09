import { motion } from 'framer-motion'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  type: 'no-tasks' | 'focus-done' | 'project-empty'
  completedCount?: number
}

export function EmptyState({ type, completedCount = 0 }: EmptyStateProps) {
  const getContent = () => {
    switch (type) {
      case 'focus-done':
        return {
          icon: (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle
                cx="24"
                cy="24"
                r="20"
                stroke="var(--amber-glow)"
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
          ),
          title: 'Done for today',
          subtitle: completedCount > 0 ? `${completedCount} tasks completed` : null,
        }
      case 'no-tasks':
        return {
          icon: (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M24 8v32M8 24h32"
                stroke="var(--text-tertiary)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ),
          title: 'No tasks yet',
          subtitle: "Press 'n' to add one",
        }
      case 'project-empty':
        return {
          icon: (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect
                x="8"
                y="12"
                width="32"
                height="24"
                rx="4"
                stroke="var(--text-tertiary)"
                strokeWidth="2"
              />
              <path
                d="M8 18h32"
                stroke="var(--text-tertiary)"
                strokeWidth="2"
              />
            </svg>
          ),
          title: 'Project is empty',
          subtitle: 'Add tasks to get started',
        }
    }
  }

  const content = getContent()

  return (
    <motion.div
      className={styles.container}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.icon}>{content.icon}</div>
      <h3 className={styles.title}>{content.title}</h3>
      {content.subtitle && (
        <p className={styles.subtitle}>{content.subtitle}</p>
      )}
    </motion.div>
  )
}
