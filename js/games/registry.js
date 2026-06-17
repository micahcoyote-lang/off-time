/* registry.js — maps a task id to its game module.
   renderTask() is the route handler for #/play/:id. It handles three cases:
     - locked (unmet `requires`)  -> bounce back with a note
     - no game yet                -> friendly "Coming soon" screen
     - real game                  -> mount the module (returns { el, destroy }) */

import { el, topbar, go } from '../ui.js';
import { getTask } from '../../data/tasks.js';
import { isTaskDone } from '../state.js';
import { mountSlidingPuzzle } from './sliding-puzzle.js';
import { mountOfficeTrash } from './office-trash.js';
import { mountJobSite } from './job-site.js';
import { mountEarth } from './earth.js';
import { mountCryptograms } from './puzzles/cryptograms.js';
import { mountCryptoFamilies } from './puzzles/crypto-families.js';
import { mountAnagrams } from './puzzles/anagrams.js';
import { mountBrickByBrick } from './puzzles/brick-by-brick.js';
import { mountQuotefalls } from './puzzles/quotefalls.js';

const GAMES = {
  'sliding-puzzle': mountSlidingPuzzle,
  'office-trash': mountOfficeTrash,
  'job-site': mountJobSite,
  'earth': mountEarth,
  'cryptograms': mountCryptograms,
  'crypto-families': mountCryptoFamilies,
  'anagrams': mountAnagrams,
  'brick-by-brick': mountBrickByBrick,
  'quotefalls': mountQuotefalls,
};

function comingSoon(task) {
  const screen = el('section.screen');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));
  const scroll = el('div.scroll.center');
  scroll.style.cssText += 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
  scroll.append(
    el('div', { html: `<div style="font-size:4rem">${task.emoji}</div>` }),
    el('h2.doodle-font', { text: task.title }),
    el('p.muted', { text: task.blurb }),
    el('div', { html: '<span class="pill soon">Coming soon</span>' }),
    el('p.muted', { text: 'This task isn’t built yet — but the slot is ready for it.' }),
    el('button.btn.secondary', { text: '← Pick another task', onclick: () => go('/play') }),
  );
  screen.append(scroll);
  return screen;
}

function lockedNote(task, reqTitle) {
  const screen = el('section.screen');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));
  const scroll = el('div.scroll.center');
  scroll.style.cssText += 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
  scroll.append(
    el('div', { html: '<div style="font-size:4rem">🔒</div>' }),
    el('h2.doodle-font', { text: 'Locked' }),
    el('p.muted', { text: `Complete “${reqTitle}” first to unlock ${task.title}.` }),
    el('button.btn.secondary', { text: '← Back to Play', onclick: () => go('/play') }),
  );
  screen.append(scroll);
  return screen;
}

export function renderTask(id) {
  const task = getTask(id);
  if (!task) return go('/play'), document.createElement('div');

  if (task.requires) {
    const req = getTask(task.requires);
    if (req && !isTaskDone(req.id)) return lockedNote(task, req.title);
  }

  const mount = task.game ? GAMES[task.game] : null;
  if (!mount) return comingSoon(task);

  return mount(task); // returns { el, destroy }
}
