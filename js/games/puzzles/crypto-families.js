/* crypto-families.js — decode a themed group of words under one shared cipher. */

import { puzzleShell, pick } from './_shared.js';
import { FAMILIES } from '../../../data/words.js';
import { runDecode } from './decode-engine.js';

export function mountCryptoFamilies(task) {
  const api = puzzleShell(task, { hint: 'Every word uses the same cipher. Crack one, crack them all!' });
  let onKey = null;

  api.onNew(() => {
    const fam = pick(FAMILIES);
    api.hud.innerHTML = `<span class="chip">🧬 Theme: ${fam.theme}</span>`;
    const lines = fam.words.map((w) => [w]);   // one word per line
    const d = runDecode(api, lines, {
      revealCount: 2,
      onSolved: () => api.win('🎉 Family decoded!'),
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
