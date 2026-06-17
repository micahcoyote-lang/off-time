/* anagrams.js — unscramble N words using the clues. Tap letter tiles into the slots. */

import { puzzleShell, el, shuffle, pick } from './_shared.js';
import { ANAGRAM_WORDS } from '../../../data/words.js';

const N = 5;

function scrambleDifferent(word) {
  let s;
  do { s = shuffle(word.split('')).join(''); } while (s === word && word.length > 1);
  return s;
}

export function mountAnagrams(task) {
  const api = puzzleShell(task, { hint: 'Tap letters to spell the answer — the clue helps!' });
  let removeKey = null;

  api.onNew(() => {
    const items = shuffle(ANAGRAM_WORDS).slice(0, N);
    let idx = 0, solved = 0;

    function renderItem() {
      const it = items[idx];
      const answer = it.word;
      const pool = scrambleDifferent(answer).split('').map((ch, i) => ({ ch, i, used: false }));
      const placed = new Array(answer.length).fill(null);

      api.hud.innerHTML = `<span class="chip">Word ${idx + 1}/${N}</span><span class="chip">Solved ${solved}</span>`;
      api.body.innerHTML = '';
      const clue = el('p.clue', { text: '💡 ' + it.clue });
      const slots = el('div.anag-slots');
      const poolEl = el('div.anag-pool');
      api.body.append(clue, slots, poolEl);

      function firstEmpty() { return placed.findIndex((x) => !x); }

      function draw() {
        slots.innerHTML = '';
        placed.forEach((p, s) => {
          slots.append(el('button.anag-slot' + (p ? '.filled' : ''), {
            text: p ? p.ch : '',
            onclick: () => { if (p) { pool[p.i].used = false; placed[s] = null; draw(); } },
          }));
        });
        poolEl.innerHTML = '';
        pool.forEach((p) => {
          poolEl.append(el('button.anag-tile' + (p.used ? '.used' : ''), {
            text: p.ch,
            onclick: () => place(p),
          }));
        });
      }

      function place(p) {
        if (p.used) return;
        const slot = firstEmpty();
        if (slot < 0) return;
        p.used = true;
        placed[slot] = p;
        draw();
        check();
      }

      function check() {
        const cur = placed.map((p) => (p ? p.ch : '')).join('');
        if (cur === answer) {
          solved += 1;
          api.say('✅ ' + answer + '!');
          idx += 1;
          if (idx >= N) api.win(`🎉 All ${N} unscrambled!`);
          else setTimeout(renderItem, 700);
        } else if (firstEmpty() < 0) {
          api.say('Not quite — tap a slot to take a letter back.');
        }
      }

      // physical keyboard: type a letter to place a matching unused tile
      removeKey = (ch) => {
        if (ch === null) {
          for (let s = placed.length - 1; s >= 0; s--) if (placed[s]) { pool[placed[s].i].used = false; placed[s] = null; draw(); return; }
          return;
        }
        const t = pool.find((p) => !p.used && p.ch === ch);
        if (t) place(t);
      };

      draw();
    }

    renderItem();
  });

  function physical(e) {
    if (!removeKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) removeKey(e.key.toUpperCase());
    else if (e.key === 'Backspace') removeKey(null);
  }
  window.addEventListener('keydown', physical);

  api.newRound();
  return { el: api.screen, destroy() { window.removeEventListener('keydown', physical); } };
}
