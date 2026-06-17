/* cryptograms.js — decode a substitution-ciphered quote. */

import { puzzleShell } from './_shared.js';
import { pickQuote } from '../../../data/quotes.js';
import { runDecode } from './decode-engine.js';

export function mountCryptograms(task) {
  const api = puzzleShell(task, { hint: 'Tap a letter, then type the real letter it stands for.' });
  let onKey = null;

  api.onNew(() => {
    const q = pickQuote(34);
    api.hud.innerHTML = '<span class="chip">🔐 Cryptogram</span>';
    const lines = [q.text.trim().split(/\s+/)];
    const d = runDecode(api, lines, {
      revealCount: 2,
      onSolved: () => api.win('🎉 Decoded! — ' + q.source),
    });
    onKey = d.key;
  });

  function physical(e) {
    if (!onKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toUpperCase());
    else if (e.key === 'Backspace') onKey(null);
  }
  window.addEventListener('keydown', physical);

  api.newRound();
  return { el: api.screen, destroy() { window.removeEventListener('keydown', physical); } };
}
