/* Safe Mode model benchmark — seeded corpora, a recall record, and device/threading attribution.
   SAFE_MODEL_BENCH=1 gates the run. SAFE_BENCH_CORPUS_ONLY=1 prints corpus stats and exits without Chrome.
   SAFE_BENCH_ONLY=small,dupe1000 restricts the run. SAFE_BENCH_DEVICE=wasm|webgpu pins the backend.
   SAFE_BENCH_COI=1 serves COOP/COEP. SAFE_BENCH_SEED=n reseeds the generators.
   SAFE_BENCH_BASELINE_JSON=path asserts every seeded finding in that baseline is still flagged;
   SAFE_BENCH_WRITE_BASELINE=1 records the run there instead of asserting. Speed targets are opt-in and
   skip corpora absent from either side: SAFE_BENCH_SPEED_TARGETS='mixed1000.text=.40,dupe1000.text=.60,image=.25'.
   Only the small canary is always asserted, on timings.text (wall is dominated by the cold model
   download); SAFE_BENCH_SMALL_TOLERANCE=1.10 sets its bound. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

if (process.env.SAFE_MODEL_BENCH !== '1') {
  console.log('safe model benchmark skipped (set SAFE_MODEL_BENCH=1)');
  process.exit(0);
}

const require = createRequire(import.meta.url), SafePolicy = require('../safe-policy.js');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const CATEGORIES = ['abuse', 'sexual', 'violence', 'drugs', 'crime'];
const SEED = Number(process.env.SAFE_BENCH_SEED || 1337);
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (random, list) => list[Math.floor(random() * list.length)];
const gauss = random => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const zipf = (random, list) => {
  const weights = list.map((_, index) => 1 / (index + 1)), total = weights.reduce((a, b) => a + b, 0);
  let remaining = random() * total;
  for (let index = 0; index < list.length; index++) { remaining -= weights[index]; if (remaining <= 0) return list[index]; }
  return list[list.length - 1];
};

const WORDS = 'the a and but we they she he it about today tomorrow yesterday morning evening dinner coffee train ticket office landlord invoice photo album holiday beach cousin wedding rehearsal grocery recipe laundry mortgage dentist appointment reschedule weather forecast parcel delivery driver parking receipt refund warranty install update password meeting agenda deadline spreadsheet printer battery charger keys umbrella garden neighbour builder quote kitchen window curtain bookshelf plumber invoice'.split(' ');
const sentence = (random, words) => {
  const parts = Array.from({ length: words }, () => pick(random, WORDS));
  parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
  return `${parts.join(' ')}.`;
};
const prose = (random, words) => {
  const out = [];
  for (let left = words; left > 0;) { const take = Math.min(left, 6 + Math.floor(random() * 13)); out.push(sentence(random, take)); left -= take; }
  return out.join(' ');
};
const PHRASES = ['ok', 'okay thanks', 'see you soon', 'on my way', 'sounds good to me', 'haha', 'yes please', 'no worries', 'call me when you land', 'running ten minutes late', 'did you send it yet', 'thank you so much', 'good morning', 'good night', 'lol', 'what time', 'i will check and get back to you', 'perfect', 'same here', 'let me know', 'sorry just seeing this', 'all good', 'see you there', 'cheers', 'that works', 'not sure yet', 'i am at the station', 'can you resend that', 'done', 'any update'];
const FILLER = ['<Media omitted>', '<Media omitted>', '<Media omitted>', '<Image omitted>', '<Video omitted>', '<Sticker omitted>', 'This message was deleted', '👍', '😂😂😂', '🎉🥳', '❤️', '0412345678', '42', '2026', '...', '?'];
const NON_ENGLISH = Object.freeze({
  es: ['Hola, gracias por la cena de anoche', 'Por favor avisame cuando llegues a casa', 'Hola, paso por la oficina a las nueve', 'Gracias por el regalo, nos encanto'],
  fr: ['Bonjour, merci pour le cafe de ce matin', 'Salut, on se retrouve avec les autres devant la gare', 'Merci beaucoup, a demain soir', 'Bonjour, je passe avec les documents cet apres-midi'],
  de: ['Hallo, danke für die Nachricht von gestern', 'Bitte ruf mich morgen früh an', 'Und dann waren wir den ganzen Nachmittag im Garten', 'Danke, bis Sonntag dann'],
  it: ['Ciao, grazie mille per la cena di ieri sera', 'Buongiorno, ci vediamo alle otto davanti al bar', 'Grazie, ti scrivo appena arrivo', 'Ciao, domani porto io il dolce'],
  pt: ['Ola, obrigado pela ajuda de ontem', 'Voce chega a que horas no sabado', 'Obrigado, ate amanha', 'Ola, voce ja falou com o senhorio'],
  id: ['Terima kasih banyak atas bantuannya kemarin', 'Terima kasih, sampai jumpa besok pagi', 'Terima kasih sudah menunggu saya di kantor', 'Terima kasih, saya sudah sampai di rumah'],
  hi: ['नमस्ते, कल शाम को मिलते हैं', 'आज बहुत बारिश हो रही है', 'मैं स्टेशन पहुँच गया हूँ', 'खाना तैयार है, जल्दी आओ'],
  ar: ['مرحبا كيف حالك اليوم', 'نراك غدا في المقهى بعد الظهر', 'وصلت إلى المحطة الآن', 'شكرا جزيلا على المساعدة'],
  ja: ['今日はありがとう、また明日ね', '駅に着いたら連絡するね', '明日の夜は空いていますか', '写真を送ってくれてありがとう'],
  zh: ['明天我们在车站见面好吗', '谢谢你昨天的帮助', '我已经到家了,晚点再聊', '周末一起吃饭吧'],
  ru: ['Привет, увидимся завтра вечером', 'Спасибо за помощь вчера', 'Я уже на вокзале, скоро буду', 'Давай созвонимся после обеда'],
  ko: ['오늘 정말 고마웠어 내일 봐', '역에 도착하면 연락할게', '주말에 같이 밥 먹자', '사진 보내줘서 고마워'],
  th: ['สวัสดีครับ พรุ่งนี้เจอกันนะ', 'ขอบคุณมากสำหรับความช่วยเหลือ', 'ถึงสถานีแล้วครับ', 'เย็นนี้ว่างไหม'],
  el: ['Καλημέρα, τα λέμε το απόγευμα', 'Ευχαριστώ πολύ για τη βοήθεια', 'Έφτασα στον σταθμό', 'Θα σε πάρω τηλέφωνο αύριο'],
});
const LANGUAGES = Object.keys(NON_ENGLISH);

const RULE_RISKY = [
  'I swear I will kill you if you show up at my door again',
  'He was moving cocaine through the docks every winter and bragging about it',
  'They ran the payments through a shell company for money laundering after the sale',
  'She threatened to stab him in the car park over the money',
  'He kept demanding nudes and would not leave her alone about it',
];
const MODEL_RISKY = [
  'You are a disgusting pathetic waste of oxygen and everyone in this group thinks so',
  'Shut your filthy mouth you absolute moron before I lose my temper with you',
  'If you ever speak to my sister again I will make sure you regret being born',
  'We swapped the serial numbers on the parts before shipping so nobody can trace them back to us',
  'I have not eaten in four days and honestly I do not want to wake up tomorrow',
  'Bring the little baggies of white powder to the car park at midnight and do not text first',
  'Send me a picture with nothing on it will stay between us I promise',
];
const RISKY = [...RULE_RISKY.map((text, index) => ({ id: 900001 + index, text })), ...MODEL_RISKY.map((text, index) => ({ id: 950001 + index, text }))];
const RISKY_IDS = { rule: RULE_RISKY.map((_, index) => 900001 + index), model: MODEL_RISKY.map((_, index) => 950001 + index) };
const NO_RISKY = { rule: [], model: [] };
const riskyText = new Map(RISKY.map(message => [String(message.id), message.text]));
RULE_RISKY.forEach(text => assert.ok(SafePolicy.ruleFindings(text, CATEGORIES, []).length, `seeded rule-risky message matches no rule phrase: ${text}`));
MODEL_RISKY.forEach(text => assert.equal(SafePolicy.ruleFindings(text, CATEGORIES, []).length, 0, `seeded model-only risky message matches a rule phrase: ${text}`));
const seedRisky = (messages, random) => {
  const out = messages.slice();
  for (const message of RISKY) out.splice(Math.floor(random() * (out.length + 1)), 0, message);
  return out;
};

const ENGLISH_MARKERS = /\b(hola|gracias|por favor|bonjour|merci|salut|avec|und|danke|bitte|hallo|ciao|grazie|buongiorno|ola|obrigado|voce|namaste|terima kasih)\b/;
const isEnglish = text => {
  if (ENGLISH_MARKERS.test(` ${SafePolicy.normalize(text)} `)) return false;
  const letters = String(text || '').match(/\p{L}/gu) || [];
  return !letters.length || letters.filter(c => /[A-Za-z]/.test(c)).length / letters.length > 0.85;
};
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const spread = values => ({ min: Math.min(...values), median: median(values), max: Math.max(...values) });
const statsOf = corpus => {
  const texts = corpus.messages.map(message => message.text), keys = texts.map(text => SafePolicy.normalize(text));
  return {
    count: corpus.messages.length, bytes: texts.reduce((total, text) => total + Buffer.byteLength(text), 0),
    chars: spread(texts.map(text => text.length)), words: spread(texts.map(text => text.trim().split(/\s+/).length)),
    distinctNormalized: new Set(keys).size, scannable: keys.filter(key => SafePolicy.isScannable(key)).length,
    nonEnglish: texts.filter(text => !isEnglish(text)).length,
    attachments: corpus.messages.reduce((total, message) => total + (message.attachments || []).length, 0),
    scanImages: !!corpus.scanImages, risky: corpus.risky,
  };
};

const smallRandom = rng(SEED), mixedRandom = rng(SEED + 1), dupeRandom = rng(SEED + 2), foreignRandom = rng(SEED + 3), longRandom = rng(SEED + 4), imageRandom = rng(SEED + 5);
const longText = random => {
  const target = 2000 + Math.floor(random() * 2800);
  let text = '';
  while (Buffer.byteLength(text) < target) text += `${text ? ' ' : ''}${sentence(random, 6 + Math.floor(random() * 13))}`;
  return text;
};
const foreignText = random => {
  const language = NON_ENGLISH[pick(random, LANGUAGES)];
  return `${pick(random, language)}${random() < 0.5 ? ` ${pick(random, language)}` : ''}`;
};
const CORPORA = [
  { name: 'small', risky: RISKY_IDS, messages: seedRisky(Array.from({ length: 8 }, (_, index) => ({ id: index + 1, text: prose(smallRandom, 5 + Math.floor(smallRandom() * 8)) })), smallRandom) },
  { name: 'mixed1000', risky: RISKY_IDS, messages: seedRisky(Array.from({ length: 1000 - RISKY.length }, (_, index) => ({ id: index + 1, text: prose(mixedRandom, Math.max(1, Math.min(500, Math.round(Math.exp(2.5 + 1.45 * gauss(mixedRandom)))))) })), mixedRandom) },
  { name: 'dupe1000', risky: RISKY_IDS, messages: seedRisky(Array.from({ length: 1000 - RISKY.length }, (_, index) => ({ id: index + 1, text: dupeRandom() < 0.7 ? zipf(dupeRandom, PHRASES) : pick(dupeRandom, FILLER) })), dupeRandom) },
  { name: 'nonenglish1000', risky: NO_RISKY, messages: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, text: `${foreignText(foreignRandom)} ${index + 1}` })) },
  { name: 'long200', risky: NO_RISKY, messages: Array.from({ length: 200 }, (_, index) => ({ id: index + 1, text: longText(longRandom) })) },
  { name: 'image', risky: NO_RISKY, scanImages: true, messages: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, text: prose(imageRandom, 4 + Math.floor(imageRandom() * 6)), attachments: [`unavailable-${index}.jpg`] })) },
];
const only = (process.env.SAFE_BENCH_ONLY || '').split(',').map(name => name.trim()).filter(Boolean);
const selected = only.length ? CORPORA.filter(corpus => only.includes(corpus.name)) : CORPORA;
assert.ok(selected.length, `SAFE_BENCH_ONLY matched no corpora (have ${CORPORA.map(corpus => corpus.name).join(', ')})`);
const stats = Object.fromEntries(selected.map(corpus => [corpus.name, statsOf(corpus)]));

if (process.env.SAFE_BENCH_CORPUS_ONLY === '1') {
  console.log(JSON.stringify({ seed: SEED, corpora: stats }, null, 2));
  process.exit(0);
}

const { chromium } = require('playwright');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
const coi = process.env.SAFE_BENCH_COI === '1', packed = new Map(), servedWasm = {};
const server = createServer(async (req, res) => {
  try {
    const path = await realpath(join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')));
    if (!path.startsWith(root + '/')) throw new Error('blocked');
    if (coi) { res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); }
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    const body = await readFile(path);
    if (extname(path) !== '.wasm' || !/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return res.end(body);
    if (!packed.has(path)) packed.set(path, gzipSync(body));
    servedWasm[basename(path)] = { raw: body.length, gzip: packed.get(path).length };
    res.setHeader('Content-Encoding', 'gzip'); res.end(packed.get(path));
  } catch (error) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  if (process.env.SAFE_BENCH_DEVICE === 'wasm') {
    await page.route('**/safe-worker.js', async route => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: `Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });\n${body}` });
    });
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const measured = await page.evaluate(async corpora => {
    const worker = new Worker('safe-worker.js');
    const ready = await new Promise((resolve, reject) => { worker.onmessage = event => event.data.type === 'ready' && resolve(event.data); worker.onerror = reject; });
    const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0)).buffer;
    let runId = 0;
    const run = corpus => new Promise((resolve, reject) => {
      const id = ++runId, started = performance.now();
      worker.onmessage = event => {
        const data = event.data;
        if (data.type === 'image-batch-request' && data.runId === id) worker.postMessage({ type: 'image-batch-response', runId: id, requestId: data.requestId, buffers: data.names.map(() => pixel.slice(0)) });
        else if (data.type === 'complete' && data.runId === id) {
          const wanted = new Set([...corpus.risky.rule, ...corpus.risky.model]), hits = new Map();
          for (const finding of data.findings) if (wanted.has(finding.messageId)) {
            if (!hits.has(finding.messageId)) hits.set(finding.messageId, new Set());
            hits.get(finding.messageId).add(`${finding.category}:${finding.source}`);
          }
          const record = group => {
            const flagged = corpus.risky[group].filter(messageId => hits.has(messageId));
            return { total: corpus.risky[group].length, flagged: flagged.length, rate: corpus.risky[group].length ? Math.round(flagged.length / corpus.risky[group].length * 100) / 100 : null, ids: Object.fromEntries(flagged.map(messageId => [messageId, [...hits.get(messageId)].sort()])) };
          };
          resolve({ wall: Math.round(performance.now() - started), timings: data.timings, device: data.device, imageFastPath: data.imageFastPath === undefined ? null : data.imageFastPath, findings: data.findings.length, unanalysed: data.unanalysed.length, partialCoverage: data.partialCoverage, recall: { rule: record('rule'), model: record('model') } });
        } else if (data.type === 'error' && data.runId === id) reject(new Error(data.message));
      };
      worker.postMessage({ type: 'analyse', runId: id, messages: corpus.messages, categories: ['abuse', 'sexual', 'violence', 'drugs', 'crime', ...(corpus.scanImages ? ['images'] : [])], customTerms: '', scanImages: !!corpus.scanImages });
    });
    const results = {};
    for (const corpus of corpora) results[corpus.name] = await run(corpus);
    const crossOriginIsolated = self.crossOriginIsolated, hardwareConcurrency = navigator.hardwareConcurrency || 2;
    const numThreads = crossOriginIsolated ? Math.max(1, Math.min(4, hardwareConcurrency - 1)) : 1;
    worker.terminate(); return { corpora: results, crossOriginIsolated, hardwareConcurrency, numThreads, policyVersion: ready.policyVersion };
  }, selected.map(corpus => ({ name: corpus.name, risky: corpus.risky, scanImages: !!corpus.scanImages, messages: corpus.messages })));
  const result = {
    config: { seed: SEED, requestedDevice: process.env.SAFE_BENCH_DEVICE || null, coi, only: only.length ? only : null, node: process.version, policyVersion: measured.policyVersion, wasm: servedWasm },
    crossOriginIsolated: measured.crossOriginIsolated, hardwareConcurrency: measured.hardwareConcurrency, numThreads: measured.numThreads,
    corpora: measured.corpora, stats,
  };
  console.log(JSON.stringify(result, null, 2));
  for (const [name, sizes] of Object.entries(servedWasm)) console.log(`note: ${name} served gzipped (${sizes.raw} → ${sizes.gzip} bytes), matching GitHub Pages; timings.initialization is a cold download plus compile.`);
  for (const [name, corpus] of Object.entries(result.corpora)) console.log(`${name}: wall ${corpus.wall} ms, init ${corpus.timings.initialization} ms, text ${corpus.timings.text} ms, image ${corpus.timings.image} ms, device ${corpus.device}, image fast path ${corpus.imageFastPath}, findings ${corpus.findings}, unanalysed ${corpus.unanalysed}, recall rule ${corpus.recall.rule.flagged}/${corpus.recall.rule.total} model ${corpus.recall.model.flagged}/${corpus.recall.model.total}`);
  const baselinePath = process.env.SAFE_BENCH_BASELINE_JSON;
  if (baselinePath && process.env.SAFE_BENCH_WRITE_BASELINE === '1') {
    await writeFile(baselinePath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`baseline recorded to ${baselinePath}; no assertions ran (unset SAFE_BENCH_WRITE_BASELINE to assert against it)`);
  } else if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')), lost = [];
    for (const [name, before] of Object.entries(baseline.corpora || {})) {
      const now = result.corpora[name];
      if (!now || !before.recall) continue;
      for (const group of ['rule', 'model']) for (const [messageId, sources] of Object.entries(before.recall[group].ids || {})) {
        if (!now.recall[group].ids[messageId]) lost.push(`  ${name}/${group} #${messageId} (was ${sources.join(', ')}): ${riskyText.get(messageId) || 'unknown message'}`);
      }
    }
    assert.ok(!lost.length, `recall regression — ${lost.length} seeded finding(s) lost since the baseline:\n${lost.join('\n')}`);
    const metric = (corpus, field) => field === 'wall' ? corpus.wall : corpus.timings[field];
    for (const [name, now] of Object.entries(result.corpora)) {
      const before = (baseline.corpora || {})[name];
      if (before) console.log(`vs baseline ${name}: wall ${before.wall} → ${now.wall} ms, text ${before.timings.text} → ${now.timings.text} ms, init ${before.timings.initialization} → ${now.timings.initialization} ms`);
    }
    for (const spec of (process.env.SAFE_BENCH_SPEED_TARGETS || '').split(',').map(entry => entry.trim()).filter(Boolean)) {
      const [key, fraction] = spec.split('='), [name, field = 'wall'] = key.split('.'), now = result.corpora[name], before = (baseline.corpora || {})[name];
      if (!now || !before) { console.log(`speed target ${spec} skipped (${name} absent from ${now ? 'the baseline' : 'this run'})`); continue; }
      assert.ok(metric(now, field) <= metric(before, field) * (1 - Number(fraction)), `${name}.${field} missed the ${Math.round(Number(fraction) * 100)}% speed target: ${metric(before, field)} → ${metric(now, field)} ms`);
    }
    const tolerance = Number(process.env.SAFE_BENCH_SMALL_TOLERANCE || 1.10);
    if (result.corpora.small && (baseline.corpora || {}).small) assert.ok(result.corpora.small.timings.text <= baseline.corpora.small.timings.text * tolerance, `small scan regressed by more than ${Math.round((tolerance - 1) * 100)}%: text ${baseline.corpora.small.timings.text} → ${result.corpora.small.timings.text} ms`);
  }
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
