const CACHE_NAME = 'sistema-ventas-pwa-v2436';
const IMAGE_CACHE_NAME = 'sistema-ventas-images-v2436';
const SCRIPT_CACHE_NAME = 'sistema-ventas-scripts-v2436';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/404.html',
  '/auth.js',
  '/ticket.css',
  '/ticket.js',
  '/html2canvas.min.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// Dominios de API y Backend que NO deben ser cacheados por SW (manejados por SDK / Firestore offline)
const DOMINIOS_EXCLUIDOS_SW = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'apis.google.com'
];

// 1. Instalación: Precachear recursos estáticos y tomar control inmediato
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => {
              if (res.ok || res.type === 'opaque') {
                return cache.put(url, res);
              }
            })
            .catch((err) => {
              console.warn(`[SW] Precache diferido para ${url}:`, err);
            })
        )
      );
    })
  );
});

// 2. Activación: Limpiar todas las cachés antiguas y tomar control inmediato
self.addEventListener('activate', (event) => {
  const cachePermitidos = [CACHE_NAME, IMAGE_CACHE_NAME, SCRIPT_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !cachePermitidos.includes(name))
          .map((name) => {
            console.log(`[SW] Eliminando caché obsoleta: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(async () => {
      await self.clients.claim();
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clientsList) {
        client.postMessage({
          tipo: 'VERSION_ACTUALIZADA_SW',
          version: CACHE_NAME
        });
      }
    })
  );
});

// 3. Intercepción: Network-First para navegación y recursos para actualización inmediata + Offline Fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Manejo senior y resiliente para endpoints de API (Catálogo y Versión)
  // Estrategia: Network-First con fallback a Caché de API Offline (evita 'Failed to fetch' al estar offline)
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/productos' || url.pathname === '/api/version' || url.pathname.startsWith('/api/ventas')) {
      event.respondWith(
        (async () => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            const netResp = await fetch(req, { signal: controller.signal, cache: 'no-cache' });
            clearTimeout(timer);
            if (netResp && netResp.ok) {
              const cache = await caches.open(CACHE_NAME);
              cache.put(req, netResp.clone()).catch(() => {});
              return netResp;
            }
          } catch (netErr) {
            // Falla de red, timeout o modo offline
          }
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req, { ignoreSearch: true });
          if (cached) return cached;

          if (url.pathname === '/api/productos') {
            return new Response(JSON.stringify({ ok: true, version: 1, total: 0, productos: [], offline: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          if (url.pathname.startsWith('/api/ventas')) {
            return new Response(JSON.stringify({ ok: true, offline: true, ventas: [], total: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({ ok: true, offline: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        })()
      );
      return;
    }
    return;
  }

  if (DOMINIOS_EXCLUIDOS_SW.some((dominio) => url.hostname.includes(dominio))) {
    return;
  }

  // A. Peticiones de Navegación (HTML): Network-First para cargar siempre la última versión online, con fallback a caché offline
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(req, { cache: 'no-store' });
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResponse.clone()).catch(() => {});
            cache.put(url.pathname, networkResponse.clone()).catch(() => {});
            return networkResponse;
          }
        } catch (netErr) {
          // Sin conexión a Internet: usar caché
        }

        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(req, { ignoreSearch: true })) ||
                       (await cache.match(url.pathname, { ignoreSearch: true }));
        if (cached) return cached;

        if (url.pathname.includes('admin')) {
          return (await cache.match('/admin.html', { ignoreSearch: true })) ||
                 (await caches.match('/admin.html', { ignoreSearch: true }));
        }
        return (await cache.match('/index.html', { ignoreSearch: true })) ||
               (await caches.match('/index.html', { ignoreSearch: true }));
      })()
    );
    return;
  }

  // B. Scripts y Estilos locales y CDN: Network-First para actualización automática inmediata con fallback a caché
  const esScriptOEstilo =
    req.destination === 'script' ||
    req.destination === 'style' ||
    /\.(js|css)($|\?)/i.test(url.pathname) ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com');

  if (esScriptOEstilo) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(req, { cache: 'no-cache' });
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            notificarExitoRedAClientes();
            const cacheScripts = await caches.open(SCRIPT_CACHE_NAME);
            cacheScripts.put(req, networkResponse.clone()).catch(() => {});
            if (url.origin === self.location.origin) {
              cacheScripts.put(url.pathname, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          }
        } catch (netErr) {
          // Conexión lenta o intermitente: servir desde caché de inmediato para no demorar la carga
        }

        const cacheScripts = await caches.open(SCRIPT_CACHE_NAME);
        const cached = (await cacheScripts.match(req, { ignoreSearch: true })) ||
                       (await caches.match(req, { ignoreSearch: true })) ||
                       (await cacheScripts.match(url.pathname, { ignoreSearch: true })) ||
                       (await caches.match(url.pathname, { ignoreSearch: true }));

        if (cached) return cached;

        return (await cacheScripts.match(url.pathname, { ignoreSearch: true })) ||
               (await caches.match(url.pathname, { ignoreSearch: true }));
      })()
    );
    return;
  }

  // C. Imágenes: Stale-While-Revalidate
  const esImagen =
    req.destination === 'image' ||
    /\.(png|jpg|jpeg|webp|svg|gif|avif)($|\?)/i.test(url.pathname) ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('storage.googleapis.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('ui-avatars.com');

  if (esImagen) {
    event.respondWith(
      (async () => {
        const cacheImages = await caches.open(IMAGE_CACHE_NAME);
        const cached = await cacheImages.match(req, { ignoreSearch: false });

        const fetchPromise = fetch(req)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              cacheImages.put(req, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          fetchPromise.catch(() => {});
          return cached;
        }

        const netRes = await fetchPromise;
        if (netRes) return netRes;

        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#94a3b8">📦</text></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        );
      })()
    );
    return;
  }

  // D. Resto de recursos estáticos del mismo origen: Network-First con fallback a Caché
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(req);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResponse.clone()).catch(() => {});
            cache.put(url.pathname, networkResponse.clone()).catch(() => {});
            return networkResponse;
          }
        } catch (netErr) {}

        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(req, { ignoreSearch: true })) ||
                       (await cache.match(url.pathname, { ignoreSearch: true }));
        if (cached) return cached;

        return (await cache.match(url.pathname, { ignoreSearch: true })) ||
               (await caches.match(url.pathname, { ignoreSearch: true }));
      })()
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  } else if (event.data?.action === 'REINTENTAR_CONEXION_SW') {
    fallosDeRedConsecutivos = 0;
  }
});

