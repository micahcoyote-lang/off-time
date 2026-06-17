/* _shared.js — helpers reused across the word puzzles.
   Mirrors the sliding-puzzle/office-trash module shape so each puzzle stays small. */

import { el, topbar, go } from '../../ui.js';
import { markTaskDone } from '../../state.js';
import { requireVerse } from '../continue-gate.js';

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build the standard puzzle screen shell.
 * Returns { screen, hud, body, msg, banner, controls, say, newRound, win }.
 * - newRound(fn): registers a generator; calling it rebuilds the round.
 * - win(): marks the task done and swaps controls for a gated "New puzzle" + Back.
 */
export function puzzleShell(task, { hint } = {}) {
  const screen = el('section.screen.game');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));

  const stage = el('div.game-stage.puzzle');
  const hud = el('div.game-hud');
  const body = el('div.puzzle-body');
  const msg = el('div.ot-msg');
  const banner = el('div.win-banner');
  banner.style.minHeight = '1.5rem';
  const controls = el('div.game-controls');

  stage.append(hud, body, msg, banner, controls);
  screen.append(stage);

  let generator = null;

  const api = {
    screen, hud, body, msg, banner, controls,
    say(t) { msg.textContent = t || ''; },
    onNew(fn) { generator = fn; },
    newRound() {
      banner.textContent = '';
      api.say(hint || '');
      controls.classList.remove('done');
      if (generator) generator();
    },
    win(message) {
      markTaskDone(task.id);
      banner.textContent = message || '🎉 Solved!';
      controls.classList.add('done');
      controls.innerHTML = '';
      controls.append(
        el('button.btn', {
          text: '▶ New puzzle',
          onclick: async () => {
            const ok = await requireVerse({ reason: 'Memorize a verse for a fresh puzzle.' });
            if (ok) api.newRound();
          },
        }),
        el('button.btn.secondary', { text: 'Back to Play', onclick: () => go('/play') }),
      );
    },
  };
  return api;
}

/** On-screen A–Z keyboard. onKey(letter) and an optional Erase via onKey(null). */
export function letterKeyboard(onKey) {
  const wrap = el('div.kbd');
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch) => {
    wrap.append(el('button.kbd-key', { text: ch, onclick: () => onKey(ch) }));
  });
  wrap.append(el('button.kbd-key.kbd-erase', { text: '⌫', onclick: () => onKey(null) }));
  return wrap;
}

export { el, go };
