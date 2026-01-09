import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { GoogleIcon } from '@/components/icons/GoogleIcon'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const { signInWithGoogle, error } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = async () => {
    setIsLoading(true)
    try {
      await signInWithGoogle()
    } catch {
      // Error is handled in store
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <motion.div
        className={styles.content}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.logo}>
          <motion.div
            className={styles.logoIcon}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
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
          </motion.div>
          <h1 className={styles.title}>Calm Todo</h1>
          <p className={styles.subtitle}>静かに背中を押すタスク管理</p>
        </div>

        <motion.button
          className={styles.googleButton}
          onClick={handleSignIn}
          disabled={isLoading}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {isLoading ? (
            <div className={styles.spinner} />
          ) : (
            <>
              <GoogleIcon className={styles.googleIcon} />
              <span>Continue with Google</span>
            </>
          )}
        </motion.button>

        {error && (
          <motion.p
            className={styles.error}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {error}
          </motion.p>
        )}

        <p className={styles.hint}>
          Sign in to sync your tasks across devices
        </p>
      </motion.div>

      {/* Ambient decoration */}
      <div className={styles.ambientGlow} />
    </div>
  )
}
