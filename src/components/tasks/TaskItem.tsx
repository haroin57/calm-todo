import { useState, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { format, isToday, isTomorrow, isPast, startOfDay } from 'date-fns'
import { useAuthStore } from '@/stores/authStore'
import { useTaskStore } from '@/stores/taskStore'
import { Task, Priority } from '@/types'
import { Checkbox } from '@/components/ui/Checkbox'
import { CompletionParticles } from '@/components/ui/CompletionParticles'
import { MoreIcon, SparklesIcon } from '@/components/icons'
import styles from './TaskItem.module.css'

interface TaskItemProps {
  task: Task
}

export function TaskItem({ task }: TaskItemProps) {
  const { user } = useAuthStore()
  const { toggleTaskStatus, getSubtasks } = useTaskStore()
  const [showParticles, setShowParticles] = useState(false)
  const checkboxRef = useRef<HTMLDivElement>(null)

  const subtasks = getSubtasks(task.id)
  const completedSubtasks = subtasks.filter((t) => t.status === 'completed')

  const handleToggle = async () => {
    if (!user) return

    if (task.status === 'pending') {
      setShowParticles(true)
      setTimeout(() => setShowParticles(false), 500)
    }

    await toggleTaskStatus(user.uid, task.id)
  }

  const formatDueDate = () => {
    if (!task.dueDate) return null

    const date = task.dueDate.toDate()

    if (isToday(date)) {
      return format(date, 'HH:mm')
    }

    if (isTomorrow(date)) {
      return 'Tomorrow'
    }

    if (isPast(startOfDay(date)) && task.status === 'pending') {
      return `overdue · was ${format(date, 'MMM d')}`
    }

    return format(date, 'MMM d')
  }

  const getPriorityColor = (priority: Priority): string => {
    switch (priority) {
      case 'high':
        return 'var(--priority-high)'
      case 'medium':
        return 'var(--priority-mid)'
      case 'low':
        return 'var(--priority-low)'
    }
  }

  const isOverdue = () => {
    if (!task.dueDate || task.status === 'completed') return false
    return isPast(startOfDay(task.dueDate.toDate()))
  }

  return (
    <div
      className={`${styles.item} ${task.status === 'completed' ? styles.completed : ''}`}
      style={{ '--priority-color': getPriorityColor(task.priority) } as React.CSSProperties}
    >
      {/* Priority indicator */}
      <div className={styles.priorityBar} />

      {/* Checkbox */}
      <div ref={checkboxRef} className={styles.checkboxWrapper}>
        <Checkbox
          checked={task.status === 'completed'}
          onChange={handleToggle}
        />
        <AnimatePresence>
          {showParticles && (
            <CompletionParticles />
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className={styles.content}>
        <span className={styles.title}>{task.title}</span>

        <div className={styles.meta}>
          {/* Due date */}
          {task.dueDate && (
            <span className={`${styles.dueDate} ${isOverdue() ? styles.overdue : ''}`}>
              {formatDueDate()}
            </span>
          )}

          {/* Priority label */}
          <span className={styles.priority}>{task.priority}</span>

          {/* Tags */}
          {task.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              #{tag}
            </span>
          ))}

          {/* Subtask count */}
          {subtasks.length > 0 && (
            <span className={styles.subtaskCount}>
              {completedSubtasks.length}/{subtasks.length}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button className={styles.actionButton} title="AI Decompose">
          <SparklesIcon />
        </button>
        <button className={styles.actionButton} title="More options">
          <MoreIcon />
        </button>
      </div>
    </div>
  )
}
