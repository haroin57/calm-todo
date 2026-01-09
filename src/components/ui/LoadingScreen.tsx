import { motion } from 'framer-motion'
import styles from './LoadingScreen.module.css'

export function LoadingScreen() {
  return (
    <div className={styles.container}>
      <motion.div
        className={styles.content}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className={styles.logoIcon}>
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
            <rect
              x="8"
              y="8"
              width="32"
              height="32"
              rx="8"
              stroke="currentColor"
              strokeWidth="2"
            />
            <motion.path
              d="M16 24L22 30L32 18"
              stroke="var(--amber-glow)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
            />
          </svg>
        </div>
        <div className={styles.loader}>
          <motion.div
            className={styles.bar}
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 1.5, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>
      </motion.div>
    </div>
  )
}
