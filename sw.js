/* sw.js — simple offline cache for Off Time.
   Cache-first for app shell + content so it works on a car trip with no signal. */

const CACHE = 'offtime-v19';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/theme-doodle.css',
  './css/theme-game.css',
  './js/app.js',
  './js/router.js',
  './js/state.js',
  './js/ui.js',
  './js/audio.js',
  './js/screens/intro.js',
  './js/screens/home.js',
  './js/screens/play.js',
  './js/screens/learn.js',
  './js/screens/read.js',
  './js/screens/memorize.js',
  './js/screens/settings.js',
  './js/games/registry.js',
  './js/games/sliding-puzzle.js',
  './js/games/office-trash.js',
  './js/games/job-site.js',
  './js/games/earth.js',
  './js/games/hexsphere.js',
  './js/games/planet-mesh.js',
  './js/games/planet-worker.js',
  './js/games/continue-gate.js',
  './js/games/puzzles/_shared.js',
  './js/games/puzzles/decode-engine.js',
  './js/games/puzzles/cryptograms.js',
  './js/games/puzzles/crypto-families.js',
  './js/games/puzzles/anagrams.js',
  './js/games/puzzles/brick-by-brick.js',
  './js/games/puzzles/quotefalls.js',
  './data/tasks.js',
  './data/materials.js',
  './data/planet.js',
  './data/facts.js',
  './data/books.js',
  './data/verses.js',
  './data/music.js',
  './data/quotes.js',
  './data/words.js',
  './assets/vendor/three.module.js',
  './assets/img/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Don't cache cross-origin (fonts CDN, Gutenberg links) — just pass through.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
