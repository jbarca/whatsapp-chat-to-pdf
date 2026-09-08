// Browser regression test. Requires Playwright, JSZip and pdfjs-dist (development only).
// PDF_TEST_MESSAGES=30000 enables the large-chat stress test. Artifacts go to the OS temp directory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const JSZip = require('jszip');
const { getDocument } = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'wa-pdf-test-'));
const count = Number(process.env.PDF_TEST_MESSAGES || 1000);
assert.ok(Number.isInteger(count) && count >= 1000);
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const types = { '/': 'text/html', '/app.js': 'text/javascript', '/parser.js': 'text/javascript', '/styles.css': 'text/css' };
  if (!types[path]) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', types[path]);
  res.end(await readFile(join(root, path === '/' ? 'index.html' : path.slice(1))));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
const errors = [];
const consoleErrors = [];

async function open(pro = true) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({
    path: require.resolve('jszip/dist/jszip.min.js'), contentType: 'text/javascript',
  }));
  await page.addInitScript(pro => {
    if (pro) localStorage.setItem('wa2pdf.license', JSON.stringify({ key: 'test-only', ok: true }));
    window.__printCalls = 0;
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      window.__printCalls++;
      // Intentionally omit afterprint to cover non-blocking/embedded browsers.
    };
  }, pro);
  await page.goto(url);
  assert.equal(page.url(), url);
  assert.match(await page.title(), /WhatsApp Chat to PDF/);
  assert.ok(await page.locator('#drop').isVisible());
  return page;
}

async function load(page, text, name = 'Large.txt') {
  await page.locator('#file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.locator('#app').waitFor({ state: 'visible' });
}

async function exportChat(page) {
  const calls = await page.evaluate(() => window.__printCalls);
  const start = Date.now();
  await page.locator('#print-chat').dispatchEvent('click');
  await page.waitForFunction(calls => window.__printCalls === calls + 1 && !document.getElementById('print-chat').disabled, calls, { polling: 25 });
  return Date.now() - start;
}

async function pdfText(page, name) {
  const start = Date.now();
  const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 120000 });
  await writeFile(join(output, name + '.pdf'), bytes);
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const texts = [];
  let size;
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    size ||= p.view;
    texts.push((await p.getTextContent()).items.map(item => item.str).join('\n'));
    p.cleanup();
  }
  const result = { text: texts.join('\n'), pages: pdf.numPages, size, bytes: bytes.length, milliseconds: Date.now() - start };
  await pdf.destroy();
  console.log(name, JSON.stringify({ ...result, text: undefined }));
  return result;
}

try {
  const chat = Array.from({ length: count }, (_, i) => {
    const day = i < 500 ? '14' : '15';
    return `[${day}/08/2026, 12:${String(i % 60).padStart(2, '0')}:07] ${i % 2 ? 'Bob' : 'Alice'}: MESSAGE_${String(i + 1).padStart(6, '0')} ${i % 100 === 0 ? 'MATCH ' : ''}Hello from this exported chat. ${i % 7 === 0 ? '\nA second line with https://example.com/.' : ''}`;
  }).join('\n');
  const page = await open();
  await load(page, chat);
  assert.equal(await page.locator('#doc .msg').count(), 250);
  await page.locator('#load-more').dispatchEvent('click');
  assert.equal(await page.locator('#doc .msg').count(), 500);
  await page.evaluate(() => {
    window.__firstPreviewRow = document.querySelector('#doc .msg');
    window.__progress = [];
    new MutationObserver(() => window.__progress.push(document.getElementById('export-status').textContent))
      .observe(document.getElementById('export-status'), { childList: true });
  });
  console.log('prepare', count, await exportChat(page), 'ms');
  assert.equal(await page.locator('#print-doc .msg').count(), count);
  assert.equal(await page.locator('#doc .msg').count(), 500);
  assert.ok(await page.evaluate(() => window.__firstPreviewRow === document.querySelector('#doc .msg')));
  assert.ok(await page.evaluate(() => window.__progress.some(s => s.includes('250 of'))));
  assert.equal(await page.locator('#print-doc').isVisible(), false);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(output, 'desktop.png') });
  const large = await pdfText(page, 'large');
  const ids = Array.from(large.text.matchAll(/MESSAGE_(\d{6})/g), m => Number(m[1]));
  assert.deepEqual(ids, Array.from({ length: count }, (_, i) => i + 1), 'Every message must appear exactly once, in order');
  assert.ok(!large.text.includes('PREVIEW'));
  assert.equal(await page.locator('#print-doc').count(), 0);
  assert.equal(await page.locator('#doc .msg').count(), 500);
  await page.locator('#load-more').dispatchEvent('click');
  assert.equal(await page.locator('#doc .msg').count(), 750);
  assert.equal(await page.locator('#doc .day').count(), 2);

  // Cancel during preparation, then export again successfully.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (document.getElementById('export-status').textContent.includes(' of ')) {
        observer.disconnect(); document.getElementById('cancel-export').click();
      }
    });
    observer.observe(document.getElementById('export-status'), { childList: true });
  });
  await page.locator('#print-chat').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('export-status').textContent === 'PDF preparation cancelled.', null, { polling: 25 });
  assert.equal(await page.evaluate(() => window.__printCalls), 1);
  assert.equal(await page.locator('#print-doc').count(), 0);
  assert.equal(await page.locator('#print-chat').isEnabled(), true);

  // A browser-menu print during preparation must include all messages, never one batch.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (document.getElementById('export-status').textContent.includes(' of ')) {
        observer.disconnect();
        window.dispatchEvent(new Event('beforeprint'));
        window.__menuPrintCount = document.querySelectorAll('#print-doc .msg').length;
        window.dispatchEvent(new Event('afterprint'));
      }
    });
    observer.observe(document.getElementById('export-status'), { childList: true });
  });
  await page.locator('#print-chat').dispatchEvent('click');
  await page.waitForFunction(() => window.__menuPrintCount > 0 && !document.getElementById('print-chat').disabled, null, { polling: 25 });
  assert.equal(await page.evaluate(() => window.__menuPrintCount), count);
  assert.equal(await page.locator('#print-doc').count(), 0);

  // Evidence, filters, original IDs, seconds, SHA-256, Letter and plain layout.
  await page.locator('#opt-evidence').check();
  await page.locator('#opt-style').selectOption('plain');
  await page.locator('#opt-paper').selectOption('letter');
  await page.locator('#opt-from').fill('2026-08-15');
  await page.locator('#opt-to').fill('2026-08-15');
  await page.locator('#opt-search').fill('MATCH');
  await exportChat(page);
  const expected = Array.from({ length: count }, (_, i) => i).filter(i => i >= 500 && i % 100 === 0).map(i => i + 1);
  assert.equal(await page.locator('#print-doc .msg').count(), expected.length);
  assert.equal(await page.locator('#print-doc .sender').count(), expected.length);
  const evidence = await pdfText(page, 'evidence');
  assert.deepEqual(Array.from(evidence.text.matchAll(/MESSAGE_(\d{6})/g), m => Number(m[1])), expected);
  assert.ok(evidence.text.includes(createHash('sha256').update(chat).digest('hex')));
  assert.ok(evidence.text.includes('2026-08-15 12:20:07'));
  assert.equal([...evidence.text.matchAll(/exported/g)].length, evidence.pages + expected.length);
  assert.equal(evidence.size[2], 612);
  assert.equal(evidence.size[3], 792);

  // Zero matches and a failing print invocation must leave the app usable.
  await page.locator('#opt-search').fill('no-such-message');
  await exportChat(page);
  assert.equal(await page.locator('#print-doc .msg').count(), 0);
  await page.evaluate(() => { window.__workingPrint = window.print; window.print = () => { throw new Error('Print unavailable'); }; });
  await page.locator('#print-chat').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('export-status').textContent.includes('Print unavailable'), null, { polling: 25 });
  assert.equal(await page.locator('#print-doc').count(), 0);
  assert.equal(await page.locator('#print-chat').isEnabled(), true);
  await page.evaluate(() => { window.print = window.__workingPrint; });
  await page.locator('#opt-search').fill('MATCH');
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => document.getElementById('print-doc')?.querySelectorAll('.msg').length > 0 && !document.getElementById('print-chat').disabled, null, { polling: 25 });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(output, 'mobile.png') });
  await page.close();

  const free = await open(false);
  await load(free, chat);
  await exportChat(free);
  assert.equal(await free.locator('#print-doc .msg').count(), 100);
  const preview = await pdfText(free, 'free');
  assert.equal([...preview.text.matchAll(/MESSAGE_\d{6}/g)].length, 100);
  assert.ok(preview.text.includes('PREVIEW'));
  assert.ok(preview.text.includes((count - 100).toLocaleString() + ' more messages'));
  assert.equal(await free.locator('#opt-media').isDisabled(), true);
  await free.close();

  // ZIP photos: repeated files, resizing, corrupt media and URL cleanup.
  const media = await open();
  const image = await media.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#128c7e'; ctx.fillRect(0, 0, 2400, 1800);
    ctx.fillStyle = 'white'; ctx.font = '180px sans-serif'; ctx.fillText('Photo export test', 150, 900);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const zip = new JSZip();
  zip.file('_chat.txt', '[14/08/2026, 12:00:01] Alice: <attached: photo.png>\n[14/08/2026, 12:00:02] Bob: <attached: photo.png>\n[14/08/2026, 12:00:03] Alice: <attached: broken.jpg>');
  zip.file('photo.png', image, { base64: true }); zip.file('broken.jpg', 'corrupt image');
  await media.locator('#file').setInputFiles({ name: 'Photos.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await media.locator('#app').waitFor({ state: 'visible' });
  await media.locator('#opt-media').check();
  await exportChat(media);
  const photos = await media.locator('#print-doc img').evaluateAll(imgs => imgs.map(img => ({ src: img.src, width: img.naturalWidth, height: img.naturalHeight })));
  assert.equal(photos.length, 2);
  assert.equal(photos[0].src, photos[1].src);
  assert.ok(photos.every(p => p.width > 0 && p.width <= 1800 && p.height <= 1260));
  assert.match(await media.locator('#export-status').textContent(), /1 photo is unavailable/);
  const photoPdf = await pdfText(media, 'photos');
  assert.ok(photoPdf.text.includes('broken.jpg (image unavailable)'));
  assert.ok(await media.evaluate(async src => { try { await fetch(src); return false; } catch { return true; } }, photos[0].src));
  await media.close();

  // A single message taller than a page must split without losing text.
  const long = await open();
  const lines = Array.from({ length: 700 }, (_, i) => `LONG_LINE_${String(i + 1).padStart(4, '0')} A long multiline message.`);
  await load(long, '[14/08/2026, 12:00:01] Alice: ' + lines.join('\n') + '\n[14/08/2026, 12:00:02] Bob: café Ελληνικά Привет مرحبا 你好 😊');
  await exportChat(long);
  const longPdf = await pdfText(long, 'long-message');
  assert.deepEqual(Array.from(longPdf.text.matchAll(/LONG_LINE_(\d{4})/g), m => Number(m[1])), Array.from({ length: 700 }, (_, i) => i + 1));
  assert.ok(longPdf.text.includes('café'));
  await long.close();
  assert.deepEqual(errors, []);
  // Fetching the revoked blob above intentionally generates one network error.
  assert.deepEqual(consoleErrors.filter(message => !message.includes('ERR_FILE_NOT_FOUND')), []);
  console.log('PDF export tests passed. Artifacts:', output);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
