/* quotes.js — short public-domain quotes/proverbs for the word puzzles
   (cryptograms, brick-by-brick, quotefalls). Kept short for playability.
   Sources: KJV Bible (public domain), Aesop, Poor Richard / Franklin,
   and common proverbs. */

export const QUOTES = [
  { text: 'A SOFT ANSWER TURNETH AWAY WRATH', source: 'Proverbs 15:1' },
  { text: 'PRIDE GOETH BEFORE A FALL', source: 'Proverbs 16:18' },
  { text: 'A MERRY HEART DOETH GOOD LIKE A MEDICINE', source: 'Proverbs 17:22' },
  { text: 'TRAIN UP A CHILD IN THE WAY HE SHOULD GO', source: 'Proverbs 22:6' },
  { text: 'THE TRUTH SHALL MAKE YOU FREE', source: 'John 8:32' },
  { text: 'LET YOUR LIGHT SO SHINE BEFORE MEN', source: 'Matthew 5:16' },
  { text: 'WELL DONE THOU GOOD AND FAITHFUL SERVANT', source: 'Matthew 25:21' },
  { text: 'WHATSOEVER A MAN SOWETH THAT SHALL HE REAP', source: 'Galatians 6:7' },
  { text: 'EARLY TO BED AND EARLY TO RISE', source: 'Poor Richard' },
  { text: 'LOST TIME IS NEVER FOUND AGAIN', source: 'Benjamin Franklin' },
  { text: 'A PENNY SAVED IS A PENNY EARNED', source: 'Benjamin Franklin' },
  { text: 'WELL DONE IS BETTER THAN WELL SAID', source: 'Benjamin Franklin' },
  { text: 'HASTE MAKES WASTE', source: 'Proverb' },
  { text: 'LOOK BEFORE YOU LEAP', source: 'Proverb' },
  { text: 'A STITCH IN TIME SAVES NINE', source: 'Proverb' },
  { text: 'ACTIONS SPEAK LOUDER THAN WORDS', source: 'Proverb' },
  { text: 'HONESTY IS THE BEST POLICY', source: 'Proverb' },
  { text: 'PRACTICE MAKES PERFECT', source: 'Proverb' },
  { text: 'FORTUNE FAVORS THE BOLD', source: 'Proverb' },
  { text: 'WHERE THERE IS A WILL THERE IS A WAY', source: 'Proverb' },
  { text: 'SLOW AND STEADY WINS THE RACE', source: 'Aesop' },
  { text: 'NO ACT OF KINDNESS IS EVER WASTED', source: 'Aesop' },
  { text: 'LOOK BEFORE YOU LEAP', source: 'Aesop' },
  { text: 'UNITED WE STAND DIVIDED WE FALL', source: 'Aesop' },
  { text: 'NECESSITY IS THE MOTHER OF INVENTION', source: 'Proverb' },
  { text: 'BETTER LATE THAN NEVER', source: 'Proverb' },
  { text: 'THE EARLY BIRD CATCHES THE WORM', source: 'Proverb' },
  { text: 'A FRIEND IN NEED IS A FRIEND INDEED', source: 'Proverb' },
  { text: 'KNOWLEDGE IS POWER', source: 'Francis Bacon' },
  { text: 'TO THINE OWN SELF BE TRUE', source: 'Shakespeare' },
];

export function pickQuote(maxLen) {
  const pool = maxLen ? QUOTES.filter((q) => q.text.length <= maxLen) : QUOTES;
  return pool[Math.floor(Math.random() * pool.length)];
}
