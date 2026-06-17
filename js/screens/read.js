/* read.js — curated public-domain books; each row opens Project Gutenberg in a new tab. */

import { el, topbar, row, go } from '../ui.js';
import { BOOKS } from '../../data/books.js';

export function renderRead() {
  const screen = el('section.screen');
  screen.append(topbar('Read', { onBack: () => go('/home') }));

  const scroll = el('div.scroll');
  scroll.append(el('p.muted.center', { text: 'Free classics from Project Gutenberg. Opens in a new tab.' }));

  for (const b of BOOKS) {
    scroll.append(row({
      emoji: b.emoji,
      title: b.title,
      sub: b.author,
      onClick: () => window.open(b.url, '_blank', 'noopener'),
    }));
  }

  screen.append(scroll);
  return screen;
}
