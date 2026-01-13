import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { startAutoUpdateChecker, handleServiceWorkerUpdate } from './utils/updateChecker'
import { isTauri } from './lib/utils'

// アップデートチェッカーを開始
startAutoUpdateChecker();

// Register Service Worker for offline support (only in web browser, not in Tauri)
if ('serviceWorker' in navigator && !isTauri()) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('[App] Service Worker registered');

      // Service Worker更新時の処理を設定
      handleServiceWorkerUpdate(registration);

      // 定期的に更新をチェック（30分ごと）
      setInterval(() => {
        registration.update();
      }, 30 * 60 * 1000);

    } catch (error) {
      console.error('[App] Service Worker registration failed:', error);
    }
  });
} else if (isTauri()) {
  console.log('[App] Running in Tauri - Service Worker disabled');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
