import { useTaskStore } from '@/stores/taskStore'
import styles from './WeeklyHeatmap.module.css'

export function WeeklyHeatmap() {
  const { getWeeklyActivity } = useTaskStore()
  const activity = getWeeklyActivity()

  const getIntensity = (count: number): number => {
    if (count === 0) return 0
    if (count <= 2) return 1
    if (count <= 4) return 2
    return 3
  }

  return (
    <div className={styles.container}>
      <div className={styles.days}>
        {activity.map((day, index) => (
          <div key={index} className={styles.day}>
            <span className={styles.label}>{day.date}</span>
            <div
              className={styles.cell}
              data-intensity={getIntensity(day.count)}
              title={`${day.count} tasks completed`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
