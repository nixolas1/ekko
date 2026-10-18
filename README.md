# EKKO

A music-reactive WebGPU particle visualizer controlled with your hands. Smoke, luminous ribbons, spectral rings, and folded vortices respond to audio and hand gestures.

## Run locally

```sh
npm ci
npm run assets
npm run dev
```

Open http://127.0.0.1:5173/ in a browser with WebGPU and hardware acceleration. Localhost or HTTPS is required. Asset preparation bundles the tracking worker, copies MediaPipe WASM, and downloads Google's Hand Landmarker model if missing.

```sh
npm test
npm run build
```

The production output is in `dist/`. Browser GPU checks are available under `tests/`, including `reference.html`, `spectral.html`, `emission.html`, and `forces.html` when running the development server.

## Controls

- Closed hand: pull particles into orbit. Open hand: push them away. Opening a closed hand also triggers a burst.
- One Hand force slider sets pull and push together, with fine low-end control up to 3×. Move the mouse over the scene to repel smoke and particles within a soft radius; it never attracts.
- **Space** (or **M**): play or pause music. **B**: burst.
- **Enter**, **F**, or double-click the background: toggle fullscreen and hide controls.
- **H**: show or hide controls. **Escape**: restore controls.
- Choose a local audio file or microphone input. Music never starts automatically after reload; settings and playback position are remembered.

Camera activation requests normal browser permission. Tracking runs locally in a worker, with interpolation and bounded prediction. Camera and microphone input are not uploaded or recorded by the app. Selected audio files may be retained locally in IndexedDB.

## Visual modes

- **Fluid smoke:** a 2D incompressible fluid simulation with heat-driven buoyancy, pressure projection, vorticity confinement, and sharp advected smoke density.
- **Fluid ring:** pressure-projected fluid jets plus native-resolution tracers. Nine independently measured frequency bands run clockwise from bass at the upper left (135°, then 40° steps). Each note attack drives an outward burst; transported light fades after the note ends.
- **Particle ring:** the original particle ring remains available.
- **Spectral smoke:** frequency-directed emission, native-resolution filaments, and a bounded volumetric lighting pass.
- **Smoke light / Original:** coloured smoke ribbons; seven frequency bands control emission and illumination.
- **Smoke light / Lasting glow:** a separate version of Røyklys with continuous dim neutral smoke and note brightness captured at birth, carried along the ribbon, then faded with age. The original Røyklys is unchanged for comparison.
- **Fire & ice:** folded warm and cool vortex bundles.
- **Airbender:** persistent particles controlled by hand forces.
- **Light shapes:** geometric music-reactive patterns.

Every menu section collapses. Each mode has its own settings, collapsed by default: speed and glow, plus turbulence/emission where supported. Settings persist per mode and the current mode’s values travel in shared links.

Audio response also multiplies fluid-ring launch momentum independently of the capped visual envelope. The first two bass sectors receive extra onset impulse. Rainbow maps them to red/orange; other palettes remain selectable.

Seven palettes, native and 4K output, and particle counts up to **3,145,728** are available where GPU buffer limits permit. Automatic quality targets 60 FPS by adjusting particle count. Manual maximum density does not guarantee 60 FPS; tracking and rendering costs depend on hardware and viewport size. Native and 4K modes retain their output resolution.

Smoke mode uses a staggered velocity grid with a pressure solve, following the grid-fluid approach demonstrated by [Sebastian Lague’s Smoke-Simulation](https://github.com/SebLague/Smoke-Simulation). This is an original WGSL implementation, not a copy or Unity port. A separate, higher-resolution dye field uses limited MacCormack advection to retain smoke detail. The particle-count control is disabled for the two fluid modes; ring detail is bounded to 262,144 tracers. Hand motion stirs the fluid; pull/push add circulation and directional forces. Other smoke modes retain their particle-based renderers. An advected emissive field and HDR bloom provide persistent local light without flashing all the smoke on every beat.

`tests/fluid.html` checks actual GPU pressure reduction, buoyancy, finite density, pause, hand response, nine isolated emission directions, silent-band suppression, and carried-light decay. The velocity grid is bounded at 512×192 and the dye field at 2048×768, independently of native/4K output resolution.

## Shareable settings

The address updates as controls change. **Copy link** copies the current setup. Links override saved preferences only for parameters they contain; unrecognised/invalid values are ignored. Opening a link or refreshing loads music paused. Selecting a song starts it immediately. Local file bytes and microphone access cannot be shared by URL.

For example: `/?mode=fluid-ring&palette=3&song=mitis-endeavors&t=45&force=0.05&gain=2.8`.

Supported keys: `mode`, `song` (library ID), `source` (`reference`, `demo`, `file`, `mic`, `youtube`), `t` (seconds), `count`, `auto` (0/1), `resolution` (`native`, `4k`, `auto`), `force`, `hands`, `palette`, `effect`, `gain`, `persistent`, `speed`, `glow`, `turbulence`, `emission`, and `immersive` (0/1). Immersive hides controls; entering browser fullscreen still requires a gesture. The current playhead updates once per second; changes replace the address without filling browser history.

## Project layout

- `src/gpu.js`: WebGPU resources and render passes.
- `src/*.wgsl`: particle simulation, rendering, and post-processing.
- `src/audio.js`, `src/audio-controls.js`: Web Audio analysis and frequency envelopes.
- `src/tracking.js`, `src/tracking-worker.js`: MediaPipe hand tracking.
- `src/main.js`: UI, animation, and input coordination.
- `tests/`: automated Node tests and interactive browser GPU checks.

## Music and references

The named song presets refer to audio files in `public/audio/`. The owner has confirmed permission to host the five current recordings on the deployed site. They remain excluded from Git, so a fresh clone needs its own permitted copies or the local audio-file picker / microphone. See [music notes](references/music.md) for filenames and source attribution. Reference screenshots, generated assets, test captures, and local agent logs are excluded from Git.

Vite copies local `public/audio/` files into `dist/` when they exist. Include only audio you have permission to distribute when publishing a built site.

Visual inspiration: [Particle tests (15) 3D Music Visualizer, MatthiasM.de](https://www.youtube.com/watch?v=fpViZkhpPHk). Reference video frames are not app assets and are not included in this repository.

Tracking uses [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js). Fonts are served locally; the tracking model is downloaded during asset preparation.

### YouTube links

Choose **YouTube**, paste a single-video link and select **Load audio**. The five existing music links reuse the hosted library. Other links use `/api/youtube` to import actual AAC/Opus into Web Audio, so spectrum, note attacks and microphone-independent playback all work. Loading and refresh never start playback. Links include the video ID as `youtube` and the playhead as `t`.

The Python API uses pinned yt-dlp plus its Deno runtime, accepts public audio tracks up to 20 minutes / 40 MiB, and deletes temporary files after each response. It does not use YouTube embeds, browser cookies or login. Private/age-restricted/unavailable videos and server bot checks return an explicit error. Production verification on 18 October 2026 returned `503 youtube-blocked` from YouTube on Vercel; arbitrary-video imports currently work locally, while the five hosted library links work on Vercel. A separately hosted extractor would be needed for arbitrary links on the public site. The optional `EKKO_YOUTUBE_ALLOWED_IDS` environment variable can restrict imports to comma-separated video IDs.

Vite alone does not run the Python API: use `vercel dev` for the complete app, or run `python3 scripts/youtube-dev.py` beside Vite after installing `requirements.txt`. Known library links work in either setup.

### Audio from another browser tab

Choose **Tab audio → Share tab** in Music, select the tab playing your video, and enable **Share tab audio** in the browser picker. Desktop Chrome or Edge is recommended; browsers or selected surfaces without an audio track show a clear error. Keep playing/pausing the video in its original tab. EKKO feeds the captured audio into the same analyser as library music, including all frequency-driven smoke, bass impulses and note lighting. No download, transcoding, microphone, recording or upload is needed.

**Stop sharing** (or Space/M while Tab audio is selected) disconnects EKKO; it does not pause the original video. Browser capture requires a display track, which EKKO requests at low resolution and one frame per second, and never renders or transmits. Switching audio sources or leaving the page releases all capture tracks. Refresh and shared links can remember `source=tab`, but never start capture or open a picker automatically.

Particle ring accelerates with measured bass intensity. Fluid smoke uses stronger upward bass-onset jets on the left, with higher-frequency emitters continuing to the right. Spectral smoke distributes nine frequency sectors around the full circle, with dim smoke between notes.

Airbender and Light shapes have a **Particle visibility** setting under their mode settings, saved separately for each mode and shared as `visibility` in the URL. It controls direct particle brightness independently of Glow. Fullscreen retains a small translucent mouse-position dot.
