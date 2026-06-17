/* router.js — tiny hash router. Maps #/path -> screen render function.
   Screens are async functions that return a DOM element to mount into #app. */

const routes = [];
let appEl = null;
let notFound = null;
let current = null;
let afterRender = null;

/**
 * register('/play/:id', renderFn)  — :param segments are captured into params.
 */
export function register(pattern, render) {
  const keys = [];
  const rx = new RegExp(
    '^' +
      pattern
        .replace(/\/+$/, '')
        .replace(/:[^/]+/g, (m) => {
          keys.push(m.slice(1));
          return '([^/]+)';
        }) +
      '/?$'
  );
  routes.push({ rx, keys, render });
}

export function setNotFound(render) {
  notFound = render;
}

/** Called with the path string after each successful render (e.g. to drive music). */
export function setAfterRender(fn) {
  afterRender = fn;
}

export function start(mountEl) {
  appEl = mountEl;
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.replace('#/');
  else resolve();
}

export function go(path) {
  if (location.hash === '#' + path) resolve();
  else location.hash = path;
}

export function back() {
  history.back();
}

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path] = raw.split('?');
  return path;
}

async function resolve() {
  const path = parse();
  let match = null;
  for (const r of routes) {
    const m = r.rx.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      match = { render: r.render, params };
      break;
    }
  }

  // Let the previous screen clean up (games unbind listeners, etc.)
  if (current && typeof current.destroy === 'function') {
    try { current.destroy(); } catch {}
  }
  current = null;

  const render = match ? match.render : notFound;
  if (!render) return;

  const result = await render(match ? match.params : {});
  const el = result && result.el ? result.el : result;
  if (result && result.el) current = result; // screen exposed a destroy hook

  appEl.innerHTML = '';
  if (el) appEl.appendChild(el);
  appEl.scrollTop = 0;
  window.scrollTo(0, 0);

  if (afterRender) { try { afterRender(path); } catch {} }
}
