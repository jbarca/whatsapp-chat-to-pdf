/* Cancellable, entirely local Safe Mode inference worker. */
'use strict';
importScripts('safe-policy.js?v=1.2.0', 'safe-scheduler.js?v=1.2.0');

const MODELS = Object.freeze({
  toxicity: { task: 'text-classification', id: 'onnx-community/distilbert-multilingual-toxicity-classifier-ONNX', revision: '4fbaccee8caaba02641b1757f7ef697e3fbffdb8' },
  text: { task: 'zero-shot-classification', id: 'Xenova/mobilebert-uncased-mnli', revision: '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee' },
  image: { task: 'zero-shot-image-classification', id: 'Xenova/clip-vit-base-patch32', revision: 'd15189d7028b43f1d3e65039190477f6af591c2a' },
});
let activeRun = null, pendingRun = null, transformersPromise = null, rememberedWasm = false;
let pipelines = { device: null, toxicity: null, text: null, image: null, textSupportsHandBatch: false, imageProto: null, RawImage: null };
let scoreCache = new Map(), cacheEpoch = '', cacheCharTotal = 0;
const MAX_CACHE_ENTRIES = 200000, MAX_CACHE_CHARS = 8_000_000, DTYPE = 'q8';
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
function textProgress(token, done, total) { progress(token, 'text', done, total, `Screening text ${done} of ${total}…`); }
function cancellation() { const error = new Error('Cancelled'); error.cancelled = true; return error; }
function isCancellation(error) { return !!(error && error.cancelled); }
function check(token) { if (token.cancelled || activeRun !== token) throw cancellation(); }
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
/* Cached CLIP text prototypes. The zero-shot image pipeline re-runs the text tower for all four
   labels on every batch, but the labels are constant, so run it once per session, keep the 4xN
   `text_embeds`, and do the cosine / logit_scale softmax here. The fused CLIP graph still requires
   `input_ids` and `attention_mask`, so each batch feeds a throwaway two-token prompt and ignores
   its text outputs; `calibrateImagePrototypes` proves that the vision tower really is independent
   of the text inputs, and that the scores it computes match the pipeline's, before the fast path is
   used. Anything it cannot prove leaves `supported: false` and the plain pipeline call is used
   instead, exactly as `mnliScores` falls back for MNLI. Everything downstream reads only
   `labels`/`text`/`width`/`scale`/`dummy`, so the prototypes can later come from a committed
   constant instead of a calibration pass without touching the scoring code. */
const IMAGE_LABELS = Object.freeze(['safe image', 'nudity or sexual content', 'graphic violence', 'drugs or weapons']);
const IMAGE_HYPOTHESIS = label => `This is a photo of ${label}`;
/* Output names of the fused CLIP graph, verified against the pinned Xenova/clip-vit-base-patch32
   revision. Named so a rename in a future model or transformers.js release trips the guard below
   rather than silently reading `undefined`. */
const IMAGE_OUTPUTS = Object.freeze({ text: 'text_embeds', image: 'image_embeds', logits: 'logits_per_image' });
const IMAGE_SCORE_TOLERANCE = 1e-3, IMAGE_EMBED_TOLERANCE = 1e-5;

/* Reproduces the vendored bundle's softmax: float32 exponentials, a float64 sum, a float32
   division. Keeping the arithmetic identical keeps the fast path from drifting from the pipeline. */
function softmax32(row) {
  let max = -Infinity;
  for (let index = 0; index < row.length; index++) if (row[index] > max) max = row[index];
  const exps = new Float32Array(row.length);
  let sum = 0;
  for (let index = 0; index < row.length; index++) { exps[index] = Math.exp(row[index] - max); sum += exps[index]; }
  const out = new Float32Array(row.length);
  for (let index = 0; index < row.length; index++) out[index] = exps[index] / sum;
  return out;
}
function isEmbedTensor(tensor, rows, width) {
  return !!(tensor && tensor.dims && tensor.dims.length === 2 && tensor.dims[0] === rows && tensor.dims[1] > 0
    && (width === undefined || tensor.dims[1] === width)
    && tensor.data && tensor.data.length === rows * tensor.dims[1]);
}
function normalizedRows(data, rows, width) {
  const out = new Float32Array(rows * width);
  for (let row = 0; row < rows; row++) {
    let sum = 0;
    for (let column = 0; column < width; column++) { const value = data[row * width + column]; sum += value * value; }
    const inverse = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let column = 0; column < width; column++) out[row * width + column] = data[row * width + column] * inverse;
  }
  return out;
}
function cosine(a, aRow, b, bRow, width) {
  let sum = 0;
  for (let column = 0; column < width; column++) sum += a[aRow * width + column] * b[bRow * width + column];
  return sum;
}
function rankImage(embeds, row, proto) {
  const logits = new Float32Array(proto.labels.length);
  for (let label = 0; label < proto.labels.length; label++) logits[label] = proto.scale * cosine(embeds, row, proto.text, label, proto.width);
  const scores = softmax32(logits);
  return proto.labels.map((label, index) => ({ score: scores[index], label })).sort((a, b) => b.score - a.score);
}
async function calibrateImagePrototypes(pipe, RawImage, token) {
  const unsupported = { labels: IMAGE_LABELS.slice(), text: null, width: 0, scale: 0, dummy: null, supported: false };
  try {
    if (typeof pipe !== 'function' || typeof pipe.tokenizer !== 'function' || typeof pipe.processor !== 'function' || typeof pipe.model !== 'function' || typeof RawImage !== 'function') return unsupported;
    if (!pipe.model.config || pipe.model.config.model_type === 'siglip') return unsupported;
    const labels = unsupported.labels;
    const tokenize = texts => pipe.tokenizer(texts, { padding: true, truncation: true });
    const { pixel_values } = await pipe.processor([new RawImage(new Uint8ClampedArray(3), 1, 1, 3)]); check(token);
    if (!pixel_values || !pixel_values.dims || pixel_values.dims[0] !== 1) return unsupported;
    const full = await pipe.model(Object.assign({}, tokenize(labels.map(IMAGE_HYPOTHESIS)), { pixel_values })); check(token);
    const text = full[IMAGE_OUTPUTS.text], image = full[IMAGE_OUTPUTS.image], logits = full[IMAGE_OUTPUTS.logits];
    if (!isEmbedTensor(text, labels.length) || !isEmbedTensor(image, 1, text.dims[1]) || !isEmbedTensor(logits, 1, labels.length)) return unsupported;
    const width = text.dims[1];
    const prototypes = normalizedRows(text.data, labels.length, width), probe = normalizedRows(image.data, 1, width);
    /* logits_per_image = logit_scale * image_embeds . text_embeds, so recover the scale by least
       squares over the four pairs instead of trusting a hard-coded constant. */
    const similarities = labels.map((_, label) => cosine(probe, 0, prototypes, label, width));
    let numerator = 0, denominator = 0;
    for (let label = 0; label < similarities.length; label++) { numerator += similarities[label] * logits.data[label]; denominator += similarities[label] * similarities[label]; }
    if (!(denominator > 0)) return unsupported;
    const scale = numerator / denominator;
    if (!isFinite(scale) || scale <= 0) return unsupported;
    const mine = softmax32(Float32Array.from(similarities, similarity => scale * similarity)), reference = softmax32(logits.data);
    for (let label = 0; label < mine.length; label++) if (!(Math.abs(mine[label] - reference[label]) <= IMAGE_SCORE_TOLERANCE)) return unsupported;
    /* Every later batch feeds a throwaway prompt, which is only sound because CLIP's towers are
       independent. Prove that on this probe image rather than assuming it. */
    const dummy = tokenize(['']);
    const lean = await pipe.model(Object.assign({}, dummy, { pixel_values })); check(token);
    if (!isEmbedTensor(lean[IMAGE_OUTPUTS.image], 1, width)) return unsupported;
    const leanProbe = normalizedRows(lean[IMAGE_OUTPUTS.image].data, 1, width);
    for (let column = 0; column < width; column++) if (!(Math.abs(leanProbe[column] - probe[column]) <= IMAGE_EMBED_TOLERANCE)) return unsupported;
    return { labels, text: prototypes, width, scale, dummy, supported: true };
  } catch (error) { if (isCancellation(error)) throw error; return unsupported; }
}
async function imageScores(pipe, raws, proto) {
  const { pixel_values } = await pipe.processor(raws);
  const out = await pipe.model(Object.assign({}, proto.dummy, { pixel_values }));
  const embeds = out[IMAGE_OUTPUTS.image];
  if (!isEmbedTensor(embeds, raws.length, proto.width)) { proto.supported = false; return null; }
  const normalized = normalizedRows(embeds.data, raws.length, proto.width);
  return raws.map((_, row) => rankImage(normalized, row, proto));
}
async function imageResults(pipe, raws, proto) {
  if (proto && proto.supported) { const scores = await imageScores(pipe, raws, proto); if (scores) return scores; }
  return arrayResult(await pipe(raws, IMAGE_LABELS.slice()), raws.length);
}
async function ensurePipelines(categories, imageEnabled, token) {
  const need = { toxicity: categories.includes('abuse'), text: categories.some(x => !['images', 'abuse'].includes(x)), image: imageEnabled };
  if (!need.toxicity && !need.text && !need.image) return { pipes: Object.assign({}, pipelines, { device: 'rules' }), duration: 0 };
  const started = performance.now(), total = Object.values(need).filter(Boolean).length;
  progress(token, 'initialization', 0, total, 'Loading the on-device screening runtime…');
  const t = await transformers(token);
  const preferred = rememberedWasm || !(typeof navigator !== 'undefined' && navigator.gpu) ? 'wasm' : 'webgpu';
  const createMissing = async device => {
    if (pipelines.device && pipelines.device !== device) pipelines = { device: null, toxicity: null, text: null, image: null, textSupportsHandBatch: false, imageProto: null, RawImage: t.RawImage };
    pipelines.device = device; pipelines.RawImage = t.RawImage;
    let complete = 0;
    for (const key of ['toxicity', 'text', 'image']) if (need[key]) {
      check(token);
      if (!pipelines[key]) pipelines[key] = await t.pipeline(MODELS[key].task, MODELS[key].id, {
        revision: MODELS[key].revision, dtype: DTYPE, device,
        progress_callback: p => { check(token); if (p.status === 'progress') progress(token, 'initialization', complete, total, `Downloading models… ${Math.round(p.progress || 0)}%`, p); },
      });
      if (key === 'text' && typeof pipelines[key].entailment_id === 'number' && typeof pipelines[key].contradiction_id === 'number') {
        pipelines.textSupportsHandBatch = true;
      }
      if (key === 'image' && !pipelines.imageProto) pipelines.imageProto = await calibrateImagePrototypes(pipelines[key], pipelines.RawImage, token);
      complete++; progress(token, 'initialization', complete, total, 'Preparing screening models…');
    }
  };
  try { await createMissing(preferred); }
  catch (error) {
    if (preferred !== 'webgpu' || token.cancelled) throw error;
    rememberedWasm = true; pipelines = { device: null, toxicity: null, text: null, image: null, textSupportsHandBatch: false, imageProto: null, RawImage: t.RawImage };
    progress(token, 'initialization', 0, total, 'WebGPU unavailable for this model; retrying with WASM…');
    await createMissing('wasm');
  }
  return { pipes: pipelines, duration: elapsed(started) };
}
/* Image batches are prefetched, so more than one request can be outstanding and a response can
   arrive for a request nobody is awaiting yet. Key the pending resolvers by a monotonic id that the
   host echoes back, so a duplicate or late response can never resolve an already-settled promise
   over buffers the host has since detached. */
function askImages(names, token) {
  const requestId = ++token.imageRequestSequence;
  const promise = new Promise((resolve, reject) => {
    token.imageRequests.set(requestId, { resolve, reject });
    emit('image-batch-request', token.runId, { names, requestId });
  });
  /* A prefetched request can be rejected by a cancel before anything awaits it; keep a handler
     attached so that never surfaces as an unhandled rejection. Awaiting callers still see it. */
  promise.catch(() => {});
  return promise;
}
function settleImageRequest(token, requestId, buffers) {
  /* A response with no request id comes from a host that predates the id (kept working on
     purpose) and answers the oldest outstanding request; ids are monotonic so Map insertion
     order is request order. An id that is not outstanding is a duplicate or a late reply to an
     already-settled request, and is dropped. */
  const key = requestId == null ? token.imageRequests.keys().next().value : requestId;
  const pending = key === undefined ? undefined : token.imageRequests.get(key);
  if (!pending) return;
  token.imageRequests.delete(key);
  pending.resolve(buffers);
}
function rejectImageRequests(token, error) {
  const pending = [...token.imageRequests.values()];
  token.imageRequests.clear();
  for (const request of pending) request.reject(error);
}
function getCacheKey(model, text, label) {
  return `${model}:${text}:${label || ''}`;
}
// Shared by both read and write paths so an epoch change (model/policy/device) never leaves stale entries reachable from either side.
function syncCacheEpoch() {
  const epoch = getCacheEpoch();
  if (cacheEpoch !== epoch) { scoreCache.clear(); cacheCharTotal = 0; cacheEpoch = epoch; }
}
function evictOldestCacheEntry() {
  const oldestKey = scoreCache.keys().next().value;
  cacheCharTotal -= oldestKey.length;
  scoreCache.delete(oldestKey);
}
function getCachedScore(model, text, label) {
  if (!text) return undefined;
  syncCacheEpoch();
  const key = getCacheKey(model, text, label);
  return scoreCache.has(key) ? scoreCache.get(key) : undefined;
}
function setCachedScore(model, text, label, score) {
  if (!text) return;
  syncCacheEpoch();
  const key = getCacheKey(model, text, label);
  if (!scoreCache.has(key)) {
    // Keys embed full normalized message text; bound both entry count and total key bytes so the cache can't grow unbounded.
    while (scoreCache.size > 0 && (scoreCache.size >= MAX_CACHE_ENTRIES || cacheCharTotal + key.length > MAX_CACHE_CHARS)) evictOldestCacheEntry();
    cacheCharTotal += key.length;
  }
  scoreCache.set(key, score);
}
function getCacheEpoch() {
  return `${SafePolicy.VERSION}:${MODELS.toxicity.revision}:${MODELS.text.revision}:${DTYPE}:${pipelines.device || 'none'}`;
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
  // abuse is already covered end-to-end by the multilingual toxicity model below; skip it in MNLI (unless toxicity is unavailable) to avoid ~20% wasted forward passes and a duplicate finding.
  const labels = categories.filter(x => x !== 'images' && !(x === 'abuse' && pipes.toxicity)).map(x => SafePolicy.LABELS[x]);
  const englishOnly = categories.filter(x => x !== 'images' && x !== 'abuse');
  const scannableGroups = groups.filter(group => group.scannable);
  const needsEnglish = !!(pipes.text && labels.length); // .english is lazy; read only if MNLI will use it
  const englishGroups = needsEnglish ? scannableGroups.filter(group => group.english) : [];
  // One running total across the toxicity and MNLI passes so the progress bar stays monotonic instead of resetting at the halfway point.
  const toxicityCount = pipes.toxicity ? scannableGroups.length : 0;
  const textTotal = toxicityCount + (needsEnglish ? englishGroups.length : 0);
  if (pipes.toxicity) {
    const cached = scannableGroups.map(group => getCachedScore('toxicity', group.key, ''));
    const pending = cached.flatMap((score, index) => score === undefined ? [index] : []), hits = scannableGroups.length - pending.length;
    if (pending.length) {
      const toxBucket = SafeScheduler.bucketed(pending, index => scannableGroups[index].text.length);
      const fresh = toxBucket.restore(await SafeScheduler.batched(toxBucket.items, batchSize, async batch => {
        check(token); return arrayResult(await pipes.toxicity(batch.map(index => scannableGroups[index].text), { top_k: null }), batch.length);
      }, done => textProgress(token, hits + done, textTotal), isCancellation));
      pending.forEach((index, slot) => { cached[index] = fresh[slot]; setCachedScore('toxicity', scannableGroups[index].key, '', fresh[slot]); });
    }
    findings.push(...SafeScheduler.fanOut(scannableGroups, cached, result => (result || []).flatMap(item => {
      const category = categoryForLabel(item.label);
      return category === 'abuse' && item.score >= SafePolicy.THRESHOLDS.text ? [{ category, reason: `Multilingual toxicity model: ${item.label}`, score: item.score, source: 'model', _phase: 1 }] : [];
    })));
  }
  if (pipes.text && labels.length) {
    let results;
    const cached = englishGroups.map(group => labels.map(label => getCachedScore('text', group.key, label)));
    if (pipes.textSupportsHandBatch) {
      const pairs = [];
      for (let g = 0; g < englishGroups.length; g++) for (let l = 0; l < labels.length; l++) {
        if (cached[g][l] === undefined) pairs.push({ premise: englishGroups[g].text, hypothesis: HYPOTHESIS(labels[l]), group: g, label: l });
      }
      if (pairs.length) {
        const hitPairs = englishGroups.length * labels.length - pairs.length;
        const pairBucket = SafeScheduler.bucketed(pairs, pair => pair.premise.length);
        const scores = pairBucket.restore(await SafeScheduler.batched(pairBucket.items, batchSize, async batch => {
          check(token); return mnliScores(pipes.text, batch, 128);
        }, done => textProgress(token, toxicityCount + Math.floor((hitPairs + done) / labels.length), textTotal), isCancellation));
        pairs.forEach((pair, slot) => { cached[pair.group][pair.label] = scores[slot]; setCachedScore('text', englishGroups[pair.group].key, labels[pair.label], scores[slot]); });
      }
      results = cached.map(scores => ({ labels: labels.slice(), scores }));
    } else {
      const pending = [];
      results = cached.map((scores, index) => {
        if (scores.some(score => score === undefined)) { pending.push(index); return null; }
        const order = labels.map((_, l) => l).sort((a, b) => (scores[b] - scores[a]) || (a - b));
        return { labels: order.map(l => labels[l]), scores: order.map(l => scores[l]) };
      });
      const hits = englishGroups.length - pending.length;
      if (pending.length) {
        const fresh = await SafeScheduler.batched(pending, batchSize, async batch => {
          check(token); return objectResult(await pipes.text(batch.map(index => englishGroups[index].text), labels, { multi_label: true }), batch.length);
        }, done => textProgress(token, toxicityCount + hits + done, textTotal), isCancellation);
        pending.forEach((index, slot) => {
          results[index] = fresh[slot];
          (fresh[slot].labels || []).forEach((label, l) => setCachedScore('text', englishGroups[index].key, label, fresh[slot].scores[l]));
        });
      }
    }
    findings.push(...SafeScheduler.fanOut(englishGroups, results, result => (result.labels || []).flatMap((label, index) => {
      const category = categoryForLabel(label);
      return category && result.scores[index] >= SafePolicy.THRESHOLDS.text ? [{ category, reason: `Text model: ${label}`, score: result.scores[index], source: 'model', _phase: 2 }] : [];
    })));
  }
  timings.text = elapsed(textStarted); check(token);

  const unanalysed = [], imageStarted = performance.now(), imageNames = data.scanImages && pipes.image ? [...attachmentOwners.keys()] : [];
  const imageBatchSize = pipes.device === 'webgpu' ? 8 : 4;
  check(token);
  let inflight = imageNames.length ? askImages(imageNames.slice(0, imageBatchSize), token) : null;
  try {
    for (let offset = 0; offset < imageNames.length;) {
      check(token);
      const names = imageNames.slice(offset, offset + imageBatchSize);
      const buffers = await inflight; inflight = null; check(token);
      /* Ask for the next batch before decoding and running inference on this one, so the host's
         ZIP inflate overlaps the model pass instead of following it. Depth one: at most one
         request is outstanding, and the cancel path rejects it like any other. */
      const next = imageNames.slice(offset + names.length, offset + names.length + imageBatchSize);
      if (next.length) inflight = askImages(next, token);
      // Decode the batch concurrently instead of one-by-one; order is restored below and failures still fall through to unanalysed.
      const decodedSlots = await Promise.all(names.map(async (name, index) => {
        if (!buffers[index]) return null;
        try { return { name, raw: await pipes.RawImage.fromBlob(new Blob([buffers[index]])) }; }
        catch (error) { return null; }
      }));
      const decoded = [];
      decodedSlots.forEach((slot, index) => { if (slot) decoded.push(slot); else unanalysed.push(names[index]); });
      if (decoded.length) {
        const results = await SafeScheduler.batched(decoded, imageBatchSize, async batch => {
          check(token);
          try { return await imageResults(pipes.image, batch.map(x => x.raw), pipes.imageProto); }
          catch (error) { if (batch.length > 1 || isCancellation(error)) throw error; unanalysed.push(batch[0].name); return [null]; }
        }, null, isCancellation);
        decoded.forEach((item, index) => {
          for (const result of results[index] || []) if (result.label !== 'safe image' && result.score >= SafePolicy.THRESHOLDS.image) {
            for (const owner of attachmentOwners.get(item.name) || []) findings.push({ messageId: owner.id, category: 'images', reason: `Image model: ${result.label}`, score: result.score, source: 'model', attachment: item.name, _messageIndex: owner.index, _phase: 3 });
          }
        });
      }
      offset += names.length; progress(token, 'image', offset, imageNames.length, `Screening images ${offset} of ${imageNames.length}…`);
    }
  } finally { inflight = null; rejectImageRequests(token, cancellation()); }
  timings.image = elapsed(imageStarted); timings.total = elapsed(totalStarted); check(token);
  const partialCoverage = englishOnly.length ? scannableGroups.some(group => !group.english) : false;
  /* `imageFastPath` is a diagnostic: false means the cached-prototype guard rejected this model and
     the run used the plain pipeline call, which is correct but slower. */
  emit('complete', token.runId, { findings: SafePolicy.mergeFindings(SafeScheduler.ordered(findings)), unanalysed, partialCoverage, device: pipes.device, imageFastPath: !!(pipes.imageProto && pipes.imageProto.supported), policyVersion: SafePolicy.VERSION, timings });
}

// Starts a run directly (not via postMessage/self.postMessage) so a queued pendingRun actually dispatches: postMessage from
// inside a worker goes to the host, which ignores type:'analyse' and would otherwise hang the UI in "scanning" forever.
function startRun(data) {
  const token = { runId: data.runId, cancelled: false, imageRequests: new Map(), imageRequestSequence: 0 }; activeRun = token;
  analyse(data, token).catch(error => { if (!token.cancelled) emit('error', token.runId, { message: error.message || String(error), fatal: true }); }).finally(() => {
    if (token.cancelled) emit('cancelled', token.runId, {});
    if (activeRun === token) activeRun = null;
    if (pendingRun) { const next = pendingRun; pendingRun = null; startRun(next); }
  });
}
onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    if (activeRun && (!data.runId || data.runId === activeRun.runId)) { activeRun.cancelled = true; rejectImageRequests(activeRun, cancellation()); }
    if (pendingRun && data.runId === pendingRun.runId) pendingRun = null;
    return;
  }
  if (data.type === 'image-batch-response') {
    if (activeRun && data.runId === activeRun.runId) settleImageRequest(activeRun, data.requestId, data.buffers || []);
    return;
  }
  if (data.type !== 'analyse') return;
  if (!activeRun) startRun(data);
  else { activeRun.cancelled = true; pendingRun = data; rejectImageRequests(activeRun, cancellation()); }
};
emit('ready', null, { policyVersion: SafePolicy.VERSION, models: MODELS });
