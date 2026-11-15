// File: sw.js — makes the ERP installable and keeps the app shell available offline.
// API calls (/api/*) are never cached: data is always live.
const VERSION = 'alf-erp-v2';
const SHELL = [
    '/offline.html',
    '/admin/components/ui.css',
    '/admin/components/ui.js',
    '/admin/components/sidebar.js',
    '/admin/components/topbar.js',
    '/pwa.js',
    '/icons/icon-192.png',
    '/assets/LOGO%20BG%20W.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

    // Pages: network first (always fresh), cached copy or offline page when there's no connection.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(VERSION).then((c) => c.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline.html')))
        );
        return;
    }

    // Static files: serve cached copy immediately, refresh it in the background.
    event.respondWith(
        caches.match(req).then((hit) => {
            const network = fetch(req)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(VERSION).then((c) => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() => hit);
            return hit || network;
        })
    );
});
