import { motion } from 'framer-motion'
import styles from './ProgressRing.module.css'

interface ProgressRingProps {
  completed: number
  total: number
  size?: number
}

export function ProgressRing({ completed, total, size = 64 }: ProgressRingProps) {
  const progress = total > 0 ? completed / total : 0
  const circumference = 2 * Math.PI * 24 // radius = 24
  const strokeDashoffset = circumference * (1 - progress)

  const isComplete = completed === total && total > 0

  return (
    <div className={styles.container} style={{ width: size, height: size }}>
      <svg className={styles.ring} viewBox="0 0 64 64">
        {/* Background circle */}
        <circle
          className={styles.background}
          cx="32"
          cy="32"
          r="24"
          fill="none"
          strokeWidth="3"
        />
        {/* Progress circle */}
        <motion.circle
          className={styles.progress}
          cx="32"
          cy="32"
          r="24"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{
            transformOrigin: 'center',
            transform: 'rotate(-90deg)',
          }}
        />
      </svg>

      <div className={styles.content}>
        <span className={styles.count}>
          {completed}/{total}
        </span>
      </div>

      {/* Completion pulse effect */}
      {isComplete && (
        <motion.div
          className={styles.completePulse}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.2, opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      )}
    </div>
  )
}
