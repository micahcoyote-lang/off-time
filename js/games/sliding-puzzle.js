/* sliding-puzzle.js — the one working game in Milestone 1.
   Flat-vector skin. Demonstrates the game-module contract:
     mount(task) -> { el, destroy }
   and the continue-gate (memorize a verse to start a fresh round).

   Features: Easy/Medium/Hard difficulty (scramble distance) + a Hint button
   that highlights the optimal next tile via an A* solver. */

import { el, topbar, go } from '../ui.js';
import { markTaskDone, state } from '../state.js';
import { requireVerse } from './continue-gate.js';

const SIZE = 3; // 3x3 (8-puzzle).

// Scramble distance per level. 8-puzzle's hardest state is 31 moves,
// so Easy stays a handful from solved; Hard is effectively fully scrambled.
const LEVELS = {
  easy: { label: 'Easy', moves: 10 },
  medium: { label: 'Medium', moves: 22 },
  hard: { label: 'Hard', moves: 55 },
};

function solvedBoard() {
  const a = [];
  for (let i = 1; i < SIZE * SIZE; i++) a.push(i);
  a.push(0); // 0 = blank
  return a;
}

const GOAL_KEY = solvedBoard().join(',');

function isSolved(board) {
  for (let i = 0; i < board.length - 1; i++) if (board[i] !== i + 1) return false;
  return board[board.length - 1] === 0;
}

/* Shuffle by making random legal moves from solved => always solvable. */
function shuffle(board, moves) {
  let b = board.slice();
  let last = -1;
  for (let n = 0; n < moves; n++) {
    const blank = b.indexOf(0);
    const nbrs = neighbors(blank).filter((i) => i !== last);
    const pick = nbrs[Math.floor(Math.random() * nbrs.length)];
    [b[blank], b[pick]] = [b[pick], b[blank]];
    last = blank;
  }
  // Avoid handing back an already-solved board.
  return isSolved(b) ? shuffle(board, moves + 1) : b;
}

function neighbors(idx) {
  const r = Math.floor(idx / SIZE), c = idx % SIZE;
  const out = [];
  if (r > 0) out.push(idx - SIZE);
  if (r < SIZE - 1) out.push(idx + SIZE);
  if (c > 0) out.push(idx - 1);
  if (c < SIZE - 1) out.push(idx + 1);
  return out;
}

/* Sum of Manhattan distances of each numbered tile from its goal cell. */
function manhattan(board) {
  let total = 0;
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (v === 0) continue;
    const goal = v - 1;
    total += Math.abs(Math.floor(i / SIZE) - Math.floor(goal / SIZE))
           + Math.abs((i % SIZE) - (goal % SIZE));
  }
  return total;
}

/* A* solver. Returns the index of the tile to tap for the optimal next move,
   or null if already solved. Falls back to a greedy Manhattan move if needed. */
function bestNextMove(board) {
  if (isSolved(board)) return null;

  const start = board.join(',');
  const open = [{ key: start, board: board.slice(), g: 0, first: null }];
  const best = { [start]: 0 };
  let guard = 0;

  while (open.length && guard++ < 200000) {
    // pop lowest f = g + h (linear scan is fine for the tiny 8-puzzle space)
    let bi = 0;
    let bf = Infinity;
    for (let i = 0; i < open.length; i++) {
      const f = open[i].g + manhattan(open[i].board);
      if (f < bf) { bf = f; bi = i; }
    }
    const cur = open.splice(bi, 1)[0];
    if (cur.key === GOAL_KEY) return cur.first;

    const blank = cur.board.indexOf(0);
    for (const nb of neighbors(blank)) {
      const nboard = cur.board.slice();
      [nboard[blank], nboard[nb]] = [nboard[nb], nboard[blank]];
      const nkey = nboard.join(',');
      const ng = cur.g + 1;
      if (best[nkey] === undefined || ng < best[nkey]) {
        best[nkey] = ng;
        // `first` = the tile tapped on the very first move of this path.
        open.push({ key: nkey, board: nboard, g: ng, first: cur.first === null ? nb : cur.first });
      }
    }
  }

  // Greedy fallback: neighbor swap that most reduces Manhattan distance.
  const blank = board.indexOf(0);
  let pick = null;
  let bestH = Infinity;
  for (const nb of neighbors(blank)) {
    const nboard = board.slice();
    [nboard[blank], nboard[nb]] = [nboard[nb], nboard[blank]];
    const h = manhattan(nboard);
    if (h < bestH) { bestH = h; pick = nb; }
  }
  return pick;
}

export function mountSlidingPuzzle(task) {
  const saved = state.get('settings.puzzleDifficulty', 'easy');
  let level = LEVELS[saved] ? saved : 'easy';
  let board = shuffle(solvedBoard(), LEVELS[level].moves);
  let moves = 0;
  let won = false;
  let hintIndex = null;

  const screen = el('section.screen.game');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));

  const stage = el('div.game-stage');

  const hud = el('div.game-hud', {}, [
    el('span.chip', { html: 'Moves: <b id="mv">0</b>' }),
    el('span.chip', { html: `${SIZE}×${SIZE}` }),
  ]);

  // Difficulty row
  const diffRow = el('div.diff-row');
  function renderDiffRow() {
    diffRow.innerHTML = '';
    for (const key of Object.keys(LEVELS)) {
      diffRow.append(el('button.diff-btn' + (key === level ? '.active' : ''), {
        text: LEVELS[key].label,
        onclick: () => chooseLevel(key),
      }));
    }
  }

  const grid = el('div.puzzle-grid');
  grid.style.gridTemplateColumns = `repeat(${SIZE}, 1fr)`;

  const banner = el('div.win-banner');
  banner.style.minHeight = '1.8rem';

  const controls = el('div.game-controls');

  stage.append(hud, diffRow, grid, banner, controls);
  screen.append(stage);

  function playControls() {
    controls.innerHTML = '';
    controls.append(
      el('button.btn', { text: '💡 Hint', onclick: showHint }),
      el('button.btn.secondary', { text: '↻ Shuffle', onclick: () => newRound(level) }),
    );
  }

  function draw() {
    grid.innerHTML = '';
    board.forEach((val, i) => {
      if (val === 0) {
        grid.append(el('div.tile.blank'));
        return;
      }
      const cls = 'button.tile'
        + (val === i + 1 ? '.correct' : '')
        + (i === hintIndex ? '.hint' : '');
      grid.append(el(cls, { text: String(val), onclick: () => tap(i) }));
    });
    screen.querySelector('#mv').textContent = String(moves);
  }

  function tap(i) {
    if (won) return;
    const blank = board.indexOf(0);
    if (!neighbors(i).includes(blank)) return;
    [board[i], board[blank]] = [board[blank], board[i]];
    moves += 1;
    hintIndex = null; // any move clears the hint
    draw();
    if (isSolved(board)) win();
  }

  function showHint() {
    if (won) return;
    hintIndex = bestNextMove(board);
    draw();
  }

  function win() {
    won = true;
    hintIndex = null;
    markTaskDone(task.id);
    banner.textContent = `🎉 Solved in ${moves} moves!`;
    diffRow.style.display = 'none'; // starting fresh now goes through the verse gate
    controls.innerHTML = '';
    controls.append(
      el('button.btn', { text: '▶ Play again', onclick: playAgainGated }),
      el('button.btn.secondary', { text: 'Back to Play', onclick: () => go('/play') }),
    );
  }

  // The signature mechanic: to start a *fresh* round you "pay" with a verse.
  async function playAgainGated() {
    const ok = await requireVerse({ reason: 'Memorize a verse to unlock another round.' });
    if (ok) newRound(level);
  }

  function chooseLevel(key) {
    level = key;
    state.set('settings.puzzleDifficulty', key);
    newRound(key);
  }

  function newRound(lvl) {
    level = lvl;
    board = shuffle(solvedBoard(), LEVELS[level].moves);
    moves = 0;
    won = false;
    hintIndex = null;
    banner.textContent = '';
    diffRow.style.display = '';
    renderDiffRow();
    playControls();
    draw();
  }

  renderDiffRow();
  playControls();
  draw();

  return {
    el: screen,
    destroy() { /* no global listeners to clean up */ },
  };
}
