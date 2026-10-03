// Bump this number whenever you want to force every device to drop its old cache.
const CACHE_NAME = 'safecampus-cache-v5';
// Relative paths so it works from a sub-folder like zarcheus.github.io/safecampus/
const ASSETS_TO_CACHE = ['./', './index.html', './manifest.json', './logo.png', './cover.png'];
const PAGE_TIMEOUT_MS = 4000; // on slow signal, fall back to the saved page after 4s

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' skips the browser's HTTP cache so we never save a stale copy
      // one missing file must not break the whole install, so add them individually
      .then((cache) => Promise.allSettled(ASSETS_TO_CACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()) // new version takes over right away
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function saveCopy(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((c) => c.put(request, copy));
  }
}

// Pages: network first (so updates reach everyone), saved copy when offline or very slow.
function networkFirst(request) {
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) resolve(cached);
    }, PAGE_TIMEOUT_MS);

    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        saveCopy(request, res);
        resolve(res);
      })
      .catch(async () => {
        clearTimeout(timer);
        const cached = (await caches.match(request, { ignoreSearch: true })) || (await caches.match('./index.html'));
        resolve(cached || Response.error());
      });
  });
}

// Same-site files (manifest, icons): show the saved one instantly, refresh it in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => { saveCopy(request, res); return res; })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

// Versioned Firebase scripts never change, so keep them for true offline use.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  saveCopy(request, res);
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
  } else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(req));
  }
  // Everything else (Firestore live data, etc.) goes straight to the network untouched.
});
