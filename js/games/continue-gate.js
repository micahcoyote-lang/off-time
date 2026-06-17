/* continue-gate.js — the "earn your continue" mechanic.
   Instead of watching an ad, the player memorizes (or reviews) a KJV verse.
   requireVerse() resolves once they complete it. Any game calls this. */

import { el } from '../ui.js';
import { buildMemorizer, pickVerseToServe } from '../screens/memorize.js';

/**
 * requireVerse({ reason }) -> Promise that resolves true when the player
 * completes a verse, or false if they back out.
 */
export function requireVerse({ reason = 'Memorize a verse to keep going!' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const served = pickVerseToServe();

    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      resolve(ok);
    };

    const intro = el('div.center.stack', {}, [
      el('div', { text: '⛽', html: '<div style="font-size:2.4rem">⛽</div>' }),
      el('h2.doodle-font', { text: served.mode === 'review' ? 'Quick review first!' : 'Earn your continue' }),
      el('p.muted', { text: reason }),
    ]);

    const card = el('div.modal-card.stack', {}, [intro]);
    card.append(buildMemorizer(served.verse, {
      mode: served.mode,
      onComplete: () => done(true),
      onCancel: () => done(false),
    }));

    const backdrop = el('div.modal-backdrop', {}, [card]);
    root.appendChild(backdrop);
  });
}
