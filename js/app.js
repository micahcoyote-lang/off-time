/* app.js — boot: register service worker, apply settings, wire routes, start router. */

import { register, setNotFound, setAfterRender, start, go } from './router.js';
import { state, applyDerived } from './state.js';
import * as audio from './audio.js';

import { renderIntro } from './screens/intro.js';
import { renderHome } from './screens/home.js';
import { renderPlay } from './screens/play.js';
import { renderLearn } from './screens/learn.js';
import { renderRead } from './screens/read.js';
import { renderMemorize } from './screens/memorize.js';
import { renderSettings } from './screens/settings.js';
import { renderTask } from './games/registry.js';

// Apply persisted settings (text size) before first paint.
applyDerived();

// Routes
register('/', () => {
  // First-run: show intro; afterwards go straight to Home.
  if (!state.get('introSeen', false)) return renderIntro();
  return renderHome();
});
register('/intro', () => renderIntro());
register('/home', () => renderHome());
register('/play', () => renderPlay());
register('/play/:id', (params) => renderTask(params.id));
register('/learn', () => renderLearn());
register('/read', () => renderRead());
register('/memorize', () => renderMemorize());
register('/settings', () => renderSettings());

setNotFound(() => renderHome());

// Drive background music from the route, and arm the autoplay unlock.
setAfterRender((path) => audio.updateForRoute(path));
audio.initUnlock();

start(document.getElementById('app'));

// Make the router reachable from inline handlers if ever needed.
window.OffTime = { go };

// PWA service worker (best-effort; ignored when opened via file://).
// Skip on localhost so local edits aren't masked by the cache-first cache.
const isLocalDev = ['localhost', '127.0.0.1', ''].includes(location.hostname);
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isLocalDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
