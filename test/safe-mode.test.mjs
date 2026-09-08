import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/parser.js', 'parser.js'], ['/safe-policy.js', 'safe-policy.js'], ['/safe-worker.js', 'safe-worker.js'], ['/styles.css', 'styles.css']]);
const server = createServer(async (req, res) => {
  const file = files.get(req.url.split('?')[0]); if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript'); res.end(await readFile(`${root}/${file}`));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('wa2pdf.license', JSON.stringify({ key: 'test', ok: true }));
    class FakeWorker {
      constructor(url) { this.url = url; setTimeout(() => this.onmessage?.({ data: { type: 'ready', policyVersion: '1.0.0' } })); }
      postMessage(data) { if (data.type === 'analyse') setTimeout(() => this.onmessage?.({ data: { type: 'complete', findings: [{ messageId: 2, category: 'abuse', reason: 'test finding', score: .9 }], unanalysed: [], partialCoverage: false, device: 'wasm', policyVersion: '1.0.0' } })); }
      terminate() {}
    }
    window.Worker = FakeWorker;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const chat = '[08/09/2026, 10:00:00] Alice: hello\n[08/09/2026, 10:01:00] Bob: bad\n[08/09/2026, 10:02:00] Alice: goodbye';
  await page.locator('#file').setInputFiles({ name: 'Chat.txt', mimeType: 'text/plain', buffer: Buffer.from(chat) });
  await page.locator('#opt-evidence').check(); await page.locator('#opt-safe').check();
  assert.equal(await page.locator('#opt-evidence').isChecked(), false);
  assert.equal(await page.locator('#export').isDisabled(), true);
  await page.locator('#safe-analyse').click(); await page.locator('#safe-review').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[name="safe-remove"]:checked').count(), 1);
  await page.locator('#safe-apply').click();
  assert.equal(await page.locator('#doc .msg').count(), 2);
  assert.equal(await page.locator('#export').isDisabled(), false);
  await page.locator('#opt-search').fill('hello');
  assert.equal(await page.locator('#export').isDisabled(), true);

  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('wa2pdf.license', JSON.stringify({ key: 'test', ok: true })));
  const realWorkerPage = await context.newPage(); await realWorkerPage.goto(`http://127.0.0.1:${server.address().port}/`);
  await realWorkerPage.locator('#file').setInputFiles({ name: 'Chat.txt', mimeType: 'text/plain', buffer: Buffer.from(chat) });
  await realWorkerPage.locator('#opt-safe').check();
  await realWorkerPage.locator('[name="safe-category"]').evaluateAll(items => items.forEach(item => { item.checked = false; item.dispatchEvent(new Event('change', { bubbles: true })); }));
  await realWorkerPage.locator('#safe-terms').fill('bad'); await realWorkerPage.locator('#safe-analyse').click();
  await realWorkerPage.locator('#safe-review').waitFor({ state: 'visible' });
  assert.equal(await realWorkerPage.locator('[name="safe-remove"]:checked').count(), 1);
  await context.close();
  console.log('safe mode browser tests passed');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
