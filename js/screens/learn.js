/* learn.js — subject list -> a tappable "fact snack" that shuffles on tap. */

import { el, topbar, row, go } from '../ui.js';
import { SUBJECTS, FACTS } from '../../data/facts.js';
import { TRACKS } from '../../data/music.js';
import { previewToggle, stopPreview } from '../audio.js';

export function renderLearn() {
  const screen = el('section.screen');
  const scroll = el('div.scroll');
  screen.append(scroll); // attach first so insertBefore(topbar, scroll) is valid

  function setTopbar(title, onBack) {
    screen.querySelector('.topbar')?.remove();
    screen.insertBefore(topbar(title, { onBack }), scroll);
  }

  function renderList() {
    setTopbar('Learn', () => go('/home'));
    scroll.innerHTML = '';
    scroll.append(el('p.muted.center', { text: 'Bite-size facts to keep your mind nibbling.' }));
    for (const s of SUBJECTS) {
      scroll.append(row({
        emoji: s.emoji,
        title: s.label,
        sub: `${FACTS[s.key]?.length || 0} fact snacks`,
        onClick: () => openSubject(s),
      }));
    }
  }

  function musicPlayer() {
    const wrap = el('div');
    wrap.append(el('div.section-head', { text: '🎧 Listen — my compositions' }));
    const shown = TRACKS.filter((t) => t.showcase);
    if (!shown.length) {
      wrap.append(el('p.muted', {
        text: 'No tracks yet — drop MP3s in assets/audio/ and list them in data/music.js.',
      }));
      return wrap;
    }
    for (const t of shown) {
      const btn = el('button.music-play', { text: '▶' });
      btn.addEventListener('click', () => {
        previewToggle(t.id, (playing, err) => {
          btn.textContent = playing ? '⏸' : '▶';
          if (err === 'missing') btn.textContent = '⚠';
          // reset any other buttons
          wrap.querySelectorAll('.music-play').forEach((b) => { if (b !== btn) b.textContent = '▶'; });
        });
      });
      const r = el('div.row', {}, [
        btn,
        el('span.row-text', {}, [el('span.row-title', { text: t.title })]),
      ]);
      wrap.append(r);
    }
    return wrap;
  }

  function openSubject(s) {
    const facts = FACTS[s.key] || [];
    let idx = 0;

    setTopbar(s.label, () => { stopPreview(); renderList(); });
    scroll.innerHTML = '';
    if (s.key === 'music') scroll.append(musicPlayer());

    const card = el('div.doodle-box', {
      html: `<p>${facts[0] || 'More facts coming soon!'}</p>`,
    });
    card.style.cssText += 'padding:22px;font-size:1.15rem;min-height:160px;display:flex;align-items:center;justify-content:center;text-align:center;';

    const nextBtn = el('button.btn.secondary', {
      text: 'Another fact →',
      onclick: () => {
        if (facts.length < 2) return;
        idx = (idx + 1) % facts.length;
        card.querySelector('p').textContent = facts[idx];
        card.style.animation = 'none'; void card.offsetWidth; card.style.animation = 'pop-in 220ms ease both';
      },
    });
    const btnWrap = el('div.center', {}, [nextBtn]);
    btnWrap.style.marginTop = '16px';

    scroll.append(card, btnWrap);
  }

  renderList();
  return screen;
}
