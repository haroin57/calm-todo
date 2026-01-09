import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { useTaskStore } from '@/stores/taskStore'
import { PlusIcon } from '@/components/icons'
import styles from './TaskInput.module.css'

interface TaskInputProps {
  projectId: string
}

export function TaskInput({ projectId }: TaskInputProps) {
  const { user } = useAuthStore()
  const { createTask } = useTaskStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !isExpanded) {
        const activeElement = document.activeElement
        const isInputFocused =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement

        if (!isInputFocused) {
          e.preventDefault()
          setIsExpanded(true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isExpanded])

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user || !title.trim()) return

    setIsLoading(true)
    try {
      await createTask(user.uid, {
        title: title.trim(),
        projectId,
      })
      setTitle('')
      // Keep expanded for quick entry of multiple tasks
    } catch (error) {
      console.error('Failed to create task:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsExpanded(false)
      setTitle('')
    }
  }

  const handleBlur = () => {
    if (!title.trim()) {
      setIsExpanded(false)
    }
  }

  return (
    <div className={styles.container}>
      <AnimatePresence mode="wait">
        {isExpanded ? (
          <motion.form
            key="form"
            className={styles.form}
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            <input
              ref={inputRef}
              type="text"
              className={styles.input}
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              disabled={isLoading}
              autoComplete="off"
            />
            <span className={styles.hint}>
              Press <kbd>Enter</kbd> to add
            </span>
          </motion.form>
        ) : (
          <motion.button
            key="button"
            className={styles.addButton}
            onClick={() => setIsExpanded(true)}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
          >
            <PlusIcon className={styles.icon} />
            <span>Add task</span>
            <kbd className={styles.shortcut}>N</kbd>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
