/* home.js — the four-category hub + settings gear. */

import { el, go } from '../ui.js';
import { getDueVerseIds } from '../state.js';

const CATEGORIES = [
  { key: 'play', name: 'Play', emoji: '🎮', sub: 'Tough little tasks', route: '/play' },
  { key: 'learn', name: 'Learn', emoji: '📚', sub: 'Fun-fact snacks', route: '/learn' },
  { key: 'read', name: 'Read', emoji: '📖', sub: 'Free ebooks', route: '/read' },
  { key: 'earn', name: 'Memorize / Earn', emoji: '🧠', sub: 'KJV verses', route: '/memorize' },
];

export function renderHome() {
  const screen = el('section.screen');

  const gear = el('button.gear', {
    text: '⚙️',
    'aria-label': 'Settings',
    onclick: () => go('/settings'),
  });

  const hero = el('div.home-hero', {}, [
    el('div.home-logo', { text: 'Off Time' }),
    el('div.home-tagline', { text: 'Got a minute to kill? Let’s make it count.' }),
  ]);
  // float the gear top-right
  hero.style.position = 'relative';
  const gearWrap = el('div', {}, [gear]);
  gearWrap.style.cssText = 'position:absolute;top:14px;right:14px;';
  hero.appendChild(gearWrap);

  const dueCount = getDueVerseIds().length;

  const grid = el('div.cat-grid', {}, CATEGORIES.map((c) => {
    const card = el('button.cat-card', { onclick: () => go(c.route) }, [
      el('span.cat-emoji', { text: c.emoji }),
      el('span.cat-name', { text: c.name }),
      el('span.cat-sub', { text: c.sub }),
    ]);
    if (c.key === 'earn' && dueCount > 0) {
      card.appendChild(el('div', { html: `<span class="pill soon">${dueCount} to review</span>` }));
    }
    return card;
  }));

  screen.append(hero, grid);
  return screen;
}
