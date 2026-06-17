/* tasks.js — the Play catalog.
   Grouped into sections (Fun!, Puzzles, Education). Each task:
     id        unique slug (used in #/play/:id and the game registry)
     title     display name
     emoji     little doodle stand-in
     blurb      one-line description
     section   'fun' | 'puzzles' | 'education'
     game      registry key, or null => "Coming soon"
     requires  optional taskId that must be done first (unlock chains)
*/

export const SECTIONS = [
  { key: 'fun', label: 'Fun!', emoji: '🎉' },
  { key: 'puzzles', label: 'Puzzles', emoji: '🧩' },
  { key: 'education', label: 'Education', emoji: '🎓' },
];

export const TASKS = [
  // ---- Fun! (chore/skill simulations + the playful games) ----
  { id: 'office-trash', title: 'Office Trash', emoji: '🗑️', section: 'fun',
    blurb: 'Be the janitor — empty the trash from every flagged office.', game: 'office-trash' },
  { id: 'job-site', title: 'Job Site', emoji: '🏗️', section: 'fun',
    blurb: 'Build a house from real materials, board by board, on a voxel lot.', game: 'job-site' },
  { id: 'drive', title: 'Drive', emoji: '🚗', section: 'fun',
    blurb: 'Learn the roads. Required before you can run the City.', game: null },
  { id: 'city', title: 'City', emoji: '🌆', section: 'fun',
    blurb: 'A whole city of errands and routes.', game: null, requires: 'drive' },
  { id: 'earth', title: 'Earth', emoji: '🌍', section: 'fun',
    blurb: 'The whole world to roam.', game: 'earth' },
  { id: 'clean-house', title: 'Clean House', emoji: '🧹', section: 'fun',
    blurb: 'Room by room, top to bottom.', game: null },
  { id: 'feed-pet', title: 'Feed Pet', emoji: '🐾', section: 'fun',
    blurb: 'Keep the critter happy, fed, and watered.', game: null },
  { id: 'farm', title: 'Farm', emoji: '🚜', section: 'fun',
    blurb: 'Plant, tend, and harvest before the season turns.', game: null },
  { id: 'cook-breakfast', title: 'Cook Breakfast', emoji: '🍳', section: 'fun',
    blurb: 'Get the morning order out hot.', game: null },
  { id: 'cook-lunch', title: 'Cook Lunch', emoji: '🥪', section: 'fun',
    blurb: 'The midday rush is on.', game: null },
  { id: 'cook-dinner', title: 'Cook Dinner', emoji: '🍝', section: 'fun',
    blurb: 'Plate the evening service.', game: null },
  { id: 'aldi', title: 'Aldi', emoji: '🛒', section: 'fun',
    blurb: 'Grab the list, bag fast, beat the line.', game: null },
  // moved here from the old Puzzles/Education sections (still fun to keep)
  { id: 'sliding-puzzle', title: 'Sliding Tiles', emoji: '🔢', section: 'fun',
    blurb: 'Slide the tiles back into order. Playable now!', game: 'sliding-puzzle' },
  { id: 'untangle', title: 'Untangle the Wires', emoji: '🧶', section: 'fun',
    blurb: 'Drag the nodes until no wires cross.', game: null },
  { id: 'pack-truck', title: 'Pack the Truck', emoji: '📦', section: 'fun',
    blurb: 'Fit every box. Tetris energy.', game: null },
  { id: 'library-shelve', title: 'Library Shelving', emoji: '📚', section: 'fun',
    blurb: 'Re-shelve the cart in the right order.', game: null },
  { id: 'parallel-park', title: 'Parallel Park', emoji: '🅿️', section: 'fun',
    blurb: 'Tuck it in on the first try.', game: null },

  // ---- Puzzles (Penny Press–style word & logic puzzles) ----
  { id: 'codewords', title: 'Codewords', emoji: '🔤', section: 'puzzles',
    blurb: 'Crossword grids where numbers stand in for letters — crack the cipher.', game: null },
  { id: 'cryptograms', title: 'Cryptograms', emoji: '🔐', section: 'puzzles',
    blurb: 'Decode a quote where every letter is swapped for another.', game: 'cryptograms' },
  { id: 'crypto-families', title: 'Crypto-Families', emoji: '🧬', section: 'puzzles',
    blurb: 'Lists of related words hidden behind a substitution code.', game: 'crypto-families' },
  { id: 'anagrams', title: 'Anagrams & With-a-Twist', emoji: '🔀', section: 'puzzles',
    blurb: 'Rearrange the letters of a word or phrase into brand-new words.', game: 'anagrams' },
  { id: 'syllacrostics', title: 'Syllacrostics', emoji: '🔡', section: 'puzzles',
    blurb: 'Build the answers by picking syllables from a provided list.', game: null },
  { id: 'crostics', title: 'Crostics / Anacrostics', emoji: '📜', section: 'puzzles',
    blurb: 'Answer clues to reveal a hidden quotation in the grid.', game: null },
  { id: 'quotefalls', title: 'Quotefalls', emoji: '⬇️', section: 'puzzles',
    blurb: 'Drop letters from the columns to fill in a mystery quote.', game: 'quotefalls' },
  { id: 'fill-ins', title: 'Fill-Ins / Frameworks', emoji: '🔳', section: 'puzzles',
    blurb: 'Clueless crosswords — fit the word list in by length alone.', game: null },
  { id: 'brick-by-brick', title: 'Brick by Brick', emoji: '🧱', section: 'puzzles',
    blurb: 'Arrange word-fragment bricks into a wall of text.', game: 'brick-by-brick' },
  { id: 'places-please', title: 'Places, Please', emoji: '📍', section: 'puzzles',
    blurb: 'Map thematic word lists into their exact spots in the grid.', game: null },
  { id: 'letterboxes', title: 'Letterboxes', emoji: '🔠', section: 'puzzles',
    blurb: 'Logic-based word games that play like small verbal mazes.', game: null },
  { id: 'diagramless', title: 'Diagramless', emoji: '◼️', section: 'puzzles',
    blurb: 'Deduce where the black squares go along with the answers.', game: null },
  { id: 'logic-problems', title: 'Logic Problems', emoji: '🧠', section: 'puzzles',
    blurb: 'Cross-reference clues to match every variable in the grid.', game: null },
  { id: 'logic-art', title: 'Logic Art', emoji: '🎨', section: 'puzzles',
    blurb: 'Shade cells by the rules to reveal a hidden pixel picture.', game: null },
  { id: 'sudoku', title: 'Sudoku & Jigsaw Sudoku', emoji: '🔢', section: 'puzzles',
    blurb: 'Classic 9×9 number placement, plus irregular-shape variants.', game: null },
  { id: 'kakuro', title: 'Cross Sums (Kakuro)', emoji: '➕', section: 'puzzles',
    blurb: 'Math crossword: digits must add to the clue, with no repeats.', game: null },
  { id: 'number-fill-in', title: 'Number Fill-In & Number Seek', emoji: '🔟', section: 'puzzles',
    blurb: 'Number twists on fill-ins and word searches.', game: null },
  { id: 'word-seek', title: 'Word Seek', emoji: '🔎', section: 'puzzles',
    blurb: 'Find hidden words across, down, and diagonally.', game: null },
  { id: 'missing-list-word-seek', title: 'Missing-List Word Seek', emoji: '🕵️', section: 'puzzles',
    blurb: 'A word search with no list — you find them blind.', game: null },

  // ---- Education (fun math + science games — to be defined) ----
];

export function getTask(id) {
  return TASKS.find((t) => t.id === id) || null;
}

export function tasksBySection(sectionKey) {
  return TASKS.filter((t) => t.section === sectionKey);
}
