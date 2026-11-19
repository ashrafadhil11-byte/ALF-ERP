// File: sw.js — makes the ERP installable and keeps the app shell available offline.
// API calls (/api/*) are never cached: data is always live.
const VERSION = 'alf-erp-v8';
// The React app (/app/…) is cached as it is used: its files have content hashes, so a new release never mixes with an old one.
const SHELL = [
    '/offline.html',
    '/pwa.js',
    '/icons/icon-192.png',
    '/assets/LOGO%20BG%20W.svg',
    '/assets/LOGO%20BG%20B.svg'
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

    // Pages, scripts and styles: network first, so an update is live on the next load.
    // The cached copy (or the offline page) is used only when there is no connection.
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(VERSION).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error())))
    );
});

// A message notification (shown by the app, lib/alerts.ts): clicking it opens that chat in an open ERP tab, or a new one.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/app/messages';
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
        const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
        if (tab) return tab.focus().then((t) => (t && 'navigate' in t ? t.navigate(url) : null)).catch(() => self.clients.openWindow(url));
        return self.clients.openWindow(url);
    }));
});
