// Actual browser downloads: no print emulation or page.pdf(). Synthetic chats only.
// PDF_BROWSER=chrome or msedge; PDF_TEST_MESSAGES=30000 for the stress case.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const JSZip = require('jszip');
const { getDocument } = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'wa-download-test-'));
const count = Number(process.env.PDF_TEST_MESSAGES || 1000);
assert.ok(Number.isInteger(count) && count >= 1000);
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/parser.js', ['parser.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']],
  ['/pdf-worker.js', ['pdf-worker.js', 'text/javascript']],
  ['/vendor/jspdf-4.2.1.umd.min.js', ['vendor/jspdf-4.2.1.umd.min.js', 'text/javascript']],
  ['/vendor/NotoSans-Regular.ttf', ['vendor/NotoSans-Regular.ttf', 'font/ttf']],
]);
const server = createServer(async (req, res) => {
  const entry = files.get(req.url.split('?')[0]);
  if (!entry) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', entry[1]); res.end(await readFile(join(root, entry[0])));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: process.env.PDF_BROWSER || 'msedge', headless: true });
const errors = [], requests = [];
async function open(pro = true) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => { if (!req.url().startsWith(url)) requests.push(req.url()); });
  await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ path: require.resolve('jszip/dist/jszip.min.js'), contentType: 'text/javascript' }));
  await page.addInitScript(pro => {
    if (pro) localStorage.setItem('wa2pdf.license', JSON.stringify({ key: 'test-only', ok: true }));
    window.__prints = 0; window.print = () => { window.__prints++; throw new Error('Download must not invoke print'); };
  }, pro);
  await page.goto(url);
  assert.equal(page.url(), url); assert.match(await page.title(), /WhatsApp Chat to PDF/);
  assert.ok(await page.locator('#drop').isVisible());
  return page;
}
async function load(page, chat) {
  await page.locator('#file').setInputFiles({ name: 'Large.txt', mimeType: 'text/plain', buffer: Buffer.from(chat) });
  await page.locator('#app').waitFor({ state: 'visible' });
}
async function save(page, name, selector = '#export') {
  const start = Date.now();
  const downloading = page.waitForEvent('download', { timeout: 120000 });
  await page.locator(selector).click();
  const download = await downloading;
  const path = join(output, name + '.pdf');
  await download.saveAs(path); assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /\.pdf$/);
  await page.waitForFunction(() => !document.getElementById('export').disabled);
  assert.equal(await page.evaluate(() => window.__prints), 0);
  assert.equal(await page.locator('#print-doc').count(), 0);
  assert.ok(await page.locator('#download-pdf').isVisible());
  const bytes = await readFile(path);
  const milliseconds = Date.now() - start;
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const text = [], links = new Set(); let size;
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i); size ||= p.view;
    text.push((await p.getTextContent()).items.map(item => item.str).join('\n')); p.cleanup();
    for (const annotation of await p.getAnnotations()) if (annotation.url) links.add(annotation.url);
  }
  const result = { text: text.join('\n'), pages: pdf.numPages, size, links: [...links], bytes: bytes.length, milliseconds, hash: createHash('sha256').update(bytes).digest('hex') };
  await pdf.destroy();
  console.log(name, JSON.stringify({ ...result, text: undefined })); return result;
}
const ids = text => Array.from(text.matchAll(/MESSAGE_(\d{6})/g), m => Number(m[1]));
try {
  const chat = Array.from({ length: count }, (_, i) => `[${i < 500 ? '14' : '15'}/08/2026, 12:00:07] ${i % 2 ? 'Bob' : 'Alice'}: MESSAGE_${String(i + 1).padStart(6, '0')} ${i % 100 === 0 ? 'MATCH ' : ''}Hello from this exported chat.${i % 7 === 0 ? '\nA second line with https://example.com/.' : ''}`).join('\n');
  const page = await open(); await load(page, chat);
  await page.locator('#load-more').dispatchEvent('click');
  await page.evaluate(() => {
    window.__first = document.querySelector('#doc .msg'); window.__progress = []; window.__ticks = 0;
    window.__timer = setInterval(() => window.__ticks++, 10);
    new MutationObserver(() => window.__progress.push(document.getElementById('export-status').textContent)).observe(document.getElementById('export-status'), { childList: true });
  });
  const large = await save(page, 'large');
  assert.deepEqual(ids(large.text), Array.from({ length: count }, (_, i) => i + 1));
  assert.ok(!large.text.includes('PREVIEW'));
  assert.ok(large.links.includes('https://example.com/'));
  assert.ok(await page.evaluate(() => window.__ticks > 5));
  assert.ok(await page.evaluate(() => window.__progress.some(s => s.includes('250 of'))));
  assert.equal(await page.locator('#doc .msg').count(), 500);
  assert.ok(await page.evaluate(() => window.__first === document.querySelector('#doc .msg')));
  await page.evaluate(() => { clearInterval(window.__timer); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: join(output, 'desktop.png') });
  await page.locator('#export-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'desktop-download.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'mobile.png') });
  await page.locator('#export-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'mobile-download.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1280, height: 900 });
  const again = await save(page, 'download-again', '#download-pdf'); assert.equal(again.hash, large.hash);
  await page.locator('#load-more').dispatchEvent('click'); assert.equal(await page.locator('#doc .msg').count(), 750);

  // Cancel both startup and final serialization; no stray downloads or lingering worker.
  for (const phase of ['startup', 'Finalising']) {
    let downloads = 0; const onDownload = () => downloads++; page.on('download', onDownload);
    await page.evaluate(phase => {
      if (phase !== 'startup') {
        const observer = new MutationObserver(() => {
          if (document.getElementById('export-status').textContent.includes(phase)) { observer.disconnect(); document.getElementById('cancel-export').click(); }
        }); observer.observe(document.getElementById('export-status'), { childList: true });
      }
      document.getElementById('export').click();
      if (phase === 'startup') document.getElementById('cancel-export').click();
    }, phase);
    await page.waitForFunction(() => document.getElementById('export-status').textContent === 'PDF preparation cancelled.', null, { timeout: 120000 });
    assert.equal(downloads, 0); assert.equal(await page.locator('#export').isEnabled(), true);
    assert.equal(await page.locator('#download-pdf').isVisible(), false);
    page.off('download', onDownload);
  }
  await page.locator('#opt-evidence').check(); await page.locator('#opt-style').selectOption('plain');
  await page.locator('#opt-paper').selectOption('letter'); await page.locator('#opt-from').fill('2026-08-15');
  await page.locator('#opt-search').fill('MATCH'); // Export immediately: flush pending filter changes.
  const evidence = await save(page, 'evidence');
  const expected = Array.from({ length: count }, (_, i) => i + 1).filter(id => id > 500 && (id - 1) % 100 === 0);
  assert.deepEqual(ids(evidence.text), expected);
  assert.ok(evidence.text.includes(createHash('sha256').update(chat).digest('hex')));
  assert.ok(evidence.text.includes('#501')); assert.ok(evidence.text.includes('2026-08-15 12:00:07'));
  assert.deepEqual(evidence.size, [0, 0, 612, 792]);
  await page.locator('#opt-search').fill('no-such-message');
  const empty = await save(page, 'empty'); assert.deepEqual(ids(empty.text), []);
  assert.ok(empty.text.includes('No messages match'));
  await page.close();

  const free = await open(false); await load(free, chat);
  const limited = await save(free, 'free'); assert.deepEqual(ids(limited.text), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.ok(limited.text.includes('PREVIEW')); assert.ok(limited.text.includes((count - 100).toLocaleString() + ' more messages'));
  assert.equal(await free.locator('#opt-media').isDisabled(), true); await free.close();

  const media = await open();
  const image = await media.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
    const p = c.getContext('2d'); p.fillStyle = '#128c7e'; p.fillRect(0, 0, c.width, c.height);
    p.fillStyle = 'white'; p.font = '180px sans-serif'; p.fillText('Photo export test', 150, 900);
    return c.toDataURL('image/png').split(',')[1];
  });
  const zip = new JSZip();
  zip.file('_chat.txt', '[14/08/2026, 12:00:01] Alice: <attached: photo.png>\n[14/08/2026, 12:00:02] Bob: <attached: photo.png>\n[14/08/2026, 12:00:03] Alice: <attached: broken.jpg>');
  zip.file('photo.png', image, { base64: true }); zip.file('broken.jpg', 'corrupt');
  await media.locator('#file').setInputFiles({ name: 'Photos.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await media.locator('#app').waitFor({ state: 'visible' }); await media.locator('#opt-media').check();
  const photos = await save(media, 'photos'); assert.ok(photos.text.includes('broken.jpg (image unavailable)'));
  assert.match(await media.locator('#export-status').textContent(), /1 photo/); await media.close();

  const long = await open();
  const longLines = Array.from({ length: 700 }, (_, i) => `LONG_LINE_${String(i + 1).padStart(4, '0')} A long multiline message.`);
  await load(long, '[14/08/2026, 12:00:01] Alice: ' + longLines.join('\n') + '\n[14/08/2026, 12:00:02] Bob: café Ελληνικά Привет مرحبا 你好 😊\n[14/08/2026, 12:00:03] Alice: ' + 'W'.repeat(6000));
  const split = await save(long, 'long-unicode');
  assert.deepEqual(Array.from(split.text.matchAll(/LONG_LINE_(\d{4})/g), m => Number(m[1])), Array.from({ length: 700 }, (_, i) => i + 1));
  for (const word of ['café', 'Ελληνικά', 'Привет', '你好', '😊']) assert.ok(split.text.includes(word), word + ' must remain extractable');
  assert.equal((split.text.match(/W/g) || []).length - (split.text.match(/WhatsApp/g) || []).length, 6000);
  await long.close();

  // A worker startup failure must restore the controls and allow a clean retry.
  const failure = await open(); await load(failure, '[14/08/2026, 12:00:01] Alice: RETRY_OK');
  await failure.route('**/pdf-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: 'self.postMessage({type:"error",message:"Synthetic initialization failure"})' }));
  await failure.locator('#export').click();
  await failure.waitForFunction(() => document.getElementById('export-status').textContent.includes('Synthetic initialization failure'));
  assert.equal(await failure.locator('#export').isEnabled(), true); assert.equal(await failure.locator('#cancel-export').isVisible(), false);
  await failure.unroute('**/pdf-worker.js');
  const retried = await save(failure, 'retried'); assert.ok(retried.text.includes('RETRY_OK'));
  // A changed option invalidates the previously prepared download.
  await failure.locator('#opt-title').fill('Changed title');
  await failure.locator('#download-pdf').waitFor({ state: 'hidden' });
  assert.equal(await failure.locator('#export-status').textContent(), ''); await failure.close();
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.startsWith('https://cdnjs.cloudflare.com/')), 'No chat data or fonts sent to third parties');
  console.log('Direct PDF download tests passed.', browser.version(), 'Artifacts:', output);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
