import { motion, AnimatePresence } from 'framer-motion'
import { Task } from '@/types'
import { TaskItem } from './TaskItem'
import styles from './TaskList.module.css'

interface TaskListProps {
  tasks: Task[]
}

export function TaskList({ tasks }: TaskListProps) {
  return (
    <div className={styles.list}>
      <AnimatePresence mode="popLayout">
        {tasks.map((task, index) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 20, height: 0, marginBottom: 0 }}
            transition={{
              duration: 0.25,
              delay: index * 0.03,
              ease: [0.16, 1, 0.3, 1],
            }}
            layout
          >
            <TaskItem task={task} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
