// Local demo music library. Files live in public/audio (git-ignored, local demonstration only; see references/music.md
// for sources and rights notes). Ids are stable: they are persisted in localStorage, so never rename one.
export const LOCAL_TRACKS = Object.freeze([
  { id: 'mitis-endeavors', title: 'Endeavors', artist: 'MitiS', src: '/audio/mitis-endeavors.webm' },
  { id: 'mitis-shattered', title: 'Shattered (feat. RUNN)', artist: 'MitiS', src: '/audio/mitis-shattered.webm' },
  { id: 'mitis-wilderness', title: 'Wilderness (feat. KC)', artist: 'MitiS', src: '/audio/mitis-wilderness.webm' },
  { id: 'aqua-doctor-jones', title: 'Doctor Jones', artist: 'Aqua', src: '/audio/aqua-doctor-jones.webm' },
  { id: 'polyphony-mc-nugget-yodel', title: 'mc nugget yodel', artist: 'polyphony_digital', src: '/audio/polyphony-digital-mc-nugget-yodel.webm' },
].map(Object.freeze));
// Saved preferences from before the library had a single fixed reference track: that track is Endeavors.
// Removed ids (country-roads-dance, country-roads-real-hypha) also resolve to it.
export const DEFAULT_TRACK_ID = 'mitis-endeavors';

export const trackById = id => LOCAL_TRACKS.find(track => track.id === id) ?? null;
export const trackLabel = track => `${track.artist} — ${track.title}`;
export const trackFileName = track => `${trackLabel(track).replace(/[\\/:*?"<>|]/g, '')}.webm`;
// Unknown or missing ids fall back to the default, so an old or tampered save still restores something local.
export const resolveTrackId = id => (trackById(id) ? id : DEFAULT_TRACK_ID);

export async function loadTrackFile(track, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(track.src);
  if (!response.ok) throw new Error(`«${trackLabel(track)}» is unavailable`);
  return new File([await response.blob()], trackFileName(track), { type: 'audio/webm' });
}
