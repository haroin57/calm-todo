import { motion } from 'framer-motion'
import styles from './Checkbox.module.css'

interface CheckboxProps {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}

export function Checkbox({ checked, onChange, disabled }: CheckboxProps) {
  return (
    <button
      className={`${styles.checkbox} ${checked ? styles.checked : ''}`}
      onClick={onChange}
      disabled={disabled}
      role="checkbox"
      aria-checked={checked}
    >
      {checked && (
        <motion.svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <motion.path
            d="M5 12l5 5L19 7"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          />
        </motion.svg>
      )}
    </button>
  )
}
