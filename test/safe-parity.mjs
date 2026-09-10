import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.SAFE_PARITY !== '1') {
  console.log('MNLI parity test skipped (set SAFE_PARITY=1)');
  process.exit(0);
}

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  try {
    const path = await realpath(join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')));
    if (!path.startsWith(root + '/')) throw new Error('blocked');
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(await readFile(path));
  } catch (error) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const result = await page.evaluate(async () => {
    const worker = new Worker('safe-worker.js');
    await new Promise((resolve, reject) => { worker.onmessage = event => event.data.type === 'ready' && resolve(); worker.onerror = reject; });

    let runId = 0;
    const run = (messages, categories) => new Promise((resolve, reject) => {
      const id = ++runId;
      worker.onmessage = event => {
        const data = event.data;
        if (data.type === 'image-batch-request') worker.postMessage({ type: 'image-batch-response', runId: id, buffers: [] });
        else if (data.type === 'complete' && data.runId === id) resolve(data);
        else if (data.type === 'error' && data.runId === id) reject(new Error(data.message));
      };
      worker.postMessage({ type: 'analyse', runId: id, messages, categories, customTerms: '', scanImages: false });
    });

    // Test messages with varied characteristics (all English to trigger MNLI)
    const testMessages = [
      { id: 1, text: 'This is a normal conversation about the weather.' },
      { id: 2, text: 'I love programming in JavaScript, it is so much fun!' },
      { id: 3, text: 'The quick brown fox jumps over the lazy dog.' },
      { id: 4, text: 'Machine learning models are fascinating tools for analysis.' },
      { id: 5, text: 'Safety and security matter in online communications.' },
      { id: 6, text: 'This text contains multiple sentences. Each one has meaning. Together they form a message.' },
      { id: 7, text: 'a' },
      { id: 8, text: 'Short text here' },
      { id: 9, text: 'Another regular message in a typical conversation.' },
      { id: 10, text: 'Longer messages test the model with more context. They help verify that batching works correctly for variable-length inputs. The model should handle them properly.' },
    ];

    // Test with categories that trigger MNLI (not 'abuse' or 'images')
    const result1 = await run(testMessages, ['sexual', 'violence']);

    // Test with multiple categories to stress batching
    const result2 = await run(testMessages, ['abuse', 'sexual', 'violence', 'drugs', 'crime']);

    // Verify results are complete
    if (!result1.findings) throw new Error('Missing findings in result 1');
    if (!result2.findings) throw new Error('Missing findings in result 2');
    if (result1.policyVersion !== result2.policyVersion) throw new Error('Policy version mismatch');

    worker.terminate();
    return { passed: true, device: result1.device, policyVersion: result1.policyVersion };
  });

  assert.equal(result.passed, true, 'Worker analysis failed');
  console.log(`MNLI hand-batch test passed on device: ${result.device} (policy ${result.policyVersion})`);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
