// Runs tests/grid-separation.html in Chrome against a private Vite server (needs a WebGPU-capable GPU):
//   node tests/grid-separation.browser.mjs             current particles.wgsl
//   node tests/grid-separation.browser.mjs --compare   also the committed (HEAD) separation, for before/after
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADLESS === '1', args: ['--enable-unsafe-webgpu'] });
let failed = false;
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/grid-separation.html`);
  await page.waitForFunction(() => typeof window.runGridSeparation === 'function');
  const runs = { current: undefined };
  if (process.argv.includes('--compare')) {
    const head = execFileSync('git', ['show', 'HEAD:src/particles.wgsl'], { cwd: root, encoding: 'utf8' });
    runs.head = head.slice(0, head.indexOf('\nfn tri('));
  }
  for (const [name, section] of Object.entries(runs)) {
    const result = await page.evaluate(s => window.runGridSeparation(s), section);
    console.log(name, JSON.stringify(result, null, 2));
    if (name === 'current' && !result.pass) failed = true;
  }
  if (errors.length) { console.error(errors); failed = true; }
} finally { await browser.close(); await server.close(); }
process.exit(failed ? 1 : 0);
