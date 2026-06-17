/* facts.js — Learn "fact snacks", grouped by subject. Seed set for Milestone 1. */

export const SUBJECTS = [
  { key: 'ela', label: 'English / Language Arts', emoji: '✏️' },
  { key: 'math', label: 'Math', emoji: '➗' },
  { key: 'science', label: 'Science', emoji: '🔬' },
  { key: 'history', label: 'History', emoji: '🏛️' },
  { key: 'geography', label: 'Geography', emoji: '🗺️' },
  { key: 'music', label: 'Music', emoji: '🎵' },
  { key: 'languages', label: 'Languages', emoji: '🗣️' },
  { key: 'bible', label: 'Bible', emoji: '📜' },
];

export const FACTS = {
  ela: [
    'A "pangram" is a sentence using every letter of the alphabet — "The quick brown fox jumps over the lazy dog."',
    'The dot over a lowercase i or j is called a "tittle."',
    '"Set" has more distinct definitions than any other English word — over 400.',
  ],
  math: [
    'Zero was used as a placeholder in Babylon, but India was first to treat it as a real number.',
    'A "googol" is 1 followed by 100 zeros — the company Google is a misspelling of it.',
    'The angles of any triangle always add up to 180° on a flat surface.',
  ],
  science: [
    'Honey never spoils — sealed jars in Egyptian tombs were still edible after 3,000 years.',
    'Sound travels about 4× faster in water than in air.',
    'A teaspoon of neutron star material would weigh about a billion tons.',
  ],
  history: [
    'Oxford University is older than the Aztec Empire — teaching there began before 1100.',
    'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
    'The shortest war in history lasted about 38 minutes (Britain vs. Zanzibar, 1896).',
  ],
  geography: [
    'Russia spans 11 time zones — more than any other country.',
    'Africa is the only continent in all four hemispheres.',
    'The Sahara Desert is roughly the size of the entire United States.',
  ],
  music: [
    'A standard piano has 88 keys: 52 white and 36 black.',
    'The "middle C" sits near the center of the keyboard at about 261.6 Hz.',
    'A "fermata" tells a musician to hold a note longer than its written value.',
  ],
  languages: [
    'Mandarin Chinese has the most native speakers of any language.',
    '"Hello" in Spanish is "Hola," in French "Bonjour," in Japanese "Konnichiwa."',
    'The hardest sounds for learners are often ones their native language lacks entirely.',
  ],
  bible: [
    'The Bible was written over roughly 1,500 years by around 40 different authors.',
    'Psalm 117 is the shortest chapter; Psalm 119 is the longest.',
    'The phrase "Fear not" appears many dozens of times throughout Scripture.',
  ],
};
