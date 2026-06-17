/* settings.js — Milestone 1 stub with a few real, working controls. */

import { el, topbar, go } from '../ui.js';
import { state, applyDerived } from '../state.js';
import { setMusicEnabled } from '../audio.js';

function toggleRow(label, value, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  const wrap = el('label.row', {}, [
    el('span.row-text', {}, [el('span.row-title', { text: label })]),
    input,
  ]);
  wrap.style.cursor = 'pointer';
  return wrap;
}

export function renderSettings() {
  const screen = el('section.screen');
  screen.append(topbar('Settings', { onBack: () => go('/home') }));

  const scroll = el('div.scroll');

  // Sound (wired into state; audio hookup comes with real games)
  scroll.append(toggleRow('Sound effects', state.get('settings.sound', true), (v) => {
    state.set('settings.sound', v);
  }));

  // Background music
  scroll.append(toggleRow('Music', state.get('settings.music', true), (v) => {
    setMusicEnabled(v);
  }));

  // Text size
  scroll.append(el('div.section-head', { text: 'Text size' }));
  const sizes = [['Small', 0.9], ['Normal', 1], ['Large', 1.15]];
  const sizeWrap = el('div.game-controls');
  sizeWrap.style.cssText = 'gap:10px;flex-wrap:wrap;';
  const current = state.get('settings.textScale', 1);
  sizes.forEach(([label, val]) => {
    const b = el('button.btn' + (val === current ? '' : '.secondary'), {
      text: label,
      onclick: () => { state.set('settings.textScale', val); applyDerived(); go('/settings'); },
    });
    sizeWrap.append(b);
  });
  scroll.append(sizeWrap);

  // Replay intro
  scroll.append(el('div.section-head', { text: 'Other' }));
  scroll.append(el('button.btn.secondary', {
    text: '▶ Replay the intro',
    onclick: () => { state.set('introSeen', false); go('/intro'); },
  }));
  scroll.lastChild.style.cssText = 'display:block;width:100%;margin-bottom:10px;';

  // Reset progress
  const resetBtn = el('button.btn', {
    text: '🗑️ Reset all progress',
    onclick: () => {
      if (confirm('Erase all learned verses, task progress, and settings? This cannot be undone.')) {
        state.reset();
        applyDerived();
        go('/home');
      }
    },
  });
  resetBtn.style.cssText = 'display:block;width:100%;background:#b3402f;';
  scroll.append(resetBtn);

  scroll.append(el('p.muted.center', { text: 'More settings coming soon.' }));
  scroll.lastChild.style.marginTop = '24px';

  screen.append(scroll);
  return screen;
}
