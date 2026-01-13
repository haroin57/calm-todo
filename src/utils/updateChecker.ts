// アップデート検知とキャッシュクリアユーティリティ

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  storedVersion: string | null;
}

const VERSION_KEY = 'calm-todo-version';
const LAST_UPDATE_CHECK = 'calm-todo-last-update';

// 現在のバージョンを取得（ビルド時に自動更新される）
export const CURRENT_VERSION = '0.2.6';

/**
 * バージョンをチェックして更新があるか確認
 */
export function checkForUpdate(): UpdateInfo {
  const storedVersion = localStorage.getItem(VERSION_KEY);

  return {
    hasUpdate: storedVersion !== null && storedVersion !== CURRENT_VERSION,
    currentVersion: CURRENT_VERSION,
    storedVersion
  };
}

/**
 * アップデート処理を実行（キャッシュクリアとリロード）
 */
export async function performUpdate(): Promise<void> {
  console.log('[UpdateChecker] Performing update...');

  // バージョンを更新
  localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
  localStorage.setItem(LAST_UPDATE_CHECK, new Date().toISOString());

  // Service Workerをアンレジスター
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
      console.log('[UpdateChecker] Service Worker unregistered');
    }
  }

  // すべてのキャッシュをクリア
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    console.log('[UpdateChecker] Clearing caches:', cacheNames);
    await Promise.all(
      cacheNames.map(cacheName => {
        console.log(`[UpdateChecker] Deleting cache: ${cacheName}`);
        return caches.delete(cacheName);
      })
    );
  }

  // Session Storageもクリア（念のため）
  sessionStorage.clear();

  console.log('[UpdateChecker] Update complete, reloading...');

  // ハードリロード
  window.location.reload();
}

/**
 * 自動アップデートチェッカーを開始
 */
export function startAutoUpdateChecker(): void {
  // 初回チェック
  const updateInfo = checkForUpdate();

  if (updateInfo.hasUpdate) {
    console.log(`[UpdateChecker] Update available: ${updateInfo.storedVersion} → ${updateInfo.currentVersion}`);

    // 自動でアップデート実行（ユーザーの作業を妨げないように）
    setTimeout(() => {
      performUpdate();
    }, 1000);
  } else if (updateInfo.storedVersion === null) {
    // 初回起動時
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    console.log('[UpdateChecker] First run, version set to:', CURRENT_VERSION);
  }
}

/**
 * Service Worker更新時の処理
 */
export function handleServiceWorkerUpdate(registration: ServiceWorkerRegistration): void {
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;

    if (newWorker) {
      console.log('[UpdateChecker] New Service Worker found');

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          console.log('[UpdateChecker] New Service Worker activated');

          // 自動的にページをリロード（ユーザー確認なし）
          setTimeout(() => {
            window.location.reload();
          }, 500);
        }
      });
    }
  });
}

/**
 * ブラウザキャッシュを強制クリア
 */
export async function forceClearBrowserCache(): Promise<void> {
  console.log('[UpdateChecker] Force clearing browser cache...');

  try {
    // Service Workerの全削除
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }

    // Cache APIの全削除
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }

    // Local StorageとSession Storageのクリア（設定は保持）
    const settings = localStorage.getItem('calmTodoSettings');
    const todos = localStorage.getItem('calmTodoTasks');
    localStorage.clear();
    sessionStorage.clear();

    // 設定とタスクは復元
    if (settings) localStorage.setItem('calmTodoSettings', settings);
    if (todos) localStorage.setItem('calmTodoTasks', todos);

    // バージョン情報を再設定
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);

    console.log('[UpdateChecker] Cache cleared successfully');
  } catch (error) {
    console.error('[UpdateChecker] Failed to clear cache:', error);
  }
}