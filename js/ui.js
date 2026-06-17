/* ui.js — tiny DOM helpers shared by all screens. No framework. */

import { go, back } from './router.js';

/**
 * el('div.foo.bar', { onclick, html, ... }, [children])
 * Tag string supports .class shortcuts. Props: text, html, on* handlers, attrs.
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'class') node.className += ' ' + v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else {
      node.setAttribute(k, v);
    }
  }

  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Standard top bar with a Back button, a title, and an optional corner slot. */
export function topbar(title, { onBack, corner } = {}) {
  return el('header.topbar', {}, [
    el('button.btn-back', { text: 'Back', onclick: onBack || (() => back()) }),
    el('h1.screen-title', { text: title }),
    el('div.spacer'),
    corner || null,
  ]);
}

/** A tappable list row used across Play/Learn/Read/Memorize. */
export function row({ emoji, title, sub, pill, locked, onClick }) {
  const node = el('button.row' + (locked ? '.locked' : ''), {
    onclick: locked ? null : onClick,
    disabled: locked ? '' : null,
  }, [
    emoji ? el('span.row-emoji', { text: emoji }) : null,
    el('span.row-text', {}, [
      el('span.row-title', { text: title }),
      sub ? el('span.row-sub', { text: sub }) : null,
    ]),
    pill ? el('span.pill' + (pill.kind ? '.' + pill.kind : ''), { text: pill.label }) : null,
    el('span.row-chev', { text: locked ? '' : '›' }),
  ]);
  return node;
}

export { go, back };
