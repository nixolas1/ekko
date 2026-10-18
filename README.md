# EKKO

**Sound into smoke. Your hands into motion.**

EKKO is an interactive music visualizer built with WebGPU. Bass launches jets of smoke, high notes light up fine ribbons, and your hands gather, twist and scatter the scene. It runs in the browser, with fluid simulation, millions of particles, and glowing light calculated on your GPU.

![Rainbow smoke ribbons glowing as they rise and fold](docs/images/smoke-light.jpg)

*Smoke light · Original — a million particles turning the audio spectrum into luminous, folded ribbons.*

[Guided tour](#take-the-guided-tour) · [Get started](#run-locally) · [Visual modes](#choose-your-scene) · [Hand controls](#shape-it-with-your-hands) · [Music](#let-the-music-drive-it) · [How WebGPU works](#how-webgpu-powers-ekko) · [Developer guide](#explore-the-code)

## Take the guided tour

Choose **Take the tour** in the header for a three-minute journey through all nine modes. An original instrumental loop, *First light*, plays through the same audio analyser as your own music. If you already have a song loaded or a live input connected, the tour uses that source instead. No audio library download is needed for the built-in score.

Animated hand skeletons demonstrate Wand, Vortex, Gather, Push and Shockwave. A simulated cursor demonstrates hover, click-and-hold, and Command-click gathering. The drawings and the simulation share the same positions: you see the controls that are actually affecting the smoke and particles. Camera tracking does not influence the tour.

- **Back / Next** or the nine chapter markers jump between scenes.
- **Pause / Resume** freezes the demonstration and pauses file playback. Live audio keeps playing in its source. Switching away from the tab pauses the tour.
- **Mute music** silences file playback while keeping its spectrum connected to the visuals.
- **Repeat tour** loops the chapters for an unattended showcase.
- **Try this mode** hands the current scene and its visual tuning over to you.
- **Exit tour** or **Escape** restores your previous mode, tuning, particle settings and file playback position/state. Tour settings are temporary until you choose **Try this mode**.

The tour uses the real WebGPU renderer, with automatic particle quality adjustment. Its controls are simulated and labelled; it cannot replace practising with your own hands or mouse. You can run it without allowing camera access.

![Guided tour demonstrating the Wand gesture in rainbow smoke](docs/images/guided-tour.jpg)

*The tour uses live audio-reactive rendering; the labelled hand shows the force moving the ribbons.*

## Try this first

1. Start the app and choose **Fluid ring** or **Smoke light · Original**.
2. Pick **Audio file** to open a song from your device, or choose a song from the library if its audio files are installed.
3. Select **Rainbow**, turn up **Audio response**, and press **F** for fullscreen.
4. Move the mouse through the scene. Hold a click to push; hold **Command-click** to gather.
5. Allow camera access to use your hands: make a fist to gather, then open your palm to release the light.

The scene also animates without audio. Opening a saved link or reloading keeps music paused; press **Space** when you are ready.

## Choose your scene

| Mode | What you see and control |
| --- | --- |
| **Fluid ring** | Nine smoke jets radiating from a circle. Bass begins at the upper left; higher frequencies continue clockwise. Note attacks kick the jets outward, carrying light into twisting filaments. |
| **Smoke light · Lasting glow** | Continuous smoke ribbons that catch light when a note starts. Each illuminated patch travels with the smoke and slowly fades. |
| **Smoke light · Original** | Rising, folded sheets of luminous particles. Seven frequency bands feed the emitter; the music can also flash across smoke already in the air. |
| **Fluid smoke** | Buoyant smoke you can stir. Bass hits fire upward on the left, while higher notes feed the lanes to the right. |
| **Fire & ice** | Two rolling vortex bundles, warm and cool in the matching palette. Streams curl, fold and meet as the music and your hands disturb them. |
| **Spectral smoke** | A full-circle spectrum of fine filaments inside softly shaded volumetric smoke. Nine frequency sectors control emission and lighting. |
| **Particle ring** | Outward streams of particles that accelerate with bass intensity. Pull and push the ring with your hands or mouse. |
| **Airbender** | A persistent cloud of particles. Gather them into an orbit, drag them across the screen, then send them flying. |
| **Light shapes** | Music-reactive geometry: Wave wreath, Light ribbons, Wave field and Angular trails. Hand forces disturb the shapes as they move. |

![Warm gold and cool blue smoke folding into two sweeping vortices in EKKO](docs/images/fire-and-ice.jpg)

*Fire & ice — two rolling vortex fields carrying warm and cool streams into sweeping folds.*

| Spectral smoke | Fluid ring |
| --- | --- |
| ![Multicoloured filaments spreading through a softly shaded smoke ring](docs/images/spectral-smoke.jpg) | ![Nine coloured fluid jets curling outward from a central ring](docs/images/fluid-ring.jpg) |
| Fine particles draw the edges; a coarse volume supplies soft light and depth. | A fluid velocity field carries both smoke and fine particle tracers. |

![Bright rainbow fluid smoke rising into curls and layered folds](docs/images/fluid-smoke.jpg)

*Fluid smoke — heat, colour and transported light moving through a pressure-projected velocity field.*

These are screenshots of the running app, captured at 1920 × 1080 with music playing and controls hidden. The gallery uses higher particle counts and boosted glow/audio response; it shows live output, not prerendered artwork. See [capture settings](docs/images/captures.json) for the selected frames.

## Shape it with your hands

Camera tracking turns hand landmarks into forces in the simulation. The preview mirrors your movement, and **Show hands** adds a skeleton and gesture labels over the scene, including in fullscreen.

| Gesture | Action |
| --- | --- |
| Raise your index finger | **Wand:** gather light into a small moving core. |
| Raise index and middle fingers | **Vortex:** stir an orbit. Spread the fingertips to widen it. |
| Add your ring finger | **Shockwave:** release a burst. |
| Close your hand | **Gather:** pull particles into orbit. |
| Open your palm | **Push:** repel the scene. Opening a closed hand also triggers a burst. |

Hold finger gestures briefly to switch powers; thumbs are ignored. **Hand force** adjusts pull and push together, with fine control at low strengths. Choose tracking for **2, 4 or 8 hands** to let more people join in; two hands has the lowest tracking load.

The app attempts to start the camera after WebGPU initialises, subject to browser permission. Use **Stop camera / Enable camera** in Movement to control it. The **Show hands** checkbox only controls the overlay. You can use the mouse and music without a camera.

Hand detection runs locally in a MediaPipe worker, with smoothing and bounded prediction to keep movement responsive between tracking results. Camera frames are neither uploaded nor saved by the app.

## Let the music drive it

EKKO measures the audio spectrum and sudden rises in energy. Different modes use bass/mid/treble levels, seven emission bands, or nine independently measured ring bands. A kick can launch smoke while a higher note illuminates a different part of the scene.

**Audio response** changes visual sensitivity and jet strength without changing playback volume. **Glow** changes the spread of light. In Lasting glow and the fluid modes, emitted light moves with the smoke after the note ends.

| Source | How to use it |
| --- | --- |
| **Library** | Select an installed song to start it. The song selection and playback position are remembered; a reload always restores playback paused. |
| **Audio file** | Choose a local audio file. It is analysed and played on your device; the last selected file may be cached locally for the next visit. |
| **Microphone** | Let live sound drive the scene. Microphone input is analysed without being played back or recorded. |
| **Tab audio** | Choose **Share tab**, select a browser tab playing music or video, and enable **Share tab audio** in the browser picker. Playback stays in the original tab. |
| **YouTube** | Paste a single-video link and select **Load audio**. Known library links reuse the hosted files; other links require the optional import API described below. |

Tab audio depends on browser and sharing-surface support; the app's UI guides desktop Chrome/Edge users through the picker. **Stop sharing** disconnects EKKO without pausing the original tab. Refreshing requires sharing again. The browser also supplies a display track, which EKKO does not render, record or upload.

## Make it your own

<details>
<summary>See the controls alongside the live scene</summary>

![EKKO playing music with visual-mode cards, audio controls and palettes visible](docs/images/controls.jpg)

</details>

- **Seven palettes:** Aurora, Ember, Ocean, Rainbow, Neon, Silver, and Fire & ice.
- **Per-mode settings:** speed and glow, plus turbulence, emission or particle visibility where supported. Each mode remembers its own values. Particle visibility brightens individual points independently of bloom.
- **Fullscreen and hidden controls:** fill the screen with the scene, then move to the right edge to reveal the settings drawer. All control sections collapse.
- **Freeze scene:** stop simulation motion independently of music playback to inspect a fold or composition.
- **Native, 4K or Auto resolution:** keep crisp output or let the app reduce rendering cost.
- **Automatic particle quality:** target 60 FPS, or choose a manual count up to **3,145,728**, where GPU buffer limits permit.
- **Copy link:** share the mode, palette, tuning, source selection, library song and playhead. Local audio bytes and camera/microphone/tab permissions stay on the original device.
- **Live telemetry:** see frame rate, frame time and hand-tracking performance in the footer.

| Shortcut | Action |
| --- | --- |
| **Space** | Play/pause music; start/stop the selected live input. |
| **N** | Next visual mode. |
| **B** | Burst. |
| **F**, **Enter**, or double-click the background | Toggle fullscreen. |
| **H** | Hide/show controls. |
| **Escape** | Restore controls. |
| Move the mouse | Gently repel nearby particles or smoke. |
| Click and hold | Push like an open palm. |
| Command-click and hold | Gather like a closed hand. |

Settings are saved locally and reflected in the address bar. Explicit URL values override the saved values; invalid values are ignored. For example:

```text
/?mode=fluid-ring&palette=3&song=mitis-endeavors&t=45&force=0.05&gain=2.8
```

<details>
<summary>Share-link parameters</summary>

`mode`, `song`, `source` (`reference`, `demo`, `file`, `mic`, `tab`, `youtube`), `youtube` (video ID), `t` (seconds), `count`, `auto` (0/1), `resolution` (`native`, `4k`, `auto`), `force`, `hands` (2/4/8), `showHands` (0/1), `palette`, `effect`, `gain`, `persistent`, `speed`, `glow`, `turbulence`, `emission`, `visibility`, and `immersive` (0/1).

`immersive` hides controls; entering browser fullscreen still requires a user gesture. The playhead updates the current address without adding a new history entry every second.

</details>

## How WebGPU powers EKKO

WebGPU is the browser API that lets JavaScript submit rendering and general computation to the graphics processor. Small programs called **shaders**, written in **WGSL**, run on the GPU. Compute shaders update data; vertex and fragment shaders turn it into an image. See the [WebGPU overview](https://developer.chrome.com/docs/web-platform/webgpu/overview) and [WGSL specification](https://www.w3.org/TR/WGSL/) for the underlying APIs and language.

In EKKO, JavaScript handles controls, audio analysis and frame scheduling. It sends the GPU a compact set of parameters: time, frequency levels, palette choices and hand forces. Particle positions and fluid textures stay on the GPU between frames, so the CPU does not have to move millions of particle records back and forth.

```mermaid
flowchart LR
  A[Music / microphone / tab] --> B[Web Audio spectrum and note attacks]
  C[Camera] --> D[MediaPipe worker: hand landmarks]
  D --> E[Gesture and motion forces]
  M[Mouse and settings] --> F[JavaScript frame parameters]
  B --> F
  E --> F
  F --> G[WebGPU compute: particles or fluid]
  G --> H[Streaks / smoke / volume lighting]
  H --> I[HDR bloom and tone mapping]
  I --> J[Canvas]
```

### Particles: many small jobs at once

Each compute invocation updates one particle's position, velocity and age. Different modes pull particles towards procedural shapes, carry them through swirling flow fields, or leave them free for hand control. Smoke reuses a fixed pool of slots as particles expire, avoiding continuous allocation.

A small density grid approximates local crowd pressure. Particles deposit mass into nearby cells, then read the surrounding density gradient to move apart. This avoids comparing every particle with every other particle, which would become prohibitively expensive at high counts.

Rendering expands each particle into a short, camera-facing streak. One instanced draw handles the whole cloud. Additive blending lets overlapping streaks build up bright folds, while bounded sprite sizes help control the number of pixels shaded.

### Fluid: move the smoke through a velocity field

Fluid smoke and Fluid ring use a 2D staggered grid: velocities sit on cell faces, while pressure sits at cell centres. Each step transports velocity, adds heat-driven buoyancy and interaction forces, reinforces small curls, then iterates a pressure solve to reduce compression. Some artistic forces are added afterwards so the visible push and suction remain strong.

The coloured smoke is a separate, finer dye field. **Limited MacCormack advection** transports it forward, transports it back to estimate error, and applies a bounded correction. That keeps thin edges sharper than repeatedly resampling with simple advection. A separate transported light field lets luminous patches travel with the smoke.

The velocity grid is bounded at **512 × 192** and the dye/light fields at **2048 × 768**. Fluid ring adds up to **262,144** tracers to draw fine filaments without enlarging the pressure grid. The particle-count selector is disabled for these two modes.

### Volume and light: spend detail where it shows

Spectral smoke combines sharp particle filaments with a coarse **96 × 64 × 48** density volume. A sampled subset of particles deposits density into this grid. A top-down scan estimates overhead shadows; camera rays then accumulate scattered light and opacity through it.

The volume is rendered at reduced resolution, capped at 640 pixels on its longest axis, with 24 ray samples in the current setup. Fine filaments remain at scene resolution. Empty samples skip detailed lighting, and rays stop early when the smoke is nearly opaque.

Finally, the scene is kept in an HDR texture so highlights can exceed display brightness. A bright pass extracts highlights at quarter width and height; horizontal and vertical blurs spread them into **bloom**. Tone mapping compresses that light into the display range, and subtle dithering helps hide colour banding.

These choices keep expensive work bounded while preserving visible detail. They do not promise 60 FPS at maximum settings: particle count, screen resolution, tracking load and GPU capabilities all matter. Native and 4K modes keep their selected output resolution; Auto resolution can scale down. If performance drops, start with Auto particles, fewer tracked hands, or Auto resolution.

## Run locally

Use Node.js compatible with [Vite 7](https://vite.dev/guide/) (20.19+ on the Node 20 line, or 22.12+) and a browser/device with WebGPU enabled and hardware acceleration available. The app needs localhost or HTTPS and has no WebGL fallback.

```sh
npm ci
npm run assets
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173/). Asset preparation bundles the tracking worker, copies MediaPipe WASM and downloads Google's hand-landmarker model if it is missing, so the first setup needs internet access.

**A fresh clone does not include the library recordings.** Use **Audio file**, microphone or tab audio, or supply permitted library files at the paths in [src/music.js](src/music.js). You can still explore the silent animated scene without any recording.

```sh
npm test
npm run build
npm run preview -- --port 5174
```

The build is written to `dist/`. If WebGPU cannot initialise, check browser hardware acceleration and GPU availability; EKKO displays the initialization error in the page. If camera access is unavailable, mouse control still works.

### Optional YouTube import API

Vite alone does not run the Python endpoint. For arbitrary-video imports, run `vercel dev` for the full app, or install `requirements.txt` in a Python environment and run the local helper beside Vite:

```sh
python3 -m pip install -r requirements.txt
python3 scripts/youtube-dev.py
```

The API uses yt-dlp with its Deno runtime to import public audio tracks, bounded to **20 minutes / 40 MiB**, and deletes temporary files after each response. It does not use browser cookies or login. Private, age-restricted, unavailable or blocked videos produce an error. `EKKO_YOUTUBE_ALLOWED_IDS` can restrict imports to a comma-separated list of video IDs.

The previous production check on **18 October 2026** recorded `503 youtube-blocked` on Vercel for arbitrary imports; known library links reused hosted audio successfully. Treat arbitrary YouTube import as deployment-dependent. Tab audio is another way to analyse a video already playing in your browser without importing its file.

## Explore the code

Start with [common-shader.wgsl](src/common-shader.wgsl) for the shared layout and mode map, then follow [gpu.js](src/gpu.js) to see how buffers, bindings and passes connect. The WGSL files contain explanatory comments on the math, optimizations and their tradeoffs.

| Files | Responsibility |
| --- | --- |
| [main.js](src/main.js) | UI, frame loop, audio/gesture coordination and mode selection. |
| [showcase.js](src/showcase.js), [showcase-view.js](src/showcase-view.js), [showcase-music.js](src/showcase-music.js) | Guided timeline, matching gesture/cursor demonstrations and the generated instrumental score. |
| [gpu.js](src/gpu.js) | WebGPU device, buffers, pipelines, render targets and pass scheduling. |
| [common-shader.wgsl](src/common-shader.wgsl) | Shared particle/uniform layouts, palette, randomness and interaction helpers. |
| [particles.wgsl](src/particles.wgsl), [render.wgsl](src/render.wgsl) | Particle simulation, density-grid separation and streak drawing. |
| [reference-simulation.wgsl](src/reference-simulation.wgsl), [reference-render.wgsl](src/reference-render.wgsl) | Analytic plume/vortex flows and fine smoke filaments. |
| [fluid.js](src/fluid.js), [fluid.wgsl](src/fluid.wgsl) | Fluid pass orchestration, pressure solve, dye/light transport and ring tracers. |
| [volume.wgsl](src/volume.wgsl), [post-shader.wgsl](src/post-shader.wgsl) | Volumetric lighting, trails, bloom and final compositing. |
| [audio.js](src/audio.js), [audio-controls.js](src/audio-controls.js) | Audio sources, frequency analysis and note-attack envelopes. |
| [tracking.js](src/tracking.js), [tracking-worker.js](src/tracking-worker.js), [interactions.js](src/interactions.js) | Hand detection, gesture state and simulation forces. |
| [preferences.js](src/preferences.js), [url-settings.js](src/url-settings.js) | Saved settings, local audio cache and share links. |
| [tests/](tests/) | Node tests, browser interaction tests and actual GPU checks. |

`node tests/showcase.browser.mjs` and `node tests/showcase-audio.browser.mjs` check the guided tour in Chrome against a local dev server at port 5173 (override with `EKKO_TEST_URL`). They exercise all nine GPU modes, simulated input, playback, pause/replay, restoration and the mobile layout.

`npm test` runs the Node suite, including mathematical models and mock WebGPU scheduling checks. It does **not** execute the shaders on a GPU. For real GPU checks, serve the app and open the relevant fixture:

- [Fluid](http://127.0.0.1:5173/tests/fluid.html): pressure reduction, buoyancy, hand forces, directional emission and carried-light decay.
- [Particle separation](http://127.0.0.1:5173/tests/grid-separation.html): density-grid behaviour and GPU readback.
- [Reference smoke](http://127.0.0.1:5173/tests/reference.html), [spectral smoke](http://127.0.0.1:5173/tests/spectral.html), and [emission](http://127.0.0.1:5173/tests/emission.html): mode-specific rendering and simulation checks.

With the production preview running on port 5174, `node tests/demo-controls.browser.mjs` checks mouse controls, keyboard shortcuts and the hand overlay in Chrome using synthetic camera landmarks.

## Privacy, assets and inspiration

Camera and microphone processing stay on your device. EKKO does not upload or record either input. Selected audio files may be retained in local IndexedDB; settings use localStorage. YouTube imports are the exception to local-only sourcing: they request audio through the server endpoint.

The owner has confirmed hosting permission for the five recordings used by the existing deployment. Those files remain Git-ignored; that permission is not a general redistribution licence for a new deployment. Vite copies any local `public/audio/` files into the build. See [music notes](references/music.md) for sources and filenames.

The fluid implementation follows the grid-fluid approach demonstrated by [Sebastian Lague's Smoke-Simulation](https://github.com/SebLague/Smoke-Simulation), with original WGSL code. Visual inspiration includes [MatthiasM.de's Particle tests (15)](https://www.youtube.com/watch?v=fpViZkhpPHk); reference-video frames are not app assets. Hand detection uses [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js).

The gallery in `docs/images/` contains captures of EKKO itself. Temporary test captures and external reference assets remain excluded from Git.

## Planned mode editor and sharing

Custom WGSL modes, remixing and cloud saves are not implemented yet. The selected storage direction is Neon Postgres, with Vercel Blob for preview images if needed. See the [storage decision](docs/storage.md) for the inactivity requirement and provider references.
