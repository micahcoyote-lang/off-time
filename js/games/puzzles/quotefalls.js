/* quotefalls.js — "fallen phrases". The quote is laid into a grid; each column's
   letters are scrambled in a pool above it. Drop them back into the column's blanks
   (column-constrained) so the rows read the quote. */

import { puzzleShell, el, shuffle } from './_shared.js';
import { pickQuote } from '../../../data/quotes.js';

export function mountQuotefalls(task) {
  const api = puzzleShell(task, { hint: 'Each column’s letters are jumbled above it. Drop them into the blanks.' });

  api.onNew(() => {
    const q = pickQuote(40);
    const s = q.text.replace(/\s+/g, ' ').trim();
    const L = s.length;
    const rows = L <= 18 ? 2 : L <= 30 ? 3 : 4;
    const W = Math.ceil(L / rows);

    // Build grid cells
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < W; c++) {
        const idx = r * W + c;
        if (idx >= L) row.push({ type: 'pad' });
        else if (s[idx] === ' ') row.push({ type: 'space' });
        else row.push({ type: 'letter', sol: s[idx], fill: null });
        row[c] && (row[c].r = r, row[c].c = c);
      }
      cells.push(row);
    }

    // Per-column scrambled pools (only from letter cells)
    const pools = [];
    for (let c = 0; c < W; c++) {
      const letters = [];
      for (let r = 0; r < rows; r++) if (cells[r][c].type === 'letter') letters.push(cells[r][c].sol);
      pools.push(shuffle(letters).map((ch) => ({ ch, used: false })));
    }

    api.hud.innerHTML = `<span class="chip">🪂 Quotefalls</span>`;
    api.body.innerHTML = '';
    const poolsEl = el('div.qf-pools');
    const gridEl = el('div.qf-grid');
    poolsEl.style.gridTemplateColumns = `repeat(${W}, 1fr)`;
    gridEl.style.gridTemplateColumns = `repeat(${W}, 1fr)`;
    api.body.append(poolsEl, gridEl);

    function topEmpty(c) {
      for (let r = 0; r < rows; r++) if (cells[r][c].type === 'letter' && !cells[r][c].fill) return cells[r][c];
      return null;
    }

    function place(c, tile) {
      if (tile.used) return;
      const cell = topEmpty(c);
      if (!cell) return;
      cell.fill = tile.ch;
      tile.used = true;
      draw();
      if (isWin()) api.win('🎉 Quote restored! — ' + q.source);
    }

    function removeCell(cell) {
      if (!cell.fill) return;
      const t = pools[cell.c].find((p) => p.used && p.ch === cell.fill);
      if (t) t.used = false;
      cell.fill = null;
      draw();
    }

    function isWin() {
      return cells.every((row) => row.every((cell) => cell.type !== 'letter' || cell.fill === cell.sol));
    }

    function draw() {
      poolsEl.innerHTML = '';
      for (let c = 0; c < W; c++) {
        const col = el('div.qf-pool');
        pools[c].forEach((tile) => {
          col.append(el('button.qf-tile' + (tile.used ? '.used' : ''), {
            text: tile.ch,
            onclick: () => place(c, tile),
          }));
        });
        poolsEl.append(col);
      }
      gridEl.innerHTML = '';
      cells.forEach((row) => row.forEach((cell) => {
        if (cell.type === 'pad') { gridEl.append(el('div.qf-cell.pad')); return; }
        if (cell.type === 'space') { gridEl.append(el('div.qf-cell.space')); return; }
        gridEl.append(el('button.qf-cell' + (cell.fill ? '.filled' : ''), {
          text: cell.fill || '',
          onclick: () => removeCell(cell),
        }));
      }));
    }

    draw();
  });

  api.newRound();
  return { el: api.screen, destroy() {} };
}
