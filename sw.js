// ================================================
// SERVICE WORKER - PATROL SECURITY
// ================================================
const CACHE_NAME   = 'patrol-v1';
const SYNC_TAG     = 'sync-patrol';

// Asset yang di-cache untuk offline
const CACHE_ASSETS = [
  './',
  './patrol-form.html',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// ===== INSTALL — cache semua assets =====
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(CACHE_ASSETS.map(url => new Request(url, { mode: 'no-cors' })))
        .catch(() => {}) // skip kalau ada yang gagal
    )
  );
});

// ===== ACTIVATE — hapus cache lama =====
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH — serve from cache, fallback to network =====
self.addEventListener('fetch', e => {
  // Jangan intercept request ke Apps Script (POST)
  if (e.request.method === 'POST') return;
  if (e.request.url.includes('script.google.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache response baru yang valid
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});

// ===== BACKGROUND SYNC — kirim antrian saat online =====
self.addEventListener('sync', e => {
  if (e.tag === SYNC_TAG || e.tag === 'sync-track') {
    e.waitUntil(flushQueue(e.tag));
  }
});

async function flushQueue(tag) {
  const db      = await openDB();
  const store   = tag === 'sync-track' ? 'trackQueue' : 'reportQueue';
  const pending = await getAllItems(db, store);

  for (const item of pending) {
    try {
      await fetch('https://script.google.com/macros/s/AKfycbx9gEPXcWDPX-9XylwQlk9Hah0vnQeu6pp4L6inTaklMdgkUj3_Xd2boxVUAQ-Y4YUt2Q/exec', {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.data)
      });
      await deleteItem(db, store, item.id);
    } catch (err) {
      // Gagal — biarkan di queue, dicoba lagi nanti
      break;
    }
  }
}

// ===== IndexedDB helpers =====
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('PatrolDB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('reportQueue'))
        db.createObjectStore('reportQueue', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('trackQueue'))
        db.createObjectStore('trackQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

function getAllItems(db, store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function deleteItem(db, store, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ===== PUSH — notifikasi (opsional) =====
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
