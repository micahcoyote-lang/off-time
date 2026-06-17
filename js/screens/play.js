/* play.js — the Play category: tasks grouped into Fun!, Puzzles, Education.
   Locked tasks (unmet `requires`) show a lock; missing games show "Coming soon". */

import { el, topbar, row, go } from '../ui.js';
import { SECTIONS, tasksBySection, getTask } from '../../data/tasks.js';
import { isTaskDone } from '../state.js';

export function renderPlay() {
  const screen = el('section.screen');
  screen.append(topbar('Play', { onBack: () => go('/home') }));

  const scroll = el('div.scroll');

  for (const section of SECTIONS) {
    const tasks = tasksBySection(section.key);

    scroll.append(el('div.section-head', { text: `${section.emoji} ${section.label}` }));

    if (!tasks.length) {
      scroll.append(el('p.muted', { text: 'More coming soon…' }));
      continue;
    }

    for (const t of tasks) {
      const done = isTaskDone(t.id);
      const req = t.requires ? getTask(t.requires) : null;
      const locked = req ? !isTaskDone(req.id) : false;

      let pill = null;
      if (locked) pill = { label: `Needs ${req.title}`, kind: 'soon' };
      else if (done) pill = { label: 'Done', kind: 'done' };
      else if (!t.game) pill = { label: 'Coming soon', kind: 'soon' };

      scroll.append(row({
        emoji: t.emoji,
        title: t.title,
        sub: t.blurb,
        pill,
        locked,
        onClick: () => go('/play/' + t.id),
      }));
    }
  }

  screen.append(scroll);
  return screen;
}
