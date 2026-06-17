/* decode-engine.js — substitution-cipher decode UI shared by Cryptograms and
   Crypto-Families. Renders cipher letter-cells; tap a cell to select its symbol,
   then a keyboard letter fills every occurrence. Reveals a couple starter letters. */

import { el, letterKeyboard, shuffle } from './_shared.js';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function derange(a) {
  let p;
  do { p = shuffle(a); } while (p.some((x, i) => x === a[i]));
  return p;
}

/**
 * runDecode(api, lines, opts)
 *   lines: array of lines; each line is an array of words (A–Z strings).
 *   opts.revealCount, opts.onSolved
 * Returns { key } so the module can forward physical-keyboard input.
 */
export function runDecode(api, lines, opts = {}) {
  const reveal = opts.revealCount == null ? 2 : opts.revealCount;

  const cipherArr = derange(ALPHA);
  const enc = {};                       // plaintext -> cipher
  ALPHA.forEach((p, i) => (enc[p] = cipherArr[i]));

  const guesses = {};                   // cipher -> player's plaintext guess
  const given = {};                     // cipher -> locked starter
  let selected = null;                  // currently selected cipher letter

  const allPlain = lines.flat().join('').split('').filter((c) => /[A-Z]/.test(c));
  const present = [...new Set(allPlain)];
  shuffle(present).slice(0, reveal).forEach((p) => {
    guesses[enc[p]] = p;
    given[enc[p]] = true;
  });

  function isWin() {
    return allPlain.every((p) => guesses[enc[p]] === p);
  }

  function render() {
    api.body.innerHTML = '';
    lines.forEach((words) => {
      const line = el('div.crypt-line');
      words.forEach((word) => {
        const w = el('div.crypt-word');
        word.split('').forEach((p) => {
          const c = enc[p];
          const g = guesses[c] || '';
          const cls = 'button.crypt-cell'
            + (given[c] ? '.given' : '')
            + (selected === c ? '.sel' : '')
            + (g ? '.filled' : '');
          const cell = el(cls, {
            html: `<span class="cg">${g || '&nbsp;'}</span><span class="cc">${c}</span>`,
            onclick: () => { selected = given[c] ? null : c; render(); },
          });
          w.append(cell);
        });
        line.append(w);
      });
      api.body.append(line);
    });
  }

  function key(ch) {
    if (!selected || given[selected]) return;
    if (ch === null) {
      delete guesses[selected];
    } else {
      // a plaintext letter maps from only one cipher letter — clear conflicts
      Object.keys(guesses).forEach((c) => { if (guesses[c] === ch && c !== selected) delete guesses[c]; });
      guesses[selected] = ch;
    }
    render();
    if (isWin()) opts.onSolved && opts.onSolved();
  }

  render();
  api.controls.innerHTML = '';
  api.controls.append(letterKeyboard(key));
  return { key };
}
