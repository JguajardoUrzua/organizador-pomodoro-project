// Service worker: keeps the app working without internet.
// When you publish a new version, change VERSION so browsers pick up the new files.
const VERSION = "v13";
const CACHE = "tareas-" + VERSION;
const FILES = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "manifest.webmanifest",
  "icons/favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "img/fondos/bosque-rio.jpg",
  "img/fondos/ciudad-pixel.jpg",
  "img/fondos/lago-bosque.jpg",
  "img/fondos/lago-nevado.jpg",
  "img/fondos/montana-retro.jpg",
  "img/fondos/playa-aerea.jpg"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("tareas-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// task alerts: clicking the notification brings the app to the front
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // the page itself: try the network first so updates show up, fall back to the saved copy offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("index.html", c)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // our own files: saved copy first
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })));
    return;
  }
  // Google Fonts: use the saved copy and refresh it in the background
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
  }
});
