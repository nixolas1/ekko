import { build } from 'esbuild';
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
await mkdir('public/wasm', { recursive: true });
await mkdir('public/models', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/wasm', { recursive: true });
await build({ entryPoints: ['src/tracking-worker.js'], bundle: true, format: 'iife', outfile: 'public/tracking-worker.js', minify: true });
for (const [name, url] of Object.entries({
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
})) {
  const path = `public/models/${name}`;
  try { await access(path); } catch {
    console.log(`Downloading ${name}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
}
