import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTaskStore } from '@/stores/taskStore'
import { useProjectStore } from '@/stores/projectStore'
import { SearchIcon, FolderIcon, CheckIcon } from '@/components/icons'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  onClose: () => void
}

type SearchResult = {
  type: 'task' | 'project' | 'action'
  id: string
  title: string
  subtitle?: string
  icon?: React.ReactNode
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { tasks } = useTaskStore()
  const { projects } = useProjectStore()

  // Filter results based on query
  const results: SearchResult[] = []

  if (query.trim()) {
    const q = query.toLowerCase()

    // Search tasks
    const matchingTasks = tasks
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 5)
      .map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        subtitle: t.status === 'completed' ? 'Completed' : 'Pending',
        icon: <CheckIcon />,
      }))

    // Search projects
    const matchingProjects = projects
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 3)
      .map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        subtitle: 'Project',
        icon: <FolderIcon style={{ color: p.color }} />,
      }))

    results.push(...matchingTasks, ...matchingProjects)
  } else {
    // Show default actions
    results.push(
      { type: 'action', id: 'focus', title: 'Focus Mode', subtitle: 'Ctrl+F' },
      { type: 'action', id: 'new-task', title: 'New Task', subtitle: 'N' },
      { type: 'action', id: 'inbox', title: 'Go to Inbox', subtitle: '' }
    )
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        handleSelect(results[selectedIndex])
        break
      case 'Escape':
        onClose()
        break
    }
  }

  const handleSelect = (result: SearchResult) => {
    switch (result.type) {
      case 'task':
        // Could open task detail modal
        onClose()
        break
      case 'project':
        navigate(`/project/${result.id}`)
        onClose()
        break
      case 'action':
        if (result.id === 'focus') {
          navigate('/focus')
        } else if (result.id === 'inbox') {
          navigate('/')
        }
        onClose()
        break
    }
  }

  return (
    <AnimatePresence>
      <div className={styles.overlay} onClick={onClose}>
        <motion.div
          className={styles.container}
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.inputWrapper}>
            <SearchIcon className={styles.searchIcon} />
            <input
              ref={inputRef}
              type="text"
              className={styles.input}
              placeholder="Search tasks, projects, or actions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          {results.length > 0 && (
            <div className={styles.results}>
              {results.map((result, index) => (
                <button
                  key={`${result.type}-${result.id}`}
                  className={`${styles.result} ${index === selectedIndex ? styles.selected : ''}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className={styles.resultIcon}>{result.icon}</span>
                  <span className={styles.resultTitle}>{result.title}</span>
                  {result.subtitle && (
                    <span className={styles.resultSubtitle}>{result.subtitle}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {query && results.length === 0 && (
            <div className={styles.empty}>
              <p>No results found</p>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
