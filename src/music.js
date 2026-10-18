// Hosted music library. Files live in public/audio and stay Git-ignored; npm run deploy
// includes them explicitly. See references/music.md for sources and hosting permission.
// Ids are stable: they are persisted in localStorage, so never rename one.
export const LOCAL_TRACKS = Object.freeze([
  { id: 'mitis-endeavors', title: 'Endeavors', artist: 'MitiS', src: '/audio/mitis-endeavors.webm', youtube: 'fpViZkhpPHk' },
  { id: 'mitis-shattered', title: 'Shattered (feat. RUNN)', artist: 'MitiS', src: '/audio/mitis-shattered.webm', youtube: 'lI5m0-oc9lI' },
  { id: 'mitis-wilderness', title: 'Wilderness (feat. KC)', artist: 'MitiS', src: '/audio/mitis-wilderness.webm', youtube: 'waOuUycRRYs' },
  { id: 'aqua-doctor-jones', title: 'Doctor Jones', artist: 'Aqua', src: '/audio/aqua-doctor-jones.webm', youtube: '-1jPUB7gRyg' },
  { id: 'polyphony-mc-nugget-yodel', title: 'mc nugget yodel', artist: 'polyphony_digital', src: '/audio/polyphony-digital-mc-nugget-yodel.webm', youtube: 'Jo2PuYWaNH8' },
  { id: 'dj-shadow-scale-it-back', title: 'Scale It Back (feat. Little Dragon)', artist: 'DJ Shadow', src: '/audio/dj-shadow-scale-it-back.webm', youtube: 'NL9ypNz9-mM' },
  { id: 'alec-troniq-pimpernuckel', title: 'Pimpernuckel', artist: 'Alec Troniq & Gabriel Vitel', src: '/audio/alec-troniq-pimpernuckel.webm', youtube: 'VG6ADGAVmDs' },
  { id: 'thefatrat-unity', title: 'Unity', artist: 'TheFatRat', src: '/audio/thefatrat-unity.webm', youtube: 'n8X9_MgEdCg' },
  { id: 'will-sparks-ah-yeah', title: 'Ah Yeah!', artist: 'Will Sparks', src: '/audio/will-sparks-ah-yeah.webm', youtube: 'VhFvRGK4pVY' },
  { id: 'otto-knows-million-voices', title: 'Million Voices', artist: 'Otto Knows', src: '/audio/otto-knows-million-voices.webm', youtube: 'S8jhXmfdRFY' },
  { id: 'jamie-xx-loud-places', title: 'Loud Places (feat. Romy)', artist: 'Jamie xx', src: '/audio/jamie-xx-loud-places.webm', youtube: 'kuOe4haCNgA' },
  { id: 'danny-take-me', title: 'TAKE ME', artist: 'D A N N Y', src: '/audio/danny-take-me.webm', youtube: '2YcPf0a4n0Q' },
  { id: 'felix-da-housecat-rocket-ride', title: 'Rocket Ride', artist: 'Felix Da Housecat', src: '/audio/felix-da-housecat-rocket-ride.webm', youtube: 'nfKrZbBEKWY' },
  { id: 'fred-again-solo', title: 'solo', artist: 'Fred again.. & Blanco', src: '/audio/fred-again-solo.webm', youtube: 'WgHndN5nThc' },
  { id: 'porter-robinson-madeon-shelter', title: 'Shelter', artist: 'Porter Robinson & Madeon', src: '/audio/porter-robinson-madeon-shelter.webm', youtube: 'HQnC1UHBvWA' },
  { id: 'madeon-icarus', title: 'Icarus', artist: 'Madeon', src: '/audio/madeon-icarus.webm', youtube: 'XHs99iVpnXU' },
  { id: 'mansionair-violet-city', title: 'Violet City', artist: 'Mansionair', src: '/audio/mansionair-violet-city.webm', youtube: 'miC82O_a5GI' },
  { id: 'the-acid-basic-instinct-thomas-jack', title: 'Basic Instinct (Thomas Jack Remix)', artist: 'The Acid', src: '/audio/the-acid-basic-instinct-thomas-jack.webm', youtube: 'cd_Kw-CU8fU' },
  { id: 'guru-josh-project-infinity', title: 'Infinity 2008 (Klaas Vocal Mix)', artist: 'Guru Josh Project', src: '/audio/guru-josh-project-infinity.webm', youtube: 'jzy2dgEUOhY' },
  { id: 'deadmau5-kaskade-i-remember', title: 'I Remember', artist: 'deadmau5 & Kaskade', src: '/audio/deadmau5-kaskade-i-remember.webm', youtube: 'zK1mLIeXwsQ' },
  { id: 'marmota-ezir-kara', title: 'Ezir-Kara (骏马黑鹰)', artist: '旱獭乐队', src: '/audio/marmota-ezir-kara.webm', youtube: 'AAuEAYa19K8' },
  { id: 'emma-jensen-somebody-else', title: 'Somebody Else (The 1975 cover, P3 Christine Live)', artist: 'Emma Jensen', src: '/audio/emma-jensen-somebody-else.webm', youtube: 'VxlQG8s24zI' },
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
