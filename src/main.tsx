import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { startAutoUpdateChecker, handleServiceWorkerUpdate } from './utils/updateChecker'
import { isTauri } from './lib/utils'

// アップデートチェッカーを開始
startAutoUpdateChecker();

// Service Worker の処理
if ('serviceWorker' in navigator) {
  if (isTauri()) {
    // Tauri環境: 既存のService Workerを全て解除してキャッシュもクリア
    window.addEventListener('load', async () => {
      try {
        let needsReload = false;

        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
          console.log('[App] Unregistered Service Worker in Tauri');
          needsReload = true;
        }
        // キャッシュも全てクリア
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
          console.log(`[App] Deleted cache: ${cacheName}`);
          needsReload = true;
        }
        console.log('[App] Running in Tauri - All Service Workers unregistered');

        // Service WorkerやキャッシュがあったらReload
        if (needsReload) {
          console.log('[App] Reloading to apply clean state...');
          window.location.reload();
        }
      } catch (error) {
        console.error('[App] Failed to unregister Service Workers:', error);
      }
    });
  } else {
    // ブラウザ環境: Service Workerを登録
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
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
