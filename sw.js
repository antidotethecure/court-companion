/* Offline cache: app shell + all JSON data. Network-first for data so fresh source updates win when online. */
const V = "cc-v3-3";
const CORE = ["./","index.html","css/app.css","js/icons.js","js/app.js","js/toolkit.js","js/i18n.js","manifest.webmanifest","icons/icon.svg","icons/icon-192.png",
  "data/guardrails.json","data/states/ca/state.json","data/states/ca/counties/los-angeles.json","data/states/ca/counties/orange.json",
  "data/federal/cacd.json","data/guides/ca.json","data/brain/library.json","data/demo/jordan-reyes.json","data/demo/brand-golden-gate.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  e.respondWith(fetch(r).then(res => { if (res.ok && (new URL(r.url).origin === location.origin || /fonts\.(googleapis|gstatic)/.test(r.url))) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, {ignoreSearch: true}).then(m => m || caches.match("index.html"))));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.openWindow("./#tasks")); });
