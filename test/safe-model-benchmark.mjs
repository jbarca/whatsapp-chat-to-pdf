import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.SAFE_MODEL_BENCH !== '1') {
  console.log('safe model benchmark skipped (set SAFE_MODEL_BENCH=1)');
  process.exit(0);
}

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const path = await realpath(join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')));
    if (!path.startsWith(root + '/')) throw new Error('blocked');
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path));
  } catch (error) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const results = await page.evaluate(async () => {
    const worker = new Worker('safe-worker.js');
    await new Promise((resolve, reject) => { worker.onmessage = event => event.data.type === 'ready' && resolve(); worker.onerror = reject; });
    const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0)).buffer;
    let runId = 0;
    const run = (messages, scanImages = false) => new Promise((resolve, reject) => {
      const id = ++runId, started = performance.now();
      worker.onmessage = event => {
        const data = event.data;
        if (data.type === 'image-batch-request' && data.runId === id) worker.postMessage({ type: 'image-batch-response', runId: id, buffers: data.names.map(() => pixel.slice(0)) });
        else if (data.type === 'complete' && data.runId === id) resolve({ wall: Math.round(performance.now() - started), timings: data.timings, device: data.device });
        else if (data.type === 'error' && data.runId === id) reject(new Error(data.message));
      };
      worker.postMessage({ type: 'analyse', runId: id, messages, categories: ['abuse', 'sexual', 'violence', 'drugs', 'crime', ...(scanImages ? ['images'] : [])], customTerms: '', scanImages });
    });
    const make = count => Array.from({ length: count }, (_, index) => ({ id: index + 1, text: `Synthetic unique message ${index + 1} about an ordinary day.` }));
    const small = await run(make(20));
    const unique1000 = await run(make(1000));
    const repeat1000 = await run(make(1000));
    const imageMessages = make(100).map((message, index) => Object.assign(message, { attachments: [`unavailable-${index}.jpg`] }));
    const image = await run(imageMessages, true);
    worker.terminate(); return { small, unique1000, repeat1000, image };
  });
  console.log(JSON.stringify(results, null, 2));
  if (process.env.SAFE_BENCH_BASELINE_JSON) {
    const baseline = JSON.parse(await readFile(process.env.SAFE_BENCH_BASELINE_JSON, 'utf8'));
    const fasterBy = (name, fraction) => assert.ok(results[name].wall <= baseline[name] * (1 - fraction), `${name} missed ${fraction * 100}% speed target`);
    fasterBy('unique1000', .40); fasterBy('repeat1000', .60); fasterBy('image', .25);
    assert.ok(results.small.wall <= baseline.small * 1.10, 'small scan regressed by more than 10%');
  }
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
