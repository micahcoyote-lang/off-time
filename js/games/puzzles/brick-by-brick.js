/* brick-by-brick.js — rebuild a saying by tapping its scrambled "bricks" in order.
   Letters are chopped into 3-char bricks (spaces shown as ·). */

import { puzzleShell, el, shuffle } from './_shared.js';
import { pickQuote } from '../../../data/quotes.js';

const SIZE = 3;

export function mountBrickByBrick(task) {
  const api = puzzleShell(task, { hint: 'Tap the bricks in the right order to build the wall.' });

  api.onNew(() => {
    const q = pickQuote(30);
    const display = q.text.replace(/\s+/g, ' ').trim().replace(/ /g, '·');

    const bricks = [];
    for (let i = 0; i < display.length; i += SIZE) bricks.push(display.slice(i, i + SIZE));
    const order = bricks.map((b, i) => ({ b, i }));
    const shuffled = shuffle(order);
    const placed = [];   // indices into `order`

    api.hud.innerHTML = `<span class="chip">🧱 ${bricks.length} bricks</span>`;
    api.body.innerHTML = '';
    const wall = el('div.brick-wall');
    const tray = el('div.brick-tray');
    api.body.append(wall, tray);

    function draw() {
      wall.textContent = placed.map((p) => order[p].b).join('').replace(/·/g, ' ') || ' ';
      tray.innerHTML = '';
      shuffled.forEach((item) => {
        const used = placed.includes(item.i);
        tray.append(el('button.brick' + (used ? '.used' : ''), {
          text: item.b.replace(/·/g, '␣'),
          onclick: () => { if (!used) { placed.push(item.i); api.say(''); draw(); check(); } },
        }));
      });
    }

    function check() {
      if (placed.length !== order.length) return;
      const assembled = placed.map((p) => order[p].b).join('');
      if (assembled === display) api.win('🎉 Wall complete! — ' + q.source);
      else api.say('Not the right order yet — use Undo to rearrange.');
    }

    api.controls.innerHTML = '';
    api.controls.append(el('button.btn.secondary', {
      text: '⌫ Undo',
      onclick: () => { placed.pop(); api.say(''); draw(); },
    }));

    draw();
  });

  api.newRound();
  return { el: api.screen, destroy() {} };
}
