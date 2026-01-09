import { Sidebar } from './Sidebar'
import { Header } from './Header'
import styles from './MainLayout.module.css'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <div className={styles.mainArea}>
        <Header />
        <main className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  )
}
