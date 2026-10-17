"""GET /api/youtube?url=<YouTube URL> returns the audio-only track of one YouTube video as audio/mp4 or audio/webm.

The browser cannot read audio out of a YouTube embed (cross-origin, no spectrum), and googlevideo media URLs are
bound to the IP that extracted them, so this function extracts and downloads with yt-dlp, then sends the bytes.
yt-dlp downloads itself: proxying the extracted URLs with a separate HTTP client was refused (403) by googlevideo
in local tests, while yt-dlp's own downloader succeeded every time.

Safety:
- Only a validated 11-character video id survives; yt-dlp always gets a URL rebuilt from it, never user input.
- Optional EKKO_YOUTUBE_ALLOWED_IDS restricts imports; otherwise public single-video links are accepted.
- The selected media URL must be https://*.googlevideo.com; size, duration and format are bounded.
- No cookies, no login, no DRM formats. Failures are JSON {error, code} with a matching status.
"""
import json
import os
import re
import shutil
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler

# Deno (yt-dlp's JS runtime for YouTube's player challenges) needs a writable cache; only /tmp is writable on Vercel.
os.environ.setdefault('DENO_DIR', '/tmp/deno')
os.environ.setdefault('XDG_CACHE_HOME', '/tmp')

# The five recordings the owner has confirmed permission to host (see references/music.md).
DEFAULT_ALLOWED_IDS = ('fpViZkhpPHk', 'lI5m0-oc9lI', 'waOuUycRRYs', '-1jPUB7gRyg', 'Jo2PuYWaNH8')
MAX_BYTES = 40 * 1024 * 1024
MAX_DURATION = 20 * 60
MAX_INPUT = 2048
TIMEOUT = 20
# Audio-only itags, AAC/M4A first (every browser with Web Audio decodes it), Opus/WebM as fallback.
FORMAT = '140/251/250/249/139'
MIME = {'m4a': 'audio/mp4', 'webm': 'audio/webm'}

VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
WATCH_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'}
EMBED_HOSTS = {'youtube-nocookie.com', 'www.youtube-nocookie.com'}
SHORT_HOSTS = {'youtu.be', 'www.youtu.be'}
PATH_PREFIXES = ('shorts', 'live', 'embed', 'v')


class ImportFailure(Exception):
  def __init__(self, status, code, message):
    super().__init__(message)
    self.status, self.code, self.message = status, code, message


def parse_video_id(value):
  """Returns the video id of a YouTube watch/short/embed/youtu.be URL (or a bare id), else raises ImportFailure."""
  if not isinstance(value, str) or not value.strip():
    raise ImportFailure(400, 'missing-url', 'Paste a YouTube link.')
  value = value.strip()
  if len(value) > MAX_INPUT:
    raise ImportFailure(400, 'bad-url', 'That link is too long.')
  if VIDEO_ID.match(value):
    return value
  if not re.match(r'^[a-z][a-z0-9+.-]*://', value, re.I):
    value = 'https://' + value
  try:
    url = urllib.parse.urlsplit(value)
    port = url.port
  except ValueError:
    raise ImportFailure(400, 'bad-url', 'That is not a valid link.')
  host = (url.hostname or '').lower()
  if url.scheme.lower() not in ('http', 'https') or url.username is not None or url.password is not None or port not in (None, 80, 443):
    raise ImportFailure(400, 'bad-url', 'Only plain YouTube links are supported.')
  parts = [p for p in url.path.split('/') if p]
  candidate = None
  if host in SHORT_HOSTS:
    candidate = parts[0] if len(parts) == 1 else None
  elif host in WATCH_HOSTS or host in EMBED_HOSTS:
    if host in WATCH_HOSTS and parts == ['watch']:
      values = urllib.parse.parse_qs(url.query).get('v', [])
      candidate = values[0] if len(values) == 1 else None
    elif len(parts) == 2 and parts[0] in PATH_PREFIXES and (host in WATCH_HOSTS or parts[0] == 'embed'):
      candidate = parts[1]
  else:
    raise ImportFailure(400, 'not-youtube', 'Only youtube.com and youtu.be links are supported.')
  if not candidate or not VIDEO_ID.match(candidate):
    raise ImportFailure(400, 'bad-url', 'That YouTube link does not point to a single video.')
  return candidate


def allowed_ids():
  """None means any video; otherwise the set of permitted ids."""
  raw = os.environ.get('EKKO_YOUTUBE_ALLOWED_IDS', '').strip()
  if not raw or raw == '*':
    return None
  return {i.strip() for i in raw.split(',') if VIDEO_ID.match(i.strip())} if raw else set(DEFAULT_ALLOWED_IDS)


def check_allowed(video_id):
  ids = allowed_ids()
  if ids is not None and video_id not in ids:
    raise ImportFailure(403, 'not-allowed', 'This site only imports the recordings its owner has permission to host.')


def is_media_url(value):
  try:
    url = urllib.parse.urlsplit(value)
    port = url.port
  except ValueError:
    return False
  host = (url.hostname or '').lower()
  return url.scheme == 'https' and port in (None, 443) and url.username is None and host.endswith('.googlevideo.com')


def classify(message):
  text = (message or '').lower()
  if 'not a bot' in text:
    return ImportFailure(503, 'youtube-blocked', 'YouTube refused this server (bot check). Import needs a different host or a self-hosted extractor.')
  if re.search(r'confirm your age|age[- ]restricted|inappropriate for some users', text):
    return ImportFailure(403, 'age-restricted', 'This video is age-restricted and cannot be imported without signing in.')
  if 'drm' in text:
    return ImportFailure(422, 'drm', 'This video is DRM-protected and cannot be imported.')
  if 'requested format is not available' in text:
    return ImportFailure(422, 'no-audio', 'YouTube offered no plain audio track for this video.')
  if 'file is larger than max-filesize' in text or 'max-filesize' in text:
    return ImportFailure(413, 'too-large', 'The audio track is too large to import.')
  if 'http error 403' in text:
    return ImportFailure(503, 'youtube-blocked', 'YouTube refused the audio download from this server. Try again later.')
  if 'private' in text or 'unavailable' in text or 'not available' in text or 'removed' in text or 'terminated' in text:
    return ImportFailure(404, 'unavailable', 'This video is private, removed or not available here.')
  return ImportFailure(502, 'extract-failed', 'YouTube audio could not be extracted right now.')


class _QuietLogger:
  def debug(self, msg): pass
  def info(self, msg): pass
  def warning(self, msg): pass
  def error(self, msg): pass


def check_selection(info, video_id):
  """Rejects anything but a finite, DRM-free, audio-only https download from googlevideo within the limits."""
  if not info or info.get('id') != video_id:
    raise ImportFailure(502, 'extract-failed', 'YouTube returned an unexpected answer.')
  if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
    raise ImportFailure(422, 'live', 'Live streams cannot be imported.')
  duration = info.get('duration')
  if not isinstance(duration, (int, float)) or duration <= 0 or duration > MAX_DURATION:
    raise ImportFailure(413, 'too-long', f'Only videos up to {MAX_DURATION // 60} minutes can be imported.')
  if (info.get('vcodec') != 'none' or info.get('acodec') in (None, 'none') or info.get('has_drm') or info.get('protocol') != 'https'
      or info.get('ext') not in MIME or not is_media_url(info.get('url', ''))):
    raise ImportFailure(422, 'no-audio', 'YouTube offered no plain audio track for this video.')
  size = info.get('filesize') or info.get('filesize_approx')
  if size and size > MAX_BYTES:
    raise ImportFailure(413, 'too-large', 'The audio track is too large to import.')


def download_audio(video_id, workdir):
  """Returns (info, path). Imports yt-dlp lazily so validation errors stay cheap."""
  import yt_dlp
  options = {'quiet': True, 'no_warnings': True, 'noprogress': True, 'logger': _QuietLogger(), 'noplaylist': True,
             'cachedir': False, 'format': FORMAT, 'max_filesize': MAX_BYTES, 'socket_timeout': TIMEOUT,
             'retries': 1, 'extractor_retries': 1, 'overwrites': True, 'outtmpl': {'default': os.path.join(workdir, 'audio.%(ext)s')}}
  try:
    import deno
    options['js_runtimes'] = {'deno': {'path': deno.find_deno_bin()}}
  except Exception:
    pass  # yt-dlp falls back to a runtime on PATH, or reports the video as unavailable.
  try:
    with yt_dlp.YoutubeDL(options) as ydl:
      info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
      check_selection(info, video_id)
      ydl.process_info(info)
  except yt_dlp.utils.DownloadError as error:
    raise classify(str(error))
  path = os.path.join(workdir, f"audio.{info['ext']}")
  size = os.path.getsize(path) if os.path.isfile(path) else 0
  if size == 0:
    raise ImportFailure(502, 'media-failed', 'YouTube sent no audio data.')
  if size > MAX_BYTES:
    raise ImportFailure(413, 'too-large', 'The audio track is too large to import.')
  return info, path


def safe_header(value, limit=200):
  return urllib.parse.quote(str(value or '')[:limit], safe=' ')


class handler(BaseHTTPRequestHandler):
  def _json(self, status, payload):
    body = json.dumps(payload).encode('utf-8')
    self.send_response(status)
    self.send_header('Content-Type', 'application/json; charset=utf-8')
    self.send_header('Content-Length', str(len(body)))
    self.send_header('Cache-Control', 'no-store')
    self.send_header('X-Content-Type-Options', 'nosniff')
    self.end_headers()
    self.wfile.write(body)

  def do_GET(self):
    workdir = None
    try:
      query = urllib.parse.urlsplit(self.path).query
      if len(query) > MAX_INPUT * 3:
        raise ImportFailure(400, 'bad-url', 'That link is too long.')
      values = urllib.parse.parse_qs(query).get('url', [])
      if len(values) != 1:
        raise ImportFailure(400, 'missing-url', 'Paste a YouTube link.')
      video_id = parse_video_id(values[0])
      check_allowed(video_id)
      workdir = tempfile.mkdtemp(prefix='ekko-yt-', dir=tempfile.gettempdir())
      info, path = download_audio(video_id, workdir)
      size = os.path.getsize(path)
      self.send_response(200)
      self.send_header('Content-Type', MIME[info['ext']])
      self.send_header('Content-Length', str(size))
      self.send_header('Cache-Control', 'no-store')
      self.send_header('X-Content-Type-Options', 'nosniff')
      self.send_header('X-Ekko-Video-Id', video_id)
      self.send_header('X-Ekko-Title', safe_header(info.get('title')))
      self.send_header('X-Ekko-Channel', safe_header(info.get('channel') or info.get('uploader')))
      self.send_header('X-Ekko-Duration', str(int(info['duration'])))
      self.end_headers()
      with open(path, 'rb') as media:
        shutil.copyfileobj(media, self.wfile, 256 * 1024)
    except ImportFailure as error:
      self._json(error.status, {'error': error.message, 'code': error.code})
    except (BrokenPipeError, ConnectionResetError):
      pass
    except Exception:
      self._json(500, {'error': 'The YouTube import failed unexpectedly.', 'code': 'internal'})
    finally:
      if workdir:
        shutil.rmtree(workdir, ignore_errors=True)

  def do_HEAD(self):
    self._json(405, {'error': 'Use GET.', 'code': 'method'})

  def do_POST(self):
    self._json(405, {'error': 'Use GET.', 'code': 'method'})

  def log_message(self, format, *args):
    pass  # Never log user-supplied URLs.
