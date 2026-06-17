/* memorize.js — Memorize / Earn.
   - Verse list (learned + due-for-review)
   - "Learn a new verse" flow using the Initial Letter Technique
   - KJV reader stub
   Exports buildMemorizer() so the continue-gate can reuse the exact same flow. */

import { el, topbar, row, go } from '../ui.js';
import { VERSES, getVerse } from '../../data/verses.js';
import {
  markVerseLearned, getLearnedVerseIds, getDueVerseIds, state,
} from '../state.js';

/* Turn a verse into its initial-letter hint, preserving punctuation.
   "For God so loved" -> "F G s l" (capital kept if word was capitalized). */
function initials(text) {
  return text.split(/\s+/).map((word) => {
    const m = word.match(/[A-Za-z]/);
    if (!m) return word; // pure punctuation
    const letter = m[0];
    const lead = word.slice(0, m.index); // leading quotes/parens
    const trail = word.slice(word.indexOf(letter) + 1).replace(/[A-Za-z]/g, '');
    return lead + letter + trail;
  }).join(' ');
}

/**
 * buildMemorizer(verse, { mode, onComplete, onCancel }) -> DOM element.
 * mode: 'learn' | 'review'. Calls onComplete() when the user marks it known.
 */
export function buildMemorizer(verse, { mode = 'learn', onComplete, onCancel } = {}) {
  const box = el('div.stack');

  const ref = el('div.doodle-font', { text: verse.ref });
  ref.style.cssText = 'font-size:1.6rem;';

  const passage = el('div.doodle-box');
  passage.style.cssText += 'padding:18px;font-size:1.15rem;line-height:1.5;';

  const hint = el('p.muted.center', {});
  const actions = el('div.stack');

  box.append(ref, passage, hint, actions);

  // Three steps: read -> recite (initials) -> confirm
  let step = 0;

  function render() {
    actions.innerHTML = '';
    if (step === 0) {
      hint.textContent = mode === 'review' ? 'Review — read it through once.' : 'Step 1 — Read it carefully.';
      passage.textContent = verse.text;
      actions.append(el('button.btn', {
        text: 'I’ve read it →',
        onclick: () => { step = 1; render(); },
      }));
    } else if (step === 1) {
      hint.textContent = 'Step 2 — Now recite it using only the first letters. Tap to peek.';
      passage.innerHTML = '';
      passage.style.cursor = 'pointer';
      passage.title = 'Tap to reveal the full verse';
      passage.textContent = initials(verse.text);
      let revealed = false;
      passage.onclick = () => {
        revealed = !revealed;
        passage.textContent = revealed ? verse.text : initials(verse.text);
      };
      actions.append(
        el('button.btn', {
          text: 'I can say it →',
          onclick: () => { step = 2; passage.onclick = null; passage.style.cursor = ''; render(); },
        }),
        el('button.btn.ghost', {
          text: 'Show full verse',
          onclick: () => { passage.textContent = verse.text; },
        }),
      );
    } else {
      hint.textContent = mode === 'review' ? 'Did you remember it?' : 'Locked it in?';
      passage.textContent = verse.text;
      actions.append(
        el('button.btn', {
          text: mode === 'review' ? '✓ Got it — keep sharp' : '✓ I’ve memorized it',
          onclick: () => { markVerseLearned(verse.id); onComplete && onComplete(); },
        }),
        el('button.btn.secondary', {
          text: '↻ Practice again',
          onclick: () => { step = 0; render(); },
        }),
        onCancel ? el('button.btn.ghost', { text: 'Not now', onclick: onCancel }) : null,
      );
    }
  }

  render();
  return box;
}

/* Pick the next verse to serve: a due review first, else an unlearned verse. */
export function pickVerseToServe() {
  const due = getDueVerseIds();
  if (due.length) return { verse: getVerse(due[0]), mode: 'review' };
  const learned = new Set(getLearnedVerseIds());
  const fresh = VERSES.find((v) => !learned.has(v.id));
  if (fresh) return { verse: fresh, mode: 'learn' };
  // Everything learned & nothing due — re-serve the soonest review as practice.
  return { verse: VERSES[0], mode: 'review' };
}

export function renderMemorize() {
  const screen = el('section.screen');
  const scroll = el('div.scroll');
  screen.append(scroll); // attach first so insertBefore(topbar, scroll) is valid

  function showHub() {
    screen.querySelector('.topbar')?.remove();
    screen.insertBefore(topbar('Memorize / Earn', { onBack: () => go('/home') }), scroll);
    scroll.innerHTML = '';

    const learnedIds = getLearnedVerseIds();
    const dueIds = new Set(getDueVerseIds());

    scroll.append(el('p.muted.center', {
      text: 'Hide your word in your heart — and earn your way back into the game.',
    }));

    scroll.append(el('button.btn', {
      text: '➕ Learn / review a verse',
      onclick: startFlow,
    }));
    scroll.lastChild.style.cssText = 'display:block;width:100%;margin:14px 0;';

    scroll.append(el('div.section-head', { text: '📒 My Verses' }));
    if (!learnedIds.length) {
      scroll.append(el('p.muted', { text: 'No verses yet. Tap above to memorize your first one!' }));
    } else {
      for (const id of learnedIds) {
        const v = getVerse(id);
        if (!v) continue;
        scroll.append(row({
          emoji: dueIds.has(id) ? '🔔' : '✅',
          title: v.ref,
          sub: dueIds.has(id) ? 'Due for review' : v.text.slice(0, 48) + '…',
          pill: dueIds.has(id) ? { label: 'Review', kind: 'soon' } : null,
          onClick: () => startFlow(id),
        }));
      }
    }

    scroll.append(el('div.section-head', { text: '📖 Read the Bible (KJV)' }));
    scroll.append(el('p.muted', { text: 'A full KJV reader is coming soon. For now, here are the verses in this collection:' }));
    for (const v of VERSES) {
      const d = el('div.doodle-box');
      d.style.cssText += 'padding:12px 14px;margin-bottom:8px;';
      d.innerHTML = `<strong>${v.ref}</strong><br>${v.text}`;
      scroll.append(d);
    }
  }

  function startFlow(forceId) {
    const served = forceId ? { verse: getVerse(forceId), mode: 'review' } : pickVerseToServe();
    screen.querySelector('.topbar')?.remove();
    screen.insertBefore(topbar(served.mode === 'review' ? 'Review' : 'Memorize', { onBack: showHub }), scroll);
    scroll.innerHTML = '';
    scroll.append(buildMemorizer(served.verse, {
      mode: served.mode,
      onComplete: showHub,
      onCancel: showHub,
    }));
  }

  showHub();
  return screen;
}
