// Version tracking - アップデート時はここを変更
const APP_VERSION = '0.2.6';
const CACHE_NAME = `calm-todo-v${APP_VERSION}`;
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log(`[ServiceWorker ${APP_VERSION}] Installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // 新しいバージョンがインストールされたら即座に有効化
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log(`[ServiceWorker ${APP_VERSION}] Activating...`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // 異なるバージョンのキャッシュをすべて削除
            return name.startsWith('calm-todo-v') && name !== CACHE_NAME;
          })
          .map((name) => {
            console.log(`[ServiceWorker ${APP_VERSION}] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log(`[ServiceWorker ${APP_VERSION}] Claiming all clients`);
      // すべてのクライアントを即座に新しいSWで管理
      return self.clients.claim();
    })
  );
});

// Message event - handle version updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log(`[ServiceWorker ${APP_VERSION}] Received SKIP_WAITING`);
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log(`[ServiceWorker ${APP_VERSION}] Clearing all caches`);
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            console.log(`[ServiceWorker ${APP_VERSION}] Deleting cache: ${cacheName}`);
            return caches.delete(cacheName);
          })
        );
      }).then(() => {
        event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
      })
    );
  }
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // キャッシュ制御 - アセットによって動作を変える
      const url = new URL(event.request.url);

      // 開発環境では常にネットワークから取得
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return fetch(event.request);
      }

      // バージョンパラメータがある場合は常に最新を取得
      if (url.search.includes('v=')) {
        return fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        }).catch(() => cachedResponse || new Response('Offline', { status: 503 }));
      }

      if (cachedResponse) {
        // キャッシュがあるが、バックグラウンドで更新を試みる
        fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Fetch from network and cache the response
      return fetch(event.request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // If fetch fails (offline), return a fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
