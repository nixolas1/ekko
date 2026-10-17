// YouTube link import: asks /api/youtube (api/youtube.py) for the video's audio-only track and returns it as a File,
// so it goes through the same AudioInput.file() path, analyser and spectrum as an uploaded file. An embed cannot do
// this: its audio is cross-origin and never reaches Web Audio. Nothing here plays anything; the caller decides
// (use AudioInput.file(file, {autoplay:false}) to keep the "music opens paused" rule).
// A deployment may optionally restrict video IDs with EKKO_YOUTUBE_ALLOWED_IDS.

export const YOUTUBE_ENDPOINT = '/api/youtube';
export const MAX_YOUTUBE_BYTES = 40 * 1024 * 1024;
const MAX_INPUT = 2048;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const EMBED_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const PATH_PREFIXES = new Set(['shorts', 'live', 'embed', 'v']);
const EXTENSIONS = { 'audio/mp4': 'm4a', 'audio/webm': 'webm' };

export class YouTubeImportError extends Error {
  constructor(code, message, status = 0, cause) {
    super(message);
    this.name = 'YouTubeImportError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

// Same rules as parse_video_id in api/youtube.py: watch, shorts, live, embed, youtu.be links or a bare id.
export function parseYouTubeVideoId(input) {
  if (typeof input !== 'string' || !input.trim()) throw new YouTubeImportError('missing-url', 'Paste a YouTube link.');
  let value = input.trim();
  if (value.length > MAX_INPUT) throw new YouTubeImportError('bad-url', 'That link is too long.');
  if (VIDEO_ID.test(value)) return value;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try { url = new URL(value); } catch { throw new YouTubeImportError('bad-url', 'That is not a valid link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['', '80', '443'].includes(url.port))
    throw new YouTubeImportError('bad-url', 'Only plain YouTube links are supported.');
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let candidate = null;
  if (SHORT_HOSTS.has(host)) candidate = parts.length === 1 ? parts[0] : null;
  else if (WATCH_HOSTS.has(host) || EMBED_HOSTS.has(host)) {
    if (WATCH_HOSTS.has(host) && parts.length === 1 && parts[0] === 'watch') {
      const values = url.searchParams.getAll('v');
      candidate = values.length === 1 ? values[0] : null;
    } else if (parts.length === 2 && PATH_PREFIXES.has(parts[0]) && (WATCH_HOSTS.has(host) || parts[0] === 'embed')) candidate = parts[1];
  } else throw new YouTubeImportError('not-youtube', 'Only youtube.com and youtu.be links are supported.');
  if (!candidate || !VIDEO_ID.test(candidate)) throw new YouTubeImportError('bad-url', 'That YouTube link does not point to a single video.');
  return candidate;
}

// Only the canonical watch URL is sent: tracking parameters and playlists never leave the browser.
export const youtubeWatchUrl = id => `https://www.youtube.com/watch?v=${id}`;
export const youtubeImportUrl = (input, endpoint = YOUTUBE_ENDPOINT) => `${endpoint}?url=${encodeURIComponent(youtubeWatchUrl(parseYouTubeVideoId(input)))}`;

const decodeHeader = value => { try { return decodeURIComponent(value || ''); } catch { return ''; } };
const fileName = (title, id, type) => `${(title || `YouTube ${id}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120) || id}.${EXTENSIONS[type] || 'audio'}`;

async function failure(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      const body = await response.json();
      if (body && typeof body.error === 'string') return new YouTubeImportError(String(body.code || 'failed'), body.error, response.status);
    } catch {}
  }
  if (response.status === 404 || type.includes('text/html'))
    return new YouTubeImportError('no-api', 'YouTube import is not available on this server. It needs the /api/youtube function (vercel dev or a Vercel deployment).', response.status);
  return new YouTubeImportError('failed', `YouTube import failed (HTTP ${response.status}).`, response.status);
}

// Resolves { file, videoId, title, channel, duration }. onProgress(received, total|null) is called while downloading.
export async function importYouTubeAudio(input, { fetchImpl = globalThis.fetch, signal, endpoint = YOUTUBE_ENDPOINT, maxBytes = MAX_YOUTUBE_BYTES, onProgress } = {}) {
  const videoId = parseYouTubeVideoId(input);
  let response;
  try {
    response = await fetchImpl(youtubeImportUrl(videoId, endpoint), { signal, credentials: 'same-origin', headers: { Accept: 'audio/*' } });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new YouTubeImportError('network', 'Could not reach the YouTube import service. Check your connection.', 0, error);
  }
  if (!response.ok) throw await failure(response);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^audio\//.test(type)) throw await failure(response);
  const lengthHeader = response.headers.get('content-length');
  const total = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
  if (total !== null && total > maxBytes) throw new YouTubeImportError('too-large', 'The audio track is too large to import.', response.status);

  const chunks = [];
  let received = 0;
  const add = chunk => {
    received += chunk.byteLength;
    if (received > maxBytes) throw new YouTubeImportError('too-large', 'The audio track is too large to import.', response.status);
    chunks.push(chunk);
    onProgress?.(received, total);
  };
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; add(value); }
    } catch (error) {
      try { await reader.cancel(); } catch {}
      if (error instanceof YouTubeImportError || error?.name === 'AbortError') throw error;
      throw new YouTubeImportError('truncated', 'The YouTube audio download was interrupted. Try again.', response.status, error);
    }
  } else add(new Uint8Array(await response.arrayBuffer()));
  if (received === 0) throw new YouTubeImportError('empty', 'The YouTube import returned no audio.', response.status);
  if (total !== null && received !== total) throw new YouTubeImportError('truncated', 'The YouTube audio download was cut short. Try again.', response.status);

  const title = decodeHeader(response.headers.get('x-ekko-title'));
  const channel = decodeHeader(response.headers.get('x-ekko-channel'));
  const duration = Number(response.headers.get('x-ekko-duration')) || null;
  const file = new File(chunks, fileName(title, videoId, type), { type });
  return { file, videoId, title, channel, duration };
}
