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
- Pull and push have separate sliders with fine low-end control and exact numeric fields, up to 3×.
- **M**: play or pause music. **B**: burst.
- **Space** or double-click the background: toggle fullscreen and hide controls.
- **H**: show or hide controls. **Escape**: restore controls.
- Choose a local audio file or microphone input. Music never starts automatically after reload; settings and playback position are remembered.

Camera activation requests normal browser permission. Tracking runs locally in a worker, with interpolation and bounded prediction. Camera and microphone input are not uploaded or recorded by the app. Selected audio files may be retained locally in IndexedDB.

## Visual modes

- **Røyk / Smoke:** a 2D incompressible fluid simulation with heat-driven buoyancy, pressure projection, vorticity confinement, and sharp advected smoke density.
- **Røykring / Smoke ring:** radial smoke emission from a ring.
- **Spektralrøyk / Spectral smoke:** frequency-directed emission, native-resolution filaments, and a bounded volumetric lighting pass.
- **Røyklys / Smoke light:** coloured smoke ribbons; seven frequency bands control emission and illumination.
- **Ild og is / Fire and ice:** folded warm and cool vortex bundles.
- **Airbender:** persistent particles controlled by hand forces.
- **Lysformer / Light shapes:** geometric music-reactive patterns.
- **Flaksefugl / Flapping bird:** a separate Canvas 2D flying game, controlled with hand flaps or keyboard input.

Seven palettes, native and 4K output, and particle counts up to **3,145,728** are available where GPU buffer limits permit. Automatic quality targets 60 FPS by adjusting particle count. Manual maximum density does not guarantee 60 FPS; tracking and rendering costs depend on hardware and viewport size. Native and 4K modes retain their output resolution.

Smoke mode uses a staggered velocity grid with a pressure solve, following the grid-fluid approach demonstrated by [Sebastian Lague’s Smoke-Simulation](https://github.com/SebLague/Smoke-Simulation). This is an original WGSL implementation, not a copy or Unity port. A separate, higher-resolution dye field uses limited MacCormack advection to retain smoke detail. The particle-count control is disabled for this mode. Hand motion stirs the fluid; pull/push add circulation and directional forces. Other smoke modes retain their particle-based renderers.

`tests/fluid.html` checks actual GPU pressure reduction, buoyancy, finite density, pause, and hand response. The velocity grid is bounded at 512×192 and the dye field at 2048×768, independently of native/4K output resolution.

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

Tracking uses [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js). Google Fonts are fetched by the page; the tracking model is downloaded during asset preparation.
