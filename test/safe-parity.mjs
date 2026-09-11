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

/* Drives the shipped mnliScores/bucketed/batched from the real safe-worker.js. Served from the site
   root so the harness, safe-worker.js and its own importScripts all resolve relatively. */
const harness = `
importScripts('safe-worker.js');
async function handBatched(pipe, pairs, size) {
  const bucket = SafeScheduler.bucketed(pairs, pair => pair.premise.length);
  return bucket.restore(await SafeScheduler.batched(bucket.items, size, batch => mnliScores(pipe, batch, 128)));
}
onmessage = async ({ data }) => {
  try {
    const token = { runId: 1, cancelled: false };
    activeRun = token; rememberedWasm = true;
    const labels = data.categories.map(x => SafePolicy.LABELS[x]);
    const { pipes } = await ensurePipelines(data.categories, false, token);
    if (!pipes.textSupportsHandBatch) throw new Error('the text pipeline does not expose entailment ids');
    const pipe = pipes.text, pairs = [];
    for (const text of data.texts) for (const label of labels) pairs.push({ premise: text, hypothesis: HYPOTHESIS(label) });
    const unpadded = await handBatched(pipe, pairs, 1), batched = await handBatched(pipe, pairs, data.batchSize);
    const longest = pairs.reduce((a, b) => a.premise.length >= b.premise.length ? a : b);
    const longestTokens = pipe.tokenizer([longest.premise], { text_pair: [longest.hypothesis] }).input_ids.dims[1];
    const saved = pipe.tokenizer.model_max_length;
    let reference;
    pipe.tokenizer.model_max_length = 128;
    try { reference = await pipe(data.texts, labels, { multi_label: true }); }
    finally { pipe.tokenizer.model_max_length = saved; }
    const rows = [];
    data.texts.forEach((text, t) => {
      const byLabel = new Map(reference[t].labels.map((label, i) => [label, reference[t].scores[i]]));
      labels.forEach((label, l) => rows.push({ text: t, label, unpadded: unpadded[t * labels.length + l], batched: batched[t * labels.length + l], reference: byLabel.get(label) }));
    });
    activeRun = null;
    postMessage({ type: 'parity', device: pipes.device, labels, longestTokens, rows });
  } catch (error) { activeRun = null; postMessage({ type: 'parity-error', message: error.message || String(error) }); }
};
`;

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(req.url.split('?')[0]);
  if (requested === '/parity-worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(harness); return; }
  try {
    const path = await realpath(join(root, requested.replace(/^\/+/, '')));
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
    const filler = 'Everyone met at the harbour before sunrise and talked about the delayed shipment, the missing paperwork and the weather. ';
    const texts = [
      'ok', 'a', 'See you at 6', 'This is a normal conversation about the weather.',
      'I love programming in JavaScript, it is so much fun!', 'The quick brown fox jumps over the lazy dog.',
      'Machine learning models are fascinating tools for analysis.', 'Safety and security matter in online communications.',
      'This text contains multiple sentences. Each one has meaning. Together they form a message.',
      'Another regular message in a typical conversation.', 'Can you send the invoice again please, the last one was unreadable.',
      'He said he would bring the package tonight and leave it by the back door.',
      'Longer messages test the model with more context. They help verify that batching works for variable-length inputs.',
      'Sorry, I missed your call earlier, I was stuck on the train for an hour.',
      'The meeting is moved to Thursday because half the team is travelling this week.',
      'Remember to pick up the prescription from the pharmacy before it closes.',
      'That was honestly the funniest thing I have seen all year, I could not stop laughing.',
      'Please stop messaging me about this, I have already said no several times.',
      'We reviewed the contract and there are three clauses that still need changing before Friday.',
      filler.repeat(8).trim(),
    ];
    const worker = new Worker('parity-worker.js');
    await new Promise((resolve, reject) => { worker.onmessage = event => event.data.type === 'ready' && resolve(); worker.onerror = reject; });
    const data = await new Promise((resolve, reject) => {
      worker.onmessage = event => {
        if (event.data.type === 'parity') resolve(event.data);
        else if (event.data.type === 'parity-error') reject(new Error(event.data.message));
      };
      worker.onerror = reject;
      worker.postMessage({ texts, categories: ['sexual', 'violence', 'drugs', 'crime'], batchSize: 16 });
    });
    worker.terminate();
    return Object.assign({ texts: texts.length }, data);
  });

  assert.equal(result.rows.length, result.texts * result.labels.length, 'every text/label pair must be compared');
  assert.ok(result.longestTokens > 128, `the longest premise must exceed the 128-token cap (was ${result.longestTokens})`);
  const worst = { unpadded: 0, batched: 0 }, worstRow = {};
  let batchedTotal = 0;
  for (const row of result.rows) {
    for (const key of ['unpadded', 'batched']) {
      assert.ok(Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1, `${key} score out of range: ${row[key]}`);
      assert.ok(Number.isFinite(row.reference) && row.reference >= 0 && row.reference <= 1, `reference score out of range: ${row.reference}`);
      const delta = Math.abs(row[key] - row.reference);
      if (delta > worst[key]) { worst[key] = delta; worstRow[key] = row; }
    }
    batchedTotal += Math.abs(row.batched - row.reference);
  }
  const mean = batchedTotal / result.rows.length, scores = result.rows.map(row => row.reference);
  const describe = key => `worst |Δ| ${worst[key]} on text ${worstRow[key].text} label "${worstRow[key].label}" (${worstRow[key][key]} vs reference ${worstRow[key].reference})`;
  assert.ok(Math.max(...scores) - Math.min(...scores) > 0.05, 'reference scores are degenerate; the model did not discriminate');
  /* Batch of one: identical tokenization to the pipeline's per-pair call, so the hand-rolled entailment
     maths must reproduce it exactly. This is what catches a swapped entailment id or hypothesis template. */
  assert.ok(worst.unpadded <= 1e-4, `hand-batched MNLI disagrees with the pipeline at batch size 1: ${describe('unpadded')}`);
  /* At the shipped batch size q8 dynamic quantization shares one activation scale across the batch, and
     padding widens it, so scores move a little. Guard the size of that drift and its average. */
  assert.ok(worst.batched <= 0.15, `batching drift too large: ${describe('batched')}`);
  assert.ok(mean <= 0.05, `mean batching drift too large: ${mean}`);
  console.log(`MNLI parity passed on ${result.device}: ${result.rows.length} comparisons, longest premise ${result.longestTokens} tokens, worst |Δ| ${worst.unpadded.toExponential(3)} unbatched / ${worst.batched.toFixed(4)} batched (mean ${mean.toFixed(4)})`);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
