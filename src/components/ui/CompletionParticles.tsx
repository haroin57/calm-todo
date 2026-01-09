import { motion } from 'framer-motion'
import styles from './CompletionParticles.module.css'

export function CompletionParticles() {
  const particles = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2
    const distance = 20 + Math.random() * 10
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
    }
  })

  return (
    <div className={styles.container}>
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className={styles.particle}
          initial={{ scale: 1, x: 0, y: 0, opacity: 1 }}
          animate={{
            scale: 0,
            x: particle.x,
            y: particle.y,
            opacity: 0,
          }}
          transition={{
            duration: 0.4,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      ))}
    </div>
  )
}
