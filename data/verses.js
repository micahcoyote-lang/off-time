/* verses.js — seed KJV verses (public domain) for Memorize/Earn.
   id is stable (used as the storage key for learned/review tracking). */

export const VERSES = [
  { id: 'john-3-16', ref: 'John 3:16',
    text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
  { id: 'prov-3-5', ref: 'Proverbs 3:5',
    text: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.' },
  { id: 'prov-3-6', ref: 'Proverbs 3:6',
    text: 'In all thy ways acknowledge him, and he shall direct thy paths.' },
  { id: 'phil-4-13', ref: 'Philippians 4:13',
    text: 'I can do all things through Christ which strengtheneth me.' },
  { id: 'psalm-23-1', ref: 'Psalm 23:1',
    text: 'The LORD is my shepherd; I shall not want.' },
  { id: 'rom-8-28', ref: 'Romans 8:28',
    text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.' },
  { id: 'josh-1-9', ref: 'Joshua 1:9',
    text: 'Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.' },
  { id: 'isa-40-31', ref: 'Isaiah 40:31',
    text: 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.' },
  { id: 'matt-6-33', ref: 'Matthew 6:33',
    text: 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.' },
  { id: 'psalm-119-105', ref: 'Psalm 119:105',
    text: 'Thy word is a lamp unto my feet, and a light unto my path.' },
  { id: 'phil-4-6', ref: 'Philippians 4:6',
    text: 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.' },
  { id: 'gen-1-1', ref: 'Genesis 1:1',
    text: 'In the beginning God created the heaven and the earth.' },
];

export function getVerse(id) {
  return VERSES.find((v) => v.id === id) || null;
}
