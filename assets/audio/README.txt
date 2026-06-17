Off Time — your music goes here
================================

1. In MuseScore: File → Export → choose MP3 → save the file.

2. Copy the .mp3 into this folder (assets/audio/).
   Example:  assets/audio/theme.mp3

3. Register it in  data/music.js  by adding a line to TRACKS, e.g.:

     export const TRACKS = [
       { id: 'theme', title: 'Off Time Theme', file: 'assets/audio/theme.mp3', showcase: true },
     ];

   - `showcase: true` makes it appear in Learn → Music ("My Music").

4. To use a track as background music, set it in the MUSIC block of data/music.js:

     export const MUSIC = {
       menu: 'theme',                       // plays on the intro + menus
       games: { 'office-trash': 'theme' },  // plays during a specific game
     };

That's it — no code changes needed. Tips:
- MP3 is best (small + plays everywhere). OGG/WAV also work if you change the file extension.
- Keep files reasonably small so the app stays quick to load and cache offline.
- Background music starts after your first tap (browsers block audio until you interact).
- Players can turn music off anytime in Settings.
