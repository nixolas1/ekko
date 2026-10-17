"""Local-only YouTube import service: python3 scripts/youtube-dev.py."""
from http.server import ThreadingHTTPServer
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('youtube_api', Path(__file__).resolve().parents[1] / 'api/youtube.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print('EKKO audio import: http://127.0.0.1:8765', flush=True)
ThreadingHTTPServer(('127.0.0.1', 8765), module.handler).serve_forever()
