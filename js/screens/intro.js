/* intro.js — the opening scene: stick figure at a cluttered desk, back to viewer,
   who looks over its shoulder and speaks. Three speech beats, then off to Home. */

import { el, go } from '../ui.js';
import { state } from '../state.js';

const LINES = [
  'Oh! Hello!',
  'Do you need something to do?',
  'Great! Let me give you a task...',
];

function deskSVG() {
  // A simple, friendly doodle: desk with clutter; figure seen from behind.
  // .fig-head is targeted by the .look animation (peek over shoulder).
  const wrap = el('div.intro-stage');
  wrap.innerHTML = `
    <svg viewBox="0 0 360 320" role="img" aria-label="A stick figure working at a cluttered desk">
      <g fill="none" stroke="#2b2b2b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
        <!-- desk top -->
        <line x1="20" y1="250" x2="340" y2="250"/>
        <line x1="40" y1="250" x2="40" y2="312"/>
        <line x1="320" y1="250" x2="320" y2="312"/>
        <!-- clutter: lamp -->
        <path d="M70 250 L70 200 L92 178" />
        <path d="M80 170 a12 12 0 1 0 24 0 z" fill="#ffe08a"/>
        <!-- papers -->
        <rect x="120" y="236" width="40" height="14" rx="2" fill="#fff"/>
        <rect x="128" y="228" width="40" height="14" rx="2" fill="#fff"/>
        <!-- coffee mug -->
        <rect x="250" y="226" width="26" height="24" rx="3" fill="#fff"/>
        <path d="M276 230 a8 8 0 0 1 0 16"/>
        <path d="M258 220 q3 -8 0 -14 M268 220 q3 -8 0 -14" stroke-width="3"/>
        <!-- pencil cup -->
        <rect x="300" y="224" width="20" height="26" rx="3" fill="#fff"/>
        <line x1="305" y1="224" x2="303" y2="206"/>
        <line x1="312" y1="224" x2="314" y2="202"/>
        <!-- chair back -->
        <rect x="150" y="150" width="70" height="100" rx="10" fill="#fff"/>
        <!-- figure: body seen from behind, sitting -->
        <line x1="185" y1="150" x2="185" y2="120"/>
        <circle class="fig-head" cx="185" cy="100" r="22" fill="#f4efe1"/>
        <!-- arms reaching to desk -->
        <path d="M170 165 L140 235" />
        <path d="M200 165 L228 235" />
      </g>
    </svg>`;
  return wrap;
}

export function renderIntro() {
  let beat = 0;

  const screen = el('section.screen.intro');
  const stage = deskSVG();

  const speech = el('div.speech', { text: LINES[0] });
  const dots = el('div.intro-dots', {}, LINES.map((_, i) =>
    el('i' + (i === 0 ? '.on' : ''))
  ));

  const nextBtn = el('button.btn', { text: 'Next' });
  const skipBtn = el('button.btn.ghost', {
    text: 'Skip',
    onclick: finish,
  });

  const controls = el('div.intro-controls', {}, [skipBtn, nextBtn]);

  function advance() {
    beat += 1;
    if (beat >= LINES.length) return finish();
    speech.textContent = LINES[beat];
    // re-trigger pop-in animation
    speech.style.animation = 'none';
    void speech.offsetWidth;
    speech.style.animation = '';
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i <= beat));
    if (beat === LINES.length - 1) nextBtn.textContent = "Let's go!";
  }

  nextBtn.addEventListener('click', advance);

  function finish() {
    state.set('introSeen', true);
    go('/home');
  }

  // The character peeks over its shoulder as it first speaks.
  stage.classList.add('look');

  screen.append(stage, speech, dots, controls);
  return screen;
}
