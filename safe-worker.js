/* Cancellable, entirely local Safe Mode inference worker. */
'use strict';
importScripts('safe-policy.js', 'safe-scheduler.js');

const MODELS = Object.freeze({
  toxicity: { task: 'text-classification', id: 'onnx-community/distilbert-multilingual-toxicity-classifier-ONNX', revision: '4fbaccee8caaba02641b1757f7ef697e3fbffdb8' },
  text: { task: 'zero-shot-classification', id: 'Xenova/mobilebert-uncased-mnli', revision: '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee' },
  image: { task: 'zero-shot-image-classification', id: 'Xenova/clip-vit-base-patch32', revision: 'd15189d7028b43f1d3e65039190477f6af591c2a' },
});
let activeRun = null, pendingRun = null, transformersPromise = null, rememberedWasm = false;
let pipelines = { device: null, toxicity: null, text: null, image: null, textSupportsHandBatch: false, RawImage: null };
let scoreCache = new Map(), cacheEpoch = '', cacheSize = 0;
const MAX_CACHE_ENTRIES = 200000;
const nativeFetch = self.fetch.bind(self);
const allowedModelPrefixes = Object.values(MODELS).map(model => `https://huggingface.co/${model.id}/resolve/${model.revision}/`);
self.fetch = function guardedFetch(input, init) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  if (url.origin !== location.origin) {
    const method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
    const body = init && init.body;
    if (method !== 'GET' || body != null || !allowedModelPrefixes.some(prefix => url.href.startsWith(prefix))) return Promise.reject(new Error('Safe mode blocked an unexpected network request.'));
  }
  return nativeFetch(input, init);
};

function emit(type, runId, data) { postMessage(Object.assign({ type, runId }, data)); }
function progress(token, phase, completed, total, message, detail) { emit('progress', token.runId, { phase, completed, total, message, detail: detail || null }); }
function check(token) { if (token.cancelled || activeRun !== token) throw new Error('Cancelled'); }
function isEnglish(text, key) {
  const normalized = ` ${key != null ? key : SafePolicy.normalize(text)} `;
  if (/\b(hola|gracias|por favor|bonjour|merci|salut|avec|und|danke|bitte|hallo|ciao|grazie|buongiorno|ola|obrigado|voce|namaste|terima kasih)\b/.test(normalized)) return false;
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  return letters.filter(c => /[A-Za-z]/.test(c)).length / letters.length > 0.85;
}
function categoryForLabel(label) {
  const s = SafePolicy.normalize(label);
  if (/\b(not toxic|non toxic|safe)\b/.test(s)) return null;
  if (/toxic|insult|hate|threat|abuse/.test(s)) return 'abuse';
  if (/sexual|explicit|nudity/.test(s)) return 'sexual';
  if (/violence|self harm|suicide/.test(s)) return 'violence';
  if (/drug|weapon/.test(s)) return 'drugs';
  if (/crime|fraud|admission|planning/.test(s)) return 'crime';
  return null;
}
function elapsed(start) { return Math.round(performance.now() - start); }
function arrayResult(result, count) { return count === 1 && !Array.isArray(result[0]) ? [result] : result; }
function objectResult(result, count) { return count === 1 && !Array.isArray(result) ? [result] : result; }

async function transformers(token) {
  if (!transformersPromise) transformersPromise = import('./vendor/transformers-3.8.1.min.js');
  const t = await transformersPromise; check(token);
  t.env.allowLocalModels = false; t.env.useBrowserCache = true;
  t.env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', location.href).href;
  t.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  return t;
}
const HYPOTHESIS = label => `This example is ${label}.`;
async function mnliScores(pipe, pairs, maxLength) {
  const enc = pipe.tokenizer(pairs.map(p => p.premise), {
    text_pair: pairs.map(p => p.hypothesis), padding: true, truncation: true, max_length: maxLength });
  const { logits } = await pipe.model(enc);
  const width = logits.dims[1], data = logits.data;
  return pairs.map((_, row) => {
    const c = data[row * width + pipe.contradiction_id], e = data[row * width + pipe.entailment_id];
    return 1 / (1 + Math.exp(c - e));
  });
}
async function ensurePipelines(categories, imageEnabled, token) {
  const need = { toxicity: categories.includes('abuse'), text: categories.some(x => !['images', 'abuse'].includes(x)), image: imageEnabled };
  if (!need.toxicity && !need.text && !need.image) return { pipes: Object.assign({}, pipelines, { device: 'rules' }), duration: 0 };
  const started = performance.now(), total = Object.values(need).filter(Boolean).length;
  progress(token, 'initialization', 0, total, 'Loading the on-device screening runtime…');
  const t = await transformers(token);
  const preferred = rememberedWasm || !(typeof navigator !== 'undefined' && navigator.gpu) ? 'wasm' : 'webgpu';
  const createMissing = async device => {
    if (pipelines.device && pipelines.device !== device) pipelines = { device: null, toxicity: null, text: null, image: null, textSupportsHandBatch: false, RawImage: t.RawImage };
    pipelines.device = device; pipelines.RawImage = t.RawImage;
    let complete = 0;
    for (const key of ['toxicity', 'text', 'image']) if (need[key]) {
      check(token);
      if (!pipelines[key]) pipelines[key] = await t.pipeline(MODELS[key].task, MODELS[key].id, {
        revision: MODELS[key].revision, dtype: 'q8', device,
        progress_callback: p => { check(token); if (p.status === 'progress') progress(token, 'initialization', complete, total, `Downloading models… ${Math.round(p.progress || 0)}%`, p); },
      });
      if (key === 'text' && typeof pipelines[key].entailment_id === 'number' && typeof pipelines[key].contradiction_id === 'number') {
        pipelines.textSupportsHandBatch = true;
      }
      complete++; progress(token, 'initialization', complete, total, 'Preparing screening models…');
    }
  };
  try { await createMissing(preferred); }
  catch (error) {
    if (preferred !== 'webgpu' || token.cancelled) throw error;
    rememberedWasm = true; pipelines = { device: null, toxicity: null, text: null, image: null, textSupportsHandBatch: false, RawImage: t.RawImage };
    progress(token, 'initialization', 0, total, 'WebGPU unavailable for this model; retrying with WASM…');
    await createMissing('wasm');
  }
  return { pipes: pipelines, duration: elapsed(started) };
}
function askImages(names, token) {
  return new Promise((resolve, reject) => {
    token.imageResolve = resolve; token.imageReject = reject;
    emit('image-batch-request', token.runId, { names });
  });
}
function getCacheKey(model, text, label) {
  return `${model}:${text}:${label || ''}`;
}
function getCachedScore(model, text, label) {
  if (!text || cacheEpoch !== getCacheEpoch()) return null;
  const key = getCacheKey(model, text, label);
  return scoreCache.get(key);
}
function setCachedScore(model, text, label, score) {
  if (!text || !scoreCache) return;
  const cacheEpochNow = getCacheEpoch();
  if (cacheEpoch !== cacheEpochNow) {
    scoreCache.clear(); cacheSize = 0; cacheEpoch = cacheEpochNow;
  }
  const key = getCacheKey(model, text, label);
  if (!scoreCache.has(key)) {
    if (cacheSize >= MAX_CACHE_ENTRIES) {
      const firstKey = scoreCache.keys().next().value;
      scoreCache.delete(firstKey); cacheSize--;
    }
    cacheSize++;
  }
  scoreCache.set(key, score);
}
function getCacheEpoch() {
  return `${SafePolicy.VERSION}:${pipelines.device || 'none'}`;
}

async function analyse(data, token) {
  const totalStarted = performance.now(), timings = { initialization: 0, text: 0, image: 0, total: 0 };
  const categories = data.categories || [], terms = SafePolicy.customTerms(data.customTerms);
  const { groups, attachmentOwners } = SafeScheduler.preprocess(data.messages || [], isEnglish, SafePolicy.isScannable, SafePolicy.normalize);
  const findings = [];
  for (const group of groups) {
    const groupFindings = SafePolicy.ruleFindingsNormalized(` ${group.key} `, categories, terms);
    for (const owner of group.owners) for (const item of groupFindings) findings.push(Object.assign({ messageId: owner.id, _messageIndex: owner.index, _phase: 0 }, item));
  }
  const loaded = await ensurePipelines(categories, !!data.scanImages, token);
  const pipes = loaded.pipes; timings.initialization = loaded.duration; check(token);
  const textStarted = performance.now(), batchSize = pipes.device === 'webgpu' ? 32 : 16;
  const labels = categories.filter(x => x !== 'images').map(x => SafePolicy.LABELS[x]);
  const scannableGroups = groups.filter(group => group.scannable);
  if (pipes.toxicity) {
    const toxBucket = SafeScheduler.bucketed(scannableGroups, g => g.text.length);
    const results = await SafeScheduler.batched(toxBucket.items, batchSize, async batch => {
      check(token); return arrayResult(await pipes.toxicity(batch.map(x => x.text), { top_k: null }), batch.length);
    }, done => progress(token, 'text', done, scannableGroups.length, `Screening text ${done} of ${scannableGroups.length}…`));
    findings.push(...SafeScheduler.fanOut(scannableGroups, toxBucket.restore(results), result => (result || []).flatMap(item => {
      const category = categoryForLabel(item.label);
      return category === 'abuse' && item.score >= SafePolicy.THRESHOLDS.text ? [{ category, reason: `Multilingual toxicity model: ${item.label}`, score: item.score, source: 'model', _phase: 1 }] : [];
    })));
  }
  const englishGroups = scannableGroups.filter(group => group.english);
  if (pipes.text && labels.length) {
    let results;
    if (pipes.textSupportsHandBatch) {
      const pairs = [];
      for (const group of englishGroups) for (const label of labels) pairs.push({ premise: group.text, hypothesis: HYPOTHESIS(label) });
      const scores = await mnliScores(pipes.text, pairs, 128); check(token);
      results = [];
      for (let g = 0; g < englishGroups.length; g++) results.push({ labels: labels.slice(), scores: scores.slice(g * labels.length, (g + 1) * labels.length) });
    } else {
      results = await SafeScheduler.batched(englishGroups, batchSize, async batch => {
        check(token); return objectResult(await pipes.text(batch.map(x => x.text), labels, { multi_label: true }), batch.length);
      }, done => progress(token, 'text', done, englishGroups.length, `Screening text ${done} of ${englishGroups.length}…`));
    }
    findings.push(...SafeScheduler.fanOut(englishGroups, results, result => (result.labels || []).flatMap((label, index) => {
      const category = categoryForLabel(label);
      return category && result.scores[index] >= SafePolicy.THRESHOLDS.text ? [{ category, reason: `Text model: ${label}`, score: result.scores[index], source: 'model', _phase: 2 }] : [];
    })));
  }
  timings.text = elapsed(textStarted); check(token);

  const unanalysed = [], imageStarted = performance.now(), imageNames = data.scanImages && pipes.image ? [...attachmentOwners.keys()] : [];
  const imageBatchSize = pipes.device === 'webgpu' ? 4 : 2;
  for (let offset = 0; offset < imageNames.length;) {
    check(token);
    const names = imageNames.slice(offset, offset + imageBatchSize), buffers = await askImages(names, token); check(token);
    const decoded = [];
    for (let index = 0; index < names.length; index++) {
      if (!buffers[index]) { unanalysed.push(names[index]); continue; }
      try { decoded.push({ name: names[index], raw: await pipes.RawImage.fromBlob(new Blob([buffers[index]])) }); }
      catch (error) { unanalysed.push(names[index]); }
    }
    if (decoded.length) {
      const results = await SafeScheduler.batched(decoded, imageBatchSize, async batch => {
        check(token); return arrayResult(await pipes.image(batch.map(x => x.raw), ['safe image', 'nudity or sexual content', 'graphic violence', 'drugs or weapons']), batch.length);
      });
      decoded.forEach((item, index) => {
        for (const result of results[index] || []) if (result.label !== 'safe image' && result.score >= SafePolicy.THRESHOLDS.image) {
          for (const owner of attachmentOwners.get(item.name) || []) findings.push({ messageId: owner.id, category: 'images', reason: `Image model: ${result.label}`, score: result.score, source: 'model', attachment: item.name, _messageIndex: owner.index, _phase: 3 });
        }
      });
    }
    offset += names.length; progress(token, 'image', offset, imageNames.length, `Screening images ${offset} of ${imageNames.length}…`);
  }
  timings.image = elapsed(imageStarted); timings.total = elapsed(totalStarted); check(token);
  const partialCoverage = labels.length ? scannableGroups.some(group => !group.english) : false;
  emit('complete', token.runId, { findings: SafePolicy.mergeFindings(SafeScheduler.ordered(findings)), unanalysed, partialCoverage, device: pipes.device, policyVersion: SafePolicy.VERSION, timings });
}

onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    if (activeRun && (!data.runId || data.runId === activeRun.runId)) { activeRun.cancelled = true; if (activeRun.imageReject) activeRun.imageReject(new Error('Cancelled')); activeRun.imageResolve = activeRun.imageReject = null; }
    if (pendingRun && data.runId === pendingRun.runId) pendingRun = null;
    return;
  }
  if (data.type === 'image-batch-response') {
    if (activeRun && data.runId === activeRun.runId && activeRun.imageResolve) { const resolve = activeRun.imageResolve; activeRun.imageResolve = activeRun.imageReject = null; resolve(data.buffers || []); }
    return;
  }
  if (data.type !== 'analyse') return;
  if (!activeRun) {
    const token = { runId: data.runId, cancelled: false }; activeRun = token;
    analyse(data, token).catch(error => { if (!token.cancelled) emit('error', token.runId, { message: error.message || String(error), fatal: true }); }).finally(() => {
      emit('cancelled', token.runId, {});
      if (activeRun === token) activeRun = null;
      if (pendingRun) { const next = pendingRun; pendingRun = null; self.postMessage(next); }
    });
  } else {
    activeRun.cancelled = true; pendingRun = data; if (activeRun.imageReject) activeRun.imageReject(new Error('Cancelled'));
  }
};
emit('ready', null, { policyVersion: SafePolicy.VERSION, models: MODELS });
