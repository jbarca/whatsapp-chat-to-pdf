/* Cancellable, entirely local Safe Mode inference worker. */
'use strict';
importScripts('safe-policy.js');

const MODELS = Object.freeze({
  toxicity: { id: 'onnx-community/distilbert-multilingual-toxicity-classifier-ONNX', revision: '4fbaccee8caaba02641b1757f7ef697e3fbffdb8' },
  text: { id: 'Xenova/mobilebert-uncased-mnli', revision: '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee' },
  image: { id: 'Xenova/clip-vit-base-patch32', revision: 'd15189d7028b43f1d3e65039190477f6af591c2a' },
});
let run = null;
const nativeFetch = self.fetch.bind(self);
const allowedModelPrefixes = Object.values(MODELS).map(model => `https://huggingface.co/${model.id}/resolve/${model.revision}/`);
self.fetch = function guardedFetch(input, init) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  if (url.origin !== location.origin) {
    const method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
    const body = init && init.body;
    if (method !== 'GET' || body != null || !allowedModelPrefixes.some(prefix => url.href.startsWith(prefix))) {
      return Promise.reject(new Error('Safe mode blocked an unexpected network request.'));
    }
  }
  return nativeFetch(input, init);
};

function emit(type, data) { postMessage(Object.assign({ type }, data)); }
function progress(message, detail) { emit('progress', { message, detail: detail || null }); }
function isEnglish(text) {
  const normalized = ` ${SafePolicy.normalize(text)} `;
  if (/\b(hola|gracias|por favor|bonjour|merci|salut|avec|und|danke|bitte|hallo|ciao|grazie|buongiorno|ola|obrigado|voce|namaste|terima kasih)\b/.test(normalized)) return false;
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  const latin = letters.filter(c => /[A-Za-z]/.test(c)).length;
  return latin / letters.length > 0.85;
}
function add(findings, messageId, item) { const finding = Object.assign({ messageId }, item); findings.push(finding); emit('finding', { finding }); }
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
async function loadPipelines(categories, imageEnabled, token) {
  if (!categories.some(x => x !== 'images') && !imageEnabled) return { toxicity: null, text: null, image: null, RawImage: null, device: 'rules' };
  progress('Loading the on-device screening runtime…');
  const t = await import('./vendor/transformers-3.8.1.min.js');
  t.env.allowLocalModels = false;
  t.env.useBrowserCache = true;
  t.env.backends.onnx.wasm.numThreads = 1;
  const preferredDevice = typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm';
  const common = (model, device) => ({ revision: model.revision, dtype: 'q8', device, progress_callback: p => {
    if (token.cancelled) throw new Error('Cancelled');
    if (p.status === 'progress') progress(`Downloading models… ${Math.round(p.progress || 0)}%`, p);
  }});
  const create = async device => {
    const toxicity = categories.includes('abuse') ? await t.pipeline('text-classification', MODELS.toxicity.id, common(MODELS.toxicity, device)) : null;
    let text = null, image = null;
    if (categories.some(x => !['images', 'abuse'].includes(x))) text = await t.pipeline('zero-shot-classification', MODELS.text.id, common(MODELS.text, device));
    if (imageEnabled) image = await t.pipeline('zero-shot-image-classification', MODELS.image.id, common(MODELS.image, device));
    return { toxicity, text, image, RawImage: t.RawImage, device };
  };
  try { return await create(preferredDevice); }
  catch (error) {
    if (preferredDevice !== 'webgpu' || token.cancelled) throw error;
    progress('WebGPU unavailable for this model; retrying with single-threaded WASM…');
    return create('wasm');
  }
}
async function askImage(name, token) {
  return new Promise((resolve, reject) => {
    token.imageResolve = resolve; token.imageReject = reject;
    emit('image-request', { name });
  });
}
async function analyse(data, token) {
  const categories = data.categories || [], terms = SafePolicy.customTerms(data.customTerms);
  const findings = [], messages = data.messages || [];
  for (const m of messages) if (!m.deleted && m.text) for (const f of SafePolicy.ruleFindings(m.text, categories, terms)) add(findings, m.id, f);
  const pipes = await loadPipelines(categories, !!data.scanImages, token);
  let partialCoverage = false;
  const labels = categories.filter(x => x !== 'images').map(x => SafePolicy.LABELS[x]);
  for (let i = 0; i < messages.length; i++) {
    if (token.cancelled) throw new Error('Cancelled');
    const m = messages[i]; if (!m.text || m.deleted) continue;
    if (pipes.toxicity) {
      const toxic = await pipes.toxicity(m.text, { top_k: null });
      for (const result of toxic.flat()) {
        const category = categoryForLabel(result.label);
        if (category === 'abuse' && result.score >= SafePolicy.THRESHOLDS.text) add(findings, m.id, { category, reason: `Multilingual toxicity model: ${result.label}`, score: result.score, source: 'model' });
      }
    }
    if (isEnglish(m.text) && pipes.text && labels.length) {
      const result = await pipes.text(m.text, labels, { multi_label: true });
      result.labels.forEach((label, j) => {
        if (result.scores[j] >= SafePolicy.THRESHOLDS.text) {
          const category = categoryForLabel(label);
          if (category) add(findings, m.id, { category, reason: `Text model: ${label}`, score: result.scores[j], source: 'model' });
        }
      });
    } else if (!isEnglish(m.text)) partialCoverage = true;
    if (i % 5 === 0) progress(`Screening text ${i + 1} of ${messages.length}…`);
  }
  const unanalysed = [], seen = new Set();
  if (data.scanImages && pipes.image) for (const m of messages) for (const name of m.attachments || []) {
    if (seen.has(name)) continue; seen.add(name);
    if (token.cancelled) throw new Error('Cancelled');
    try {
      const buffer = await askImage(name, token);
      if (!buffer) throw new Error('unavailable');
      const raw = await pipes.RawImage.fromBlob(new Blob([buffer]));
      const result = await pipes.image(raw, ['safe image', 'nudity or sexual content', 'graphic violence', 'drugs or weapons']);
      for (const item of result) if (item.label !== 'safe image' && item.score >= SafePolicy.THRESHOLDS.image) {
        for (const owner of messages.filter(x => (x.attachments || []).includes(name))) add(findings, owner.id, { category: 'images', reason: `Image model: ${item.label}`, score: item.score, source: 'model', attachment: name });
      }
    } catch (error) { if (!token.cancelled) unanalysed.push(name); }
    progress(`Screening images ${seen.size}…`);
  }
  emit('complete', { findings: SafePolicy.mergeFindings(findings), unanalysed, partialCoverage, device: pipes.device, policyVersion: SafePolicy.VERSION });
}
onmessage = ({ data }) => {
  if (data.type === 'cancel') { if (run) { run.cancelled = true; if (run.imageReject) run.imageReject(new Error('Cancelled')); } return; }
  if (data.type === 'image-response') { if (run && run.imageResolve) { const fn = run.imageResolve; run.imageResolve = run.imageReject = null; fn(data.buffer || null); } return; }
  if (data.type !== 'analyse' || run) return;
  const token = { cancelled: false }; run = token;
  analyse(data, token).catch(error => { if (!token.cancelled) emit('error', { message: error.message || String(error) }); }).finally(() => { run = null; });
};
emit('ready', { policyVersion: SafePolicy.VERSION, models: MODELS });
