import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { SearchIcon, SettingsIcon, LogoutIcon } from '@/components/icons'
import { CommandPalette } from '@/components/ui/CommandPalette'
import styles from './Header.module.css'

export function Header() {
  const { user, signOut } = useAuthStore()
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setShowCommandPalette(true)
    }
  }

  return (
    <>
      <header className={styles.header} onKeyDown={handleKeyDown}>
        <button
          className={styles.searchButton}
          onClick={() => setShowCommandPalette(true)}
          aria-label="Search (Ctrl+K)"
        >
          <SearchIcon className={styles.searchIcon} />
          <span className={styles.searchText}>Search...</span>
          <kbd className={styles.shortcut}>Ctrl K</kbd>
        </button>

        <div className={styles.actions}>
          <button className={styles.iconButton} aria-label="Settings">
            <SettingsIcon />
          </button>

          <div className={styles.userMenu}>
            {user?.photoURL && (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className={styles.avatar}
              />
            )}
            <button
              className={styles.iconButton}
              onClick={() => signOut()}
              aria-label="Sign out"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </header>

      {showCommandPalette && (
        <CommandPalette onClose={() => setShowCommandPalette(false)} />
      )}
    </>
  )
}
