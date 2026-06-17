/* music.js — your music manifest.
   Drop MP3s into  assets/audio/  then list them here. That's the only edit needed.

   TRACKS: each composition.
     id        unique slug
     title     shown in the "My Music" showcase (Learn → Music)
     file      path to the MP3, e.g. 'assets/audio/theme.mp3'
     showcase  true => appears in the "My Music" listen list
   MUSIC: where tracks play.
     menu      trackId for background on intro/menus (or null for silence)
     games     { taskId: trackId } background while playing that game

   Example (uncomment and point at a real file once you've exported one):
   // { id: 'theme', title: 'Off Time Theme', file: 'assets/audio/theme.mp3', showcase: true },
*/

export const TRACKS = [
  { id: 'etude-eb', title: 'Etude in E♭ Major', file: 'assets/audio/Etude in Eb Major.mp3', showcase: true },
];

export const MUSIC = {
  menu: null,          // background off for now — set to 'etude-eb' to bring it back
  games: {
    // 'office-trash': 'etude-eb',
    // 'sliding-puzzle': 'some-track-id',
  },
};

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || null;
}
