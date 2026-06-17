/* audio.js — the audio manager.
   One looping <audio> for background music, plus on-demand preview for the showcase.
   Honors state.settings.music, handles browser autoplay blocking, and fails silently
   when a track/file is missing (safe before any MP3s exist). */

import { state } from './state.js';
import { MUSIC, getTrack } from '../data/music.js';

const bg = new Audio();
bg.loop = true;
bg.preload = 'auto';
bg.volume = 0;

export let current = null;   // active background track id (exposed for tests)
let targetId = null;         // what we *want* playing (so a gesture can resume it)
let unlocked = false;
let fadeTimer = null;

function musicOn() {
  return state.get('settings.music', true) !== false;
}

function fadeTo(vol, done) {
  clearInterval(fadeTimer);
  const step = (vol - bg.volume) / 12;
  fadeTimer = setInterval(() => {
    bg.volume = Math.min(1, Math.max(0, bg.volume + step));
    if (Math.abs(bg.volume - vol) < Math.abs(step) + 0.001) {
      bg.volume = vol;
      clearInterval(fadeTimer);
      if (done) done();
    }
  }, 30);
}

function startTarget() {
  if (!targetId || !musicOn()) return;
  const track = getTrack(targetId);
  if (!track || !track.file) return;
  if (current !== targetId) {
    current = targetId;
    bg.src = track.file;
    bg.volume = 0;
  }
  const p = bg.play();
  if (p && p.catch) p.catch(() => { /* blocked until a user gesture */ });
  fadeTo(0.6);
}

/** Set/replace the background track (no-op if already playing it). */
export function playMusic(trackId) {
  targetId = trackId || null;
  if (!targetId) { stopMusic(); return; }
  if (current === targetId && !bg.paused) return;
  startTarget();
}

export function stopMusic() {
  targetId = null;
  fadeTo(0, () => { bg.pause(); current = null; });
}

/** Choose music for a route: games use their mapped track, else the menu track. */
export function updateForRoute(path) {
  let id = MUSIC.menu;
  const m = /^\/play\/([^/]+)/.exec(path || '');
  if (m && MUSIC.games && MUSIC.games[m[1]]) id = MUSIC.games[m[1]];
  playMusic(id);
}

/** Settings toggle. */
export function setMusicEnabled(on) {
  state.set('settings.music', !!on);
  if (on) startTarget();
  else fadeTo(0, () => bg.pause());
}

/** Browsers block audio until the first gesture — call this once at boot. */
export function initUnlock() {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    startTarget();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/* ---- Showcase preview: play/pause a single track independent of background ---- */
const preview = new Audio();
preview.preload = 'none';
let previewId = null;

/**
 * Toggle a showcase track. onState(playing:boolean) is called as it changes
 * (including 'ended' and load errors → false).
 */
export function previewToggle(trackId, onState) {
  const track = getTrack(trackId);
  if (!track || !track.file) { onState && onState(false, 'missing'); return; }

  // Pause background while previewing so they don't overlap.
  if (previewId === trackId && !preview.paused) {
    preview.pause();
    onState && onState(false);
    if (musicOn()) startTarget();
    return;
  }

  if (current && !bg.paused) fadeTo(0, () => bg.pause());

  previewId = trackId;
  preview.src = track.file;
  preview.onended = () => { onState && onState(false); if (musicOn()) startTarget(); };
  preview.onerror = () => onState && onState(false, 'missing');
  const p = preview.play();
  if (p && p.catch) p.catch(() => onState && onState(false));
  onState && onState(true);
}

export function stopPreview() {
  preview.pause();
  previewId = null;
}
