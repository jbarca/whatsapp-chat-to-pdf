/* Safe Mode Stage 5 recall gate — does a cascade prefilter still flag everything today's MNLI pass flags?
   The acceptance criterion is agreement with today's pipeline, not ground truth, so no human labels exist:
   one recorded reference run over test/safe-eval-corpus.json is the oracle. Per the plan: without this
   gate, do not ship the stage.

   SAFE_RECALL_EVAL=1 gates the run; unset, it prints a skip line and exits 0.
   SAFE_RECALL_WRITE=1 records the reference instead of asserting (assert mode is the default).
   SAFE_RECALL_REFERENCE=path overrides test/safe-eval-reference.json.
   SAFE_RECALL_LIMIT=n scores at most n corpus items — a stratified round robin over
     benign + the 5 adversarial categories in corpus order, so even n=40 touches every category.
     A reference written with a limit is marked complete:false and is NOT the Stage 5 reference.
   SAFE_RECALL_CORPUS=path overrides test/safe-eval-corpus.json.
   SAFE_RECALL_DEVICE=wasm|webgpu pins the backend (default wasm: reproducible on any machine).
   SAFE_RECALL_BATCH=n overrides the production batch size (16 wasm / 32 webgpu). q8 shares one
     activation scale across a padded batch, so batch composition moves scores by up to ~0.15
     (test/safe-parity.mjs measures this) — hence device and batch size are part of the epoch, and
     SAFE_RECALL_BATCH=1 is the composition-independent canonical scoring if ever needed.
   SAFE_RECALL_MIN=0.995 sets the per-category recall floor.
   SAFE_RECALL_JSON=path also writes the full assert-mode report.
   CHROME_CHANNEL overrides the Playwright browser channel.

   Full reference run (~25,425 MNLI pairs, many minutes, one cold ~300 MB model download):
     SAFE_RECALL_EVAL=1 SAFE_RECALL_WRITE=1 ~/.nvm/versions/node/v26.8.1/bin/node test/safe-recall.mjs
   Then the gate itself, which is what CI and Stage 5 run:
     SAFE_RECALL_EVAL=1 ~/.nvm/versions/node/v26.8.1/bin/node test/safe-recall.mjs

   Scores are raw MNLI entailment, never thresholded findings, so a different THRESHOLDS.text can be
   re-derived from the committed reference without re-running the model. Only the English MNLI phase is
   measured: the prefilter gates nothing else. `abuse` additionally has the multilingual toxicity model,
   which is ungated, so its shipped recall is at least the number reported here. Rule-phrase hits are
   deterministic (phase 0, model-independent) and are excluded from the recall denominator. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

if (process.env.SAFE_RECALL_EVAL !== '1') {
  console.log('safe recall eval skipped (set SAFE_RECALL_EVAL=1)');
  process.exit(0);
}

const require = createRequire(import.meta.url), SafePolicy = require('../safe-policy.js');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const CATEGORIES = ['abuse', 'sexual', 'violence', 'drugs', 'crime'];
const CORPUS = process.env.SAFE_RECALL_CORPUS || fileURLToPath(new URL('./safe-eval-corpus.json', import.meta.url));
const REFERENCE = process.env.SAFE_RECALL_REFERENCE || fileURLToPath(new URL('./safe-eval-reference.json', import.meta.url));
const WRITE = process.env.SAFE_RECALL_WRITE === '1';
const LIMIT = Number(process.env.SAFE_RECALL_LIMIT || 0);
const DEVICE = process.env.SAFE_RECALL_DEVICE === 'webgpu' ? 'webgpu' : 'wasm';
const BATCH = Number(process.env.SAFE_RECALL_BATCH || 0) || null;
const FLOOR = Number(process.env.SAFE_RECALL_MIN || 0.995);
const THRESHOLD = SafePolicy.THRESHOLDS.text;

const corpus = JSON.parse(await readFile(CORPUS, 'utf8'));
assert.ok(Array.isArray(corpus.messages) && corpus.messages.length, `${CORPUS} has no messages`);
assert.deepEqual(corpus.categories, CATEGORIES, 'the corpus categories do not match this gate');

/* Stratified round robin so a small SAFE_RECALL_LIMIT still covers every category. Strata are visited
   benign-first in a fixed order and drained in corpus order, then the selection is restored to corpus
   order — subsetting is therefore a pure function of (corpus, limit), and the group dedup the worker
   then does is exactly what production would do for that message list. */
const selectItems = (messages, limit) => {
  if (!limit || limit >= messages.length) return messages.slice();
  const strata = new Map([['benign', []], ...CATEGORIES.map(category => [category, []])]);
  messages.forEach((message, index) => {
    const stratum = message.kind === 'adversarial' ? message.category : 'benign';
    (strata.get(stratum) || strata.get('benign')).push(index);
  });
  const queues = [...strata.values()], chosen = [];
  for (let round = 0; chosen.length < limit; round++) {
    let drew = 0;
    for (const queue of queues) {
      if (chosen.length >= limit) break;
      if (round < queue.length) { chosen.push(queue[round]); drew++; }
    }
    if (!drew) break;
  }
  return chosen.sort((a, b) => a - b).map(index => messages[index]);
};
const items = selectItems(corpus.messages, LIMIT);
const complete = items.length === corpus.messages.length;
const byId = new Map(items.map(message => [message.id, message]));

/* ── the harness worker ──────────────────────────────────────────────────────────────────────────
   Served from the site root so safe-worker.js and its own importScripts resolve relatively, exactly as
   test/safe-parity.mjs does. The production worker only ever emits thresholded findings, so raw scores
   have to come from driving the shipped preprocess/bucketed/batched/mnliScores directly. Nothing in
   safe-worker.js is modified or copied here. */
const harness = `
importScripts('safe-worker.js');
const CATEGORIES = ${JSON.stringify(CATEGORIES)};
onmessage = async ({ data }) => {
  try {
    const token = { runId: 1, cancelled: false };
    activeRun = token;
    /* ensurePipelines prefers webgpu only when navigator.gpu exists and wasm was never forced. */
    rememberedWasm = data.device !== 'webgpu';
    const labels = CATEGORIES.map(category => SafePolicy.LABELS[category]);
    const { groups } = SafeScheduler.preprocess(data.messages, isEnglish, SafePolicy.isScannable, SafePolicy.normalize);
    const loaded = await ensurePipelines(CATEGORIES, false, token);
    const pipes = loaded.pipes;
    if (!pipes.text || !pipes.textSupportsHandBatch) throw new Error('the text pipeline does not expose entailment ids, so raw MNLI scores are unavailable');
    const batchSize = data.batchSize || (pipes.device === 'webgpu' ? 32 : 16);
    const rows = groups.map(group => ({
      owners: group.owners.map(owner => owner.id), english: !!group.english, scannable: !!group.scannable,
      rules: SafePolicy.ruleFindingsNormalized(' ' + group.key + ' ', CATEGORIES, []).map(finding => finding.category),
      scores: null, passed: null,
    }));
    const eligible = [];
    groups.forEach((group, index) => { if (group.scannable && group.english) eligible.push({ group, index }); });

    /* Stage 5 reporting hook, deliberately in place before the prefilter exists. safe-worker.js defines
       no prefilterGroups today, so every (group, label) pair survives and the pass rate is 1.0. Stage 5
       must expose prefilterGroups(pipes, groups, labels, token) returning one entry per group:
       null/true = keep every label, false = drop the group, or an array of booleans per label. */
    const hook = typeof prefilterGroups === 'function' ? prefilterGroups : null;
    const keep = hook ? await hook(pipes, eligible.map(entry => entry.group), labels, token) : null;
    const survives = (slot, label) => {
      if (!keep) return true;
      const entry = keep[slot];
      if (entry == null || entry === true) return true;
      if (entry === false) return false;
      return entry[label] !== false;
    };
    const passed = eligible.map((_, slot) => labels.map((__, label) => survives(slot, label)));
    const pairs = [];
    eligible.forEach((entry, slot) => labels.forEach((label, index) => {
      if (passed[slot][index]) pairs.push({ premise: entry.group.text, hypothesis: HYPOTHESIS(label), slot, label: index });
    }));

    const textStarted = performance.now();
    const bucket = SafeScheduler.bucketed(pairs, pair => pair.premise.length);
    const scores = bucket.restore(await SafeScheduler.batched(bucket.items, batchSize, async batch => {
      check(token); return mnliScores(pipes.text, batch, 128);
    }, done => postMessage({ type: 'recall-progress', done, total: pairs.length, ms: Math.round(performance.now() - textStarted) }), isCancellation));
    const textMs = Math.round(performance.now() - textStarted);
    eligible.forEach((entry, slot) => {
      rows[entry.index].scores = labels.map(() => null);
      rows[entry.index].passed = passed[slot];
    });
    pairs.forEach((pair, index) => { rows[eligible[pair.slot].index].scores[pair.label] = scores[index]; });

    activeRun = null;
    postMessage({
      type: 'recall', device: pipes.device, batchSize, labels, rows, prefilterHook: !!hook,
      dtype: DTYPE, models: MODELS, policyVersion: SafePolicy.VERSION,
      counts: { groups: groups.length, eligibleGroups: eligible.length, eligiblePairs: eligible.length * labels.length, pairs: pairs.length },
      timings: { initialization: loaded.duration, text: textMs },
    });
  } catch (error) { activeRun = null; postMessage({ type: 'recall-error', message: error.message || String(error), stack: String(error && error.stack || '') }); }
};
`;

/* ── serve the site, drive Chrome ─────────────────────────────────────────────────────────────── */
const { chromium } = require('playwright');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
const packed = new Map(), servedWasm = {};
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(req.url.split('?')[0]);
  if (requested === '/recall-worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(harness); return; }
  try {
    const path = await realpath(join(root, requested.replace(/^\/+/, '')));
    if (!path.startsWith(root + '/')) throw new Error('blocked');
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    const body = await readFile(path);
    if (extname(path) !== '.wasm' || !/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return res.end(body);
    if (!packed.has(path)) packed.set(path, gzipSync(body));
    servedWasm[basename(path)] = { raw: body.length, gzip: packed.get(path).length };
    res.setHeader('Content-Encoding', 'gzip'); res.end(packed.get(path));
  } catch (error) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`safe recall eval: ${items.length} of ${corpus.messages.length} corpus items${complete ? ' (complete)' : ` (SAFE_RECALL_LIMIT=${LIMIT}, PARTIAL)`}, device ${DEVICE}, ${WRITE ? 'write' : 'assert'} mode`);

const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
let measured, chromeVersion = browser.version();
const started = Date.now();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
  page.on('pageerror', error => console.log(`page error: ${error.message}`));
  let lastLog = 0;
  await page.exposeFunction('recallProgress', (done, total, ms) => {
    if (done !== total && Date.now() - lastLog < 15000) return;
    lastLog = Date.now();
    const rate = ms ? (done / (ms / 1000)).toFixed(1) : '0';
    const eta = done ? Math.round((total - done) * (ms / done) / 1000) : 0;
    console.log(`  MNLI ${done}/${total} pairs, ${Math.round(ms / 1000)} s elapsed, ${rate} pairs/s, ~${eta} s left`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  measured = await page.evaluate(async payload => {
    const worker = new Worker('recall-worker.js');
    await new Promise((resolve, reject) => { worker.onmessage = event => event.data.type === 'ready' && resolve(); worker.onerror = reject; });
    const data = await new Promise((resolve, reject) => {
      worker.onmessage = event => {
        if (event.data.type === 'recall-progress') window.recallProgress(event.data.done, event.data.total, event.data.ms);
        else if (event.data.type === 'recall') resolve(event.data);
        else if (event.data.type === 'recall-error') reject(new Error(`${event.data.message}\n${event.data.stack}`));
      };
      worker.onerror = reject;
      worker.postMessage(payload);
    });
    worker.terminate();
    return data;
  }, { messages: items.map(message => ({ id: message.id, text: message.text })), device: DEVICE, batchSize: BATCH });
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
const wall = Math.round((Date.now() - started) / 1000);

/* ── fan the group scores back out to corpus items ─────────────────────────────────────────────── */
const round6 = value => Math.round(value * 1e6) / 1e6;
const scores = {}, unscored = {}, passed = {};
for (const row of measured.rows) {
  const reason = !row.scannable ? 'not-scannable' : !row.english ? 'non-english' : null;
  for (const id of row.owners) {
    if (reason) { unscored[id] = reason; scores[id] = null; continue; }
    scores[id] = row.scores.map(score => (score == null ? null : round6(score)));
    passed[id] = row.passed;
  }
}
assert.equal(Object.keys(scores).length, items.length, `scored ${Object.keys(scores).length} items but selected ${items.length}`);

const model = measured.models.text;
const provenance = {
  corpus: { file: 'test/safe-eval-corpus.json', version: corpus.version, seed: corpus.seed, digest: corpus.digest, messages: corpus.messages.length },
  subset: { complete, mode: complete ? 'full' : 'stratified', limit: LIMIT || null, items: items.length, of: corpus.messages.length },
  threshold: THRESHOLD, policyVersion: measured.policyVersion,
  model: { task: model.task, id: model.id, revision: model.revision, dtype: measured.dtype },
  device: measured.device, requestedDevice: DEVICE, batchSize: measured.batchSize,
  prefilterHook: measured.prefilterHook, counts: measured.counts,
  timings: Object.assign({ wallSeconds: wall }, measured.timings),
  pairsPerSecond: measured.timings.text ? round6(measured.counts.pairs / (measured.timings.text / 1000)) : null,
  node: process.version, chrome: chromeVersion, wasm: servedWasm,
};
/* Hard fields: a reference recorded under any of these describes a different experiment, so comparing
   against it would be silently wrong rather than merely stale. policyVersion is deliberately NOT here —
   Stage 5 bumps it by design, and the whole point of the gate is to compare across that bump. */
const EPOCH_FIELDS = [
  ['corpus.digest', p => p.corpus.digest], ['corpus.version', p => p.corpus.version], ['corpus.seed', p => p.corpus.seed],
  ['subset.complete', p => p.subset.complete], ['subset.items', p => p.subset.items], ['subset.limit', p => p.subset.limit],
  ['threshold', p => p.threshold], ['model.id', p => p.model.id], ['model.revision', p => p.model.revision],
  ['model.dtype', p => p.model.dtype], ['device', p => p.device], ['batchSize', p => p.batchSize],
];
const epochOf = p => EPOCH_FIELDS.map(([name, read]) => `${name}=${read(p)}`).join('|');

/* ── flagged sets and recall ──────────────────────────────────────────────────────────────────── */
const flaggedSet = (table, gate) => CATEGORIES.map((category, index) => {
  const out = [];
  for (const [id, row] of Object.entries(table)) {
    if (!row || row[index] == null || row[index] < THRESHOLD) continue;
    if ((byId.get(id)?.rules || []).includes(category)) continue; /* phase 0 flags these regardless of the model */
    if (gate && !(passed[id] || [])[index]) continue;
    out.push(id);
  }
  return out.sort();
});
const summarize = table => CATEGORIES.map((category, index) => {
  const rows = Object.entries(table).filter(([, row]) => row && row[index] != null);
  const modelFlagged = rows.filter(([id, row]) => row[index] >= THRESHOLD && !(byId.get(id)?.rules || []).includes(category));
  const own = id => byId.get(id)?.kind === 'adversarial' && byId.get(id)?.category === category;
  return {
    scored: rows.length, flagged: modelFlagged.length,
    /* The recall-relevant slice: adversarial items written FOR this category that the model itself flags. */
    ownCategoryScored: rows.filter(([id]) => own(id)).length,
    ownCategoryFlagged: modelFlagged.filter(([id]) => own(id)).length,
    ruleFlagged: Object.keys(table).filter(id => (byId.get(id)?.rules || []).includes(category)).length,
  };
});

const nowFlagged = flaggedSet(scores, true);
const summary = summarize(scores);
const counts = Object.fromEntries(CATEGORIES.map((category, index) => [category, summary[index]]));
const pairPassRate = measured.counts.eligiblePairs ? measured.counts.pairs / measured.counts.eligiblePairs : 1;

const notes = [
  'Raw MNLI entailment scores, never thresholded findings, so a different SafePolicy.THRESHOLDS.text can be re-derived without re-running the model.',
  'scores[id] = one entailment score per entry of categories[], in that order. null = the English MNLI pass never scored it (see unscored), or the Stage 5 prefilter dropped that label.',
  'Duplicate messages share one group (SafeScheduler.preprocess dedups on SafePolicy.normalize), so identical texts carry identical scores by construction.',
  'Rule-phrase hits (corpus messages[].rules) are deterministic phase-0 findings and are excluded from the recall denominator; a prefilter cannot lose them.',
  'q8 shares one activation scale across a padded batch, so scores near the threshold can move on batch composition alone (test/safe-parity.mjs bounds the drift at 0.15 worst / 0.05 mean). device and batchSize are therefore part of the staleness epoch.',
  'abuse is also covered by the ungated multilingual toxicity model, so its shipped recall is at least the MNLI recall measured here.',
];
if (!complete) notes.unshift(`PARTIAL: recorded over ${items.length} of ${corpus.messages.length} corpus items (SAFE_RECALL_LIMIT=${LIMIT}). This is a smoke-test recording, NOT the Stage 5 reference. Re-record with SAFE_RECALL_EVAL=1 SAFE_RECALL_WRITE=1 and no SAFE_RECALL_LIMIT.`);

const serialize = document => {
  const { scores: table, ...head } = document;
  const lines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const rows = Object.entries(table).map(([id, row]) => `    ${JSON.stringify(id)}: ${JSON.stringify(row)}`);
  return `{\n${lines.join(',\n')},\n  "scores": {\n${rows.join(',\n')}\n  }\n}\n`;
};

if (WRITE) {
  const document = {
    kind: 'safe-eval-reference', version: 1,
    complete, warning: complete ? null : `PARTIAL smoke recording over ${items.length} of ${corpus.messages.length} items — not the Stage 5 reference`,
    generated: new Date().toISOString(), epoch: epochOf(provenance), provenance,
    categories: CATEGORIES, labels: Object.fromEntries(CATEGORIES.map(category => [category, SafePolicy.LABELS[category]])),
    counts: Object.assign({ items: items.length, unscored: Object.keys(unscored).length, pairPassRate: round6(pairPassRate) }, { perCategory: counts }),
    notes, unscored, scores,
  };
  await writeFile(REFERENCE, serialize(document));
  console.log(`reference recorded to ${REFERENCE}${complete ? '' : ' — PARTIAL, complete:false'}`);
  console.log(`  ${measured.counts.pairs} MNLI pairs over ${measured.counts.eligibleGroups} English scannable groups (${measured.counts.groups} groups, ${Object.keys(unscored).length} items unscored), device ${measured.device}, batch ${measured.batchSize}`);
  console.log(`  init ${measured.timings.initialization} ms, text ${measured.timings.text} ms (${provenance.pairsPerSecond} pairs/s), wall ${wall} s`);
  for (const category of CATEGORIES) console.log(`  ${category}: ${counts[category].flagged} of ${counts[category].scored} scored items flagged, ${counts[category].ownCategoryFlagged}/${counts[category].ownCategoryScored} of its own adversarial items (+${counts[category].ruleFlagged} rule-flagged, excluded)`);
  console.log('no assertions ran (unset SAFE_RECALL_WRITE to assert against this reference)');
  process.exit(0);
}

/* ── assert mode ──────────────────────────────────────────────────────────────────────────────── */
const raw = await readFile(REFERENCE, 'utf8').catch(() => null);
assert.ok(raw !== null, `${REFERENCE} is missing — record it first with SAFE_RECALL_EVAL=1 SAFE_RECALL_WRITE=1 node test/safe-recall.mjs`);
const reference = JSON.parse(raw);
assert.equal(reference.kind, 'safe-eval-reference', `${REFERENCE} is not a recall reference`);
const drift = EPOCH_FIELDS.filter(([, read]) => String(read(reference.provenance)) !== String(read(provenance)))
  .map(([name, read]) => `  ${name}: reference ${read(reference.provenance)} → this run ${read(provenance)}`);
assert.ok(!drift.length, `the reference describes a different experiment, so recall against it would be meaningless:\n${drift.join('\n')}\nRe-record it with SAFE_RECALL_WRITE=1, or match the reference's settings.`);
if (reference.provenance.policyVersion !== provenance.policyVersion) console.log(`note: SafePolicy.VERSION ${reference.provenance.policyVersion} → ${provenance.policyVersion} since the reference (expected across a stage bump)`);
if (!reference.complete) console.log(`note: the reference is PARTIAL (${reference.provenance.subset.items} of ${reference.provenance.subset.of} items) — this run only proves the gate works, not the stage`);
const missing = items.filter(message => !(message.id in reference.scores));
assert.ok(!missing.length, `the reference does not cover ${missing.length} selected item(s), e.g. ${missing.slice(0, 3).map(message => message.id).join(', ')} — re-record it over the same selection`);

const refFlagged = flaggedSet(Object.fromEntries(items.map(message => [message.id, reference.scores[message.id]])), false);
const report = { epoch: epochOf(provenance), provenance, prefilter: { hook: measured.prefilterHook, pairsRun: measured.counts.pairs, pairsEligible: measured.counts.eligiblePairs, passRate: round6(pairPassRate) }, perCategory: {} };
const failures = [];
CATEGORIES.forEach((category, index) => {
  const before = refFlagged[index], after = new Set(nowFlagged[index]);
  const lost = before.filter(id => !after.has(id)), gained = nowFlagged[index].filter(id => !before.includes(id));
  const recall = before.length ? (before.length - lost.length) / before.length : null;
  const eligible = measured.rows.filter(row => row.english && row.scannable).length;
  const passedGroups = measured.rows.filter(row => row.passed && row.passed[index]).length;
  report.perCategory[category] = {
    referenceFlagged: before.length, nowFlagged: after.size, lost: lost.length, gained: gained.length,
    recall: recall == null ? null : round6(recall), floor: FLOOR,
    prefilterPassRate: eligible ? round6(passedGroups / eligible) : 1,
    lostExamples: lost.slice(0, 10).map(id => ({
      id, referenceScore: reference.scores[id][index], nowScore: (scores[id] || [])[index],
      prefilterDropped: !(passed[id] || [])[index], kind: byId.get(id)?.kind, axis: byId.get(id)?.axis, text: byId.get(id)?.text,
    })),
  };
  if (!before.length) {
    const message = `${category}: the reference flagged nothing, so recall is vacuous`;
    if (complete) failures.push(`${message} — with ${corpus.counts.perCategory[category]} adversarial items that means the reference is broken`);
    else console.log(`note: ${message} (subset too small to cover it)`);
    return;
  }
  if (recall < FLOOR) {
    failures.push([
      `${category}: recall ${(recall * 100).toFixed(2)}% < ${(FLOOR * 100).toFixed(2)}% — ${lost.length} of ${before.length} reference findings lost`,
      ...report.perCategory[category].lostExamples.map(example =>
        `    ${example.id} (${example.axis || example.kind}${example.prefilterDropped ? ', prefilter dropped' : ', score fell'}): ${example.referenceScore} → ${example.nowScore == null ? 'not scored' : example.nowScore}\n      ${JSON.stringify(example.text)}`),
    ].join('\n'));
  }
});

console.log(`prefilter: ${measured.prefilterHook ? 'active' : 'absent (no prefilterGroups in safe-worker.js — pass rate is trivially 1.0 until Stage 5)'}, ${measured.counts.pairs}/${measured.counts.eligiblePairs} MNLI pairs run (${(pairPassRate * 100).toFixed(1)}%)`);
for (const category of CATEGORIES) {
  const row = report.perCategory[category];
  console.log(`  ${category}: recall ${row.recall == null ? 'n/a' : `${(row.recall * 100).toFixed(2)}%`} (${row.referenceFlagged - row.lost}/${row.referenceFlagged} kept, ${row.gained} gained), prefilter pass ${(row.prefilterPassRate * 100).toFixed(1)}%`);
}
console.log(`device ${measured.device}, batch ${measured.batchSize}, init ${measured.timings.initialization} ms, text ${measured.timings.text} ms (${provenance.pairsPerSecond} pairs/s), wall ${wall} s`);
if (process.env.SAFE_RECALL_JSON) { await writeFile(process.env.SAFE_RECALL_JSON, `${JSON.stringify(report, null, 2)}\n`); console.log(`report written to ${process.env.SAFE_RECALL_JSON}`); }
assert.ok(!failures.length, `Stage 5 recall gate FAILED — do not ship the stage:\n${failures.join('\n')}`);
console.log(`safe recall gate passed: every category at or above ${(FLOOR * 100).toFixed(2)}% recall of the reference flagged set over ${items.length} corpus items${complete ? '' : ' (PARTIAL subset)'}`);
