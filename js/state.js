/* state.js — persistent app state via localStorage.
   One namespaced object; helpers read/merge/save so screens never touch storage keys. */

const KEY = 'offtime.state.v1';

const DEFAULTS = {
  introSeen: false,
  settings: {
    sound: true,
    music: true,
    textScale: 1,        // 0.9 | 1 | 1.15
  },
  // Play progress: { [taskId]: { done: true } }
  tasks: {},
  // Memorized verses: { [verseId]: { learnedAt, nextReview, strength } }
  verses: {},
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? deepMerge(clone(DEFAULTS), JSON.parse(raw)) : clone(DEFAULTS);
  } catch {
    cache = clone(DEFAULTS);
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full / unavailable — app still works in-memory this session */
  }
}

function deepMerge(base, extra) {
  for (const k of Object.keys(extra || {})) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) {
      base[k] = deepMerge(base[k] || {}, extra[k]);
    } else {
      base[k] = extra[k];
    }
  }
  return base;
}

export const state = {
  get all() { return load(); },

  get(path, fallback) {
    const parts = path.split('.');
    let cur = load();
    for (const p of parts) {
      if (cur == null) return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  },

  set(path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    let cur = load();
    for (const p of parts) {
      if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
      cur = cur[p];
    }
    cur[last] = value;
    save();
    applyDerived();
  },

  update(path, fn) {
    this.set(path, fn(this.get(path)));
  },

  reset() {
    cache = clone(DEFAULTS);
    save();
    applyDerived();
  },
};

/* Side effects of state that affect the document (e.g. text size). */
export function applyDerived() {
  const scale = state.get('settings.textScale', 1);
  document.documentElement.style.setProperty('--text-scale', String(scale));
}

/* ---- Verse helpers (used by memorize screen + continue gate) ---- */

// ~spaced repetition: each successful review pushes the next one out.
const REVIEW_STEPS_MS = [
  1000 * 60 * 60 * 24 * 1,   // 1 day
  1000 * 60 * 60 * 24 * 3,   // 3 days
  1000 * 60 * 60 * 24 * 7,   // 1 week
  1000 * 60 * 60 * 24 * 21,  // 3 weeks
  1000 * 60 * 60 * 24 * 60,  // 2 months
];

export function markVerseLearned(verseId) {
  const now = Date.now();
  const existing = state.get(`verses.${verseId}`, null);
  const strength = existing ? Math.min((existing.strength || 0) + 1, REVIEW_STEPS_MS.length - 1) : 0;
  state.set(`verses.${verseId}`, {
    learnedAt: existing?.learnedAt || now,
    nextReview: now + REVIEW_STEPS_MS[strength],
    strength,
  });
}

export function getLearnedVerseIds() {
  return Object.keys(state.get('verses', {}));
}

export function getDueVerseIds() {
  const now = Date.now();
  const verses = state.get('verses', {});
  return Object.keys(verses).filter((id) => verses[id].nextReview <= now);
}

export function isTaskDone(taskId) {
  return !!state.get(`tasks.${taskId}.done`, false);
}

export function markTaskDone(taskId) {
  state.set(`tasks.${taskId}.done`, true);
}
