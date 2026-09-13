/* WhatsApp Chat to PDF — app logic. No server. */
(function () {
  'use strict';

  // ===== CONFIG — fill these in after creating the Gumroad product (see MANUAL_STEPS.md) =====
  const CONFIG = {
    GUMROAD_PRODUCT_ID: 'neMRa145rAn847uAh5LgBw==',                 // Gumroad → product → Advanced → "Product ID" (needed for license verification)
    GUMROAD_PRODUCT_URL: 'https://jbarca.gumroad.com/l/whatsapp-to-pdf',                // e.g. https://jbarca.gumroad.com/l/whatsapp-pdf
    PRICE_LABEL: '$4.99 one-time payment',                        // e.g. "$4.99 one-time"
    FREE_LIMIT: 100,
    LICENSE_STORAGE_KEY: 'wa2pdf.license',
  };
  // ==========================================================================================

  const $ = (id) => document.getElementById(id);
  const els = {
    drop: $('drop'), file: $('file'), app: $('app'), hero: $('hero'), doc: $('doc'), notice: $('free-notice'),
    title: $('opt-title'), me: $('opt-me'), from: $('opt-from'), to: $('opt-to'), search: $('opt-search'),
    order: $('opt-order'), paper: $('opt-paper'), size: $('opt-size'), style: $('opt-style'),
    media: $('opt-media'), evidence: $('opt-evidence'), safe: $('opt-safe'), safeOptions: $('safe-options'), safeTerms: $('safe-terms'), safeAnalyse: $('safe-analyse'), safeCancel: $('safe-cancel'), safeStatus: $('safe-status'),
    safeReview: $('safe-review'), safeReviewList: $('safe-review-list'), safeSelectAll: $('safe-select-all'), safeClearAll: $('safe-clear-all'), safeApply: $('safe-apply'), safeAck: $('safe-ack'), safeUnanalysedWrap: $('safe-unanalysed-wrap'), proState: $('pro-state'), proCta: $('pro-cta'),
    buy: $('buy'), buy2: $('buy2'), price: $('price'), licenseForm: $('license-form'), licenseKey: $('license-key'), licenseMsg: $('license-msg'),
    export: $('export'), print: $('print-chat'), download: $('download-pdf'), cancelExport: $('cancel-export'), exportStatus: $('export-status'), reset: $('reset'), chatTitle: $('chat-title'), stats: $('stats'), warnings: $('warnings'),
    loadMoreControls: $('load-more-controls'), loadMore: $('load-more'), loadAll: $('load-all'), loadStatus: $('load-status'),
  };

  const CHUNK_SIZE = 250;  // messages to show per chunk on screen
  const state = { rawText: '', fileName: '', sha256: '', media: new Map(), mediaUrls: new Map(), mediaLoads: new Map(), parsed: null, pro: false, chunkIndex: 0, lastDay: '', safe: freshSafeState() };
  let safeRunSequence = 0;
  let printJob = null;
  let printDocument = null;
  let downloadUrl = null;
  const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
  function freshSafeState() { return { fingerprint: '', status: 'idle', findings: new Map(), excludedIds: new Set(), unanalysed: [], policyVersion: SafePolicy.VERSION, partialCoverage: false, worker: null, workerReady: false, activeRunId: 0 }; }

  // ---------- Pro / licensing ----------
  function loadLicense() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.LICENSE_STORAGE_KEY) || 'null');
      if (saved && saved.key && saved.ok) state.pro = true;
    } catch (e) { /* ignore */ }
    applyProUI();
  }
  function applyProUI() {
    els.proState.textContent = state.pro ? 'active' : 'locked';
    els.proState.classList.toggle('on', state.pro);
    els.proCta.hidden = state.pro;
    els.media.disabled = els.evidence.disabled = els.safe.disabled = !state.pro;
    const url = CONFIG.GUMROAD_PRODUCT_URL || '#pro';
    els.buy.href = url; els.buy2.href = url;
    if (CONFIG.PRICE_LABEL) { els.price.textContent = CONFIG.PRICE_LABEL; els.buy.textContent = 'Unlock Pro — ' + CONFIG.PRICE_LABEL; }
    if (!CONFIG.GUMROAD_PRODUCT_URL) { els.buy.removeAttribute('target'); els.buy2.removeAttribute('target'); }
  }
  async function verifyLicense(key) {
    key = key.trim();
    if (!key) throw new Error('Enter your license key.');
    if (!CONFIG.GUMROAD_PRODUCT_ID) throw new Error('Store not configured yet.');
    const body = new URLSearchParams({ product_id: CONFIG.GUMROAD_PRODUCT_ID, license_key: key, increment_uses_count: 'false' });
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'License key not recognised.');
    const p = data.purchase || {};
    if (p.refunded || p.chargebacked || p.disputed) throw new Error('This license was refunded or disputed.');
    localStorage.setItem(CONFIG.LICENSE_STORAGE_KEY, JSON.stringify({ key, ok: true, email: p.email || '', at: Date.now() }));
    state.pro = true; applyProUI(); render();
  }
  els.licenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.licenseMsg.textContent = 'Checking…';
    try { await verifyLicense(els.licenseKey.value); els.licenseMsg.textContent = 'Pro activated on this browser. Thank you!'; }
    catch (err) { els.licenseMsg.textContent = err.message; }
  });
  const qs = new URLSearchParams(location.search);
  // ?sample=1 loads a bundled synthetic chat so visitors can see the output instantly (also used by the smoke test)
  if (qs.get('sample')) {
    fetch('test/sample-ios.txt').then(r => r.text()).then(t => loadFile(new File([t], 'WhatsApp Chat - Sample.txt', { type: 'text/plain' }))).catch(() => {});
  }
  // Support ?license=KEY in the URL (Gumroad redirect after purchase)
  if (qs.get('license')) { els.licenseKey.value = qs.get('license'); verifyLicense(qs.get('license')).catch(() => {}); }

  // ---------- File loading ----------
  els.drop.addEventListener('click', () => els.file.click());
  els.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); } });
  ['dragenter', 'dragover'].forEach(ev => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
  els.drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
  els.file.addEventListener('change', () => { if (els.file.files[0]) loadFile(els.file.files[0]); });

  async function loadFile(file) {
    if (printJob) return;
    clearDownload();
    clearPrintDocument();
    resetSafeMode(false);
    resetMedia();
    state.fileName = file.name;
    try {
      if (/\.zip$/i.test(file.name) || file.type === 'application/zip') await loadZip(file);
      else state.rawText = await file.text();
    } catch (err) { alert('Could not read that file: ' + err.message); return; }
    state.sha256 = await sha256Hex(state.rawText);
    parseAndShow();
  }
  async function loadZip(file) {
    if (typeof JSZip === 'undefined') throw new Error('Zip support failed to load (offline?). Extract the zip and drop the .txt instead.');
    const zip = await JSZip.loadAsync(file);
    let best = null;
    const entries = Object.values(zip.files).filter(f => !f.dir);
    for (const f of entries) {
      const name = f.name.split('/').pop();
      if (/\.txt$/i.test(name)) {
        const score = (/_chat\.txt$/i.test(name) ? 3 : 0) + (/whatsapp/i.test(name) ? 2 : 0);
        if (!best || score > best.score) best = { f, score };
      } else if (/\.(jpe?g|png|gif|webp)$/i.test(name)) {
        state.media.set(name, f);
      } else {
        state.media.set(name, f);
      }
    }
    if (!best) throw new Error('No .txt chat file found inside the zip.');
    state.rawText = await best.f.async('string');
  }
  function resetMedia() {
    for (const u of state.mediaUrls.values()) URL.revokeObjectURL(u);
    state.media = new Map(); state.mediaUrls = new Map(); state.mediaLoads = new Map();
  }
  async function sha256Hex(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }

  // ---------- Parse ----------
  function parseAndShow() {
    invalidateSafe('The source or date interpretation changed. Analyse again.');
    state.parsed = WAParser.parse(state.rawText, { dateOrder: els.order.value });
    state.chunkIndex = 0;
    state.lastDay = '';
    const p = state.parsed;
    els.hero.hidden = true; els.app.hidden = false;
    // populate "me" select
    const prev = els.me.value;
    els.me.innerHTML = '<option value="">— nobody / group view —</option>' + p.senders.map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${s.count})</option>`).join('');
    if (prev && p.senders.some(s => s.name === prev)) els.me.value = prev;
    else if (p.senders.length === 2) els.me.value = p.senders[1].name; // guess: less-frequent sender is often "me"; user can change
    const guessTitle = state.fileName.replace(/\.(txt|zip)$/i, '').replace(/^WhatsApp Chat( with| -)?\s*/i, '').replace(/^_chat$/i, '');
    if (!els.title.value) els.title.value = guessTitle ? 'Chat with ' + guessTitle : 'WhatsApp chat';
    els.chatTitle.textContent = state.fileName;
    els.warnings.textContent = p.warnings.join(' ');
    if (p.first && !els.from.value) { els.from.min = isoDate(p.first); els.to.max = isoDate(p.last); }
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- Safe Mode ----------
  function safeCategories() { return Array.from(document.querySelectorAll('[name="safe-category"]:checked'), el => el.value); }
  function safeFingerprint() {
    return SafePolicy.stableFingerprint({
      source: state.sha256, ids: currentMessages().map(m => m.id), categories: safeCategories(),
      customTerms: SafePolicy.customTerms(els.safeTerms.value), media: !!els.media.checked,
    });
  }
  function safeReady() { return !els.safe.checked || (state.safe.status === 'applied' && state.safe.fingerprint === safeFingerprint()); }
  function updateSafeExportState() {
    const blocked = !!(state.parsed && els.safe.checked && !safeReady());
    els.export.disabled = blocked; els.print.disabled = blocked;
    if (blocked && state.safe.status !== 'scanning') els.exportStatus.textContent = 'Safe mode export is blocked until the current scan is reviewed and applied.';
    else if (!blocked && /^Safe mode export is blocked/.test(els.exportStatus.textContent)) els.exportStatus.textContent = '';
  }
  function invalidateSafe(message) {
    if (state.safe.status === 'scanning') destroySafeWorker(true, true);
    state.safe.fingerprint = ''; state.safe.status = els.safe && els.safe.checked ? 'stale' : 'idle';
    state.safe.findings.clear(); state.safe.excludedIds.clear(); state.safe.unanalysed = [];
    if (els.safeStatus && els.safe.checked) els.safeStatus.textContent = message || 'Options changed. Analyse again before exporting.';
    if (state.parsed) { updateSafeExportState(); render(); }
  }
  function destroySafeWorker(cancel, keepWorker) {
    const worker = state.safe.worker, runId = state.safe.activeRunId;
    if (cancel && runId && worker) worker.postMessage({ type: 'cancel', runId });
    if (!keepWorker) {
      state.safe.worker = null; state.safe.workerReady = false; state.safe.activeRunId = 0;
      if (worker) worker.terminate();
    } else {
      state.safe.activeRunId = 0;
    }
  }
  function resetSafeMode(uncheck) {
    if (state.safe) destroySafeWorker(true);
    state.safe = freshSafeState();
    if (uncheck && els.safe) els.safe.checked = false;
    if (els.safeOptions) els.safeOptions.hidden = !els.safe.checked;
    if (els.safeStatus) els.safeStatus.textContent = '';
    updateSafeExportState();
  }
  function safeFailure(message) {
    destroySafeWorker(false, true); state.safe.status = 'error';
    els.safeCancel.hidden = true; els.safeAnalyse.disabled = false;
    els.safeStatus.replaceChildren(document.createTextNode(`Safe mode failed: ${message} `));
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'link-button'; retry.textContent = 'Retry'; retry.onclick = startSafeScan;
    const disable = document.createElement('button'); disable.type = 'button'; disable.className = 'link-button'; disable.textContent = 'Disable Safe mode'; disable.onclick = () => { els.safe.checked = false; els.safe.dispatchEvent(new Event('change')); };
    els.safeStatus.append(retry, document.createTextNode(' · '), disable);
    updateSafeExportState();
  }
  async function startSafeScan() {
    if (!state.pro || !state.parsed || state.safe.status === 'scanning') return;
    if (!window.Worker || !window.WebAssembly) { safeFailure('This browser does not support the required on-device worker and WebAssembly features.'); return; }
    invalidateSafe('Starting analysis…');
    const fingerprint = safeFingerprint(), messages = currentMessages(), runId = ++safeRunSequence;
    state.safe.status = 'scanning'; state.safe.activeRunId = runId;
    els.safeAnalyse.disabled = true; els.safeCancel.hidden = false; els.safeCancel.disabled = false;
    els.safeStatus.textContent = `Preparing to screen ${messages.length.toLocaleString()} messages…`;
    const worker = state.safe.worker || new Worker('safe-worker.js?v=1.2.0'); state.safe.worker = worker;
    let sent = false;
    const send = () => {
      if (sent || state.safe.worker !== worker || state.safe.activeRunId !== runId) return;
      sent = true; worker.postMessage({ type: 'analyse', runId, messages, categories: safeCategories(), customTerms: els.safeTerms.value, scanImages: els.media.checked && safeCategories().includes('images') });
    };
    const timeout = state.safe.workerReady ? null : setTimeout(() => { if (!state.safe.workerReady && state.safe.worker === worker) safeFailure('The screening worker did not start.'); }, 45000);
    worker.onerror = event => { event.preventDefault(); clearTimeout(timeout); if (state.safe.worker === worker) safeFailure(event.message || 'The worker stopped unexpectedly.'); };
    worker.onmessageerror = () => { if (state.safe.worker === worker) safeFailure('The browser could not receive screening results.'); };
    worker.onmessage = async ({ data }) => {
      if (state.safe.worker !== worker) return;
      if (data.type === 'ready') {
        state.safe.workerReady = true; clearTimeout(timeout); send(); return;
      }
      if (data.runId !== runId || state.safe.activeRunId !== runId) return;
      if (data.type === 'progress') els.safeStatus.textContent = data.message;
      else if (data.type === 'image-batch-request') {
        try {
          const buffers = await Promise.all(data.names.map(async name => { const entry = state.media.get(name); return entry ? entry.async('arraybuffer').catch(() => null) : null; }));
          if (state.safe.worker === worker && state.safe.activeRunId === runId) worker.postMessage({ type: 'image-batch-response', runId, requestId: data.requestId, buffers }, buffers.filter(Boolean));
        } catch (e) { if (state.safe.worker === worker && state.safe.activeRunId === runId) worker.postMessage({ type: 'image-batch-response', runId, requestId: data.requestId, buffers: data.names.map(() => null) }); }
      } else if (data.type === 'complete') {
        state.safe.status = 'review'; state.safe.activeRunId = 0; state.safe.fingerprint = fingerprint; state.safe.policyVersion = data.policyVersion;
        state.safe.unanalysed = data.unanalysed || []; state.safe.partialCoverage = !!data.partialCoverage;
        state.safe.findings = new Map();
        for (const finding of data.findings || []) {
          if (!state.safe.findings.has(finding.messageId)) state.safe.findings.set(finding.messageId, []);
          state.safe.findings.get(finding.messageId).push(finding);
        }
        els.safeAnalyse.disabled = false; els.safeCancel.hidden = true;
        const engine = data.device === 'wasm' ? ' Used WASM.' : data.device === 'webgpu' ? ' Used WebGPU.' : ' Used deterministic local rules.';
        els.safeStatus.textContent = `${state.safe.findings.size.toLocaleString()} messages flagged for review.` + (data.partialCoverage ? ' Non-English text has partial coverage.' : '') + engine;
        openSafeReview(); updateSafeExportState();
      } else if (data.type === 'error') { clearTimeout(timeout); safeFailure(data.message || 'Unknown model error.'); }
    };
    if (state.safe.workerReady) send();
  }
  function openSafeReview() {
    els.safeReviewList.replaceChildren(); els.safeUnanalysedWrap.replaceChildren(); els.safeAck.checked = false;
    const messages = state.parsed.messages;
    const messageIndexById = new Map(messages.map((m, i) => [m.id, i]));
    for (const [id, findings] of state.safe.findings) {
      const index = messageIndexById.get(id); if (index === undefined) continue;
      const m = messages[index], item = document.createElement('article'); item.className = 'review-item';
      const label = document.createElement('label'); label.className = 'review-choice';
      const check = document.createElement('input'); check.type = 'checkbox'; check.name = 'safe-remove'; check.value = id; check.checked = state.safe.status === 'applied' ? state.safe.excludedIds.has(id) : true;
      const summary = document.createElement('span'); summary.textContent = `Remove · ${fmtDateTime(m.date, m.hasSeconds)} · ${m.sender || 'System'}`; label.append(check, summary); item.appendChild(label);
      const reasons = document.createElement('div'); reasons.className = 'review-reasons'; reasons.textContent = findings.map(f => `${SafePolicy.LABELS[f.category] || f.category}: ${f.reason}`).join(' · '); item.appendChild(reasons);
      const text = document.createElement('blockquote'); text.textContent = m.text || '(attachment only)'; item.appendChild(text);
      const around = [messages[index - 1], messages[index + 1]].filter(Boolean).map(x => `${x.sender || 'System'}: ${x.text || '(attachment)'}`).join('\n');
      if (around) { const context = document.createElement('pre'); context.className = 'review-context'; context.textContent = around; item.appendChild(context); }
      const imageFinding = findings.find(f => f.attachment);
      if (imageFinding) {
        const entry = state.media.get(imageFinding.attachment), wrap = document.createElement('div'); wrap.className = 'safe-thumb';
        const img = document.createElement('img'); img.alt = imageFinding.attachment; img.className = 'blurred';
        if (entry) objectUrl(imageFinding.attachment, entry).then(url => { img.src = url; }).catch(() => img.remove());
        const reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'btn'; reveal.textContent = 'Reveal sensitive image'; reveal.onclick = () => { img.classList.remove('blurred'); reveal.remove(); };
        wrap.append(img, reveal); item.appendChild(wrap);
      }
      els.safeReviewList.appendChild(item);
    }
    if (!state.safe.findings.size) { const p = document.createElement('p'); p.textContent = 'No messages were flagged. Apply to confirm this scan.'; els.safeReviewList.appendChild(p); }
    els.safeUnanalysedWrap.hidden = !state.safe.unanalysed.length;
    if (state.safe.unanalysed.length) {
      const check = els.safeUnanalysedWrap.querySelector('input');
      els.safeUnanalysedWrap.appendChild(document.createTextNode(` (${state.safe.unanalysed.join(', ')})`));
      if (check) els.safeUnanalysedWrap.insertBefore(check, els.safeUnanalysedWrap.firstChild);
    }
    els.safeApply.disabled = !!state.safe.unanalysed.length;
    els.safeReview.showModal();
  }
  function applySafeReview() {
    if (state.safe.unanalysed.length && !els.safeAck.checked) return;
    state.safe.excludedIds = new Set(Array.from(els.safeReviewList.querySelectorAll('[name="safe-remove"]:checked'), x => Number(x.value)));
    state.safe.status = 'applied'; state.safe.fingerprint = safeFingerprint();
    els.safeReview.close(); els.safeStatus.textContent = `${state.safe.excludedIds.size.toLocaleString()} messages removed from this edited excerpt.` + (state.safe.partialCoverage ? ' Non-English text had partial screening coverage.' : '');
    updateSafeExportState(); render();
  }

  // ---------- Render ----------
  function currentMessages() {
    const p = state.parsed; if (!p) return [];
    const from = els.from.value ? new Date(els.from.value + 'T00:00:00') : null;
    const to = els.to.value ? new Date(els.to.value + 'T23:59:59') : null;
    const q = els.search.value.trim().toLowerCase();
    return p.messages.filter(m => (!from || m.date >= from) && (!to || m.date <= to) && (!q || (m.text || '').toLowerCase().includes(q) || (m.sender || '').toLowerCase().includes(q)));
  }

  // Helper: create the cover or title. Running headers use the page margin.
  function docHeader(ctx) {
    const { title, displayMsgs, evidence, senders } = ctx;
    const frag = document.createDocumentFragment();
    if (evidence) frag.appendChild(coverPage(title, displayMsgs));
    else {
      const h = document.createElement('h1'); h.className = 'doc-title'; h.textContent = title; frag.appendChild(h);
      const s = document.createElement('div'); s.className = 'doc-sub';
      s.textContent = `${senders.map(x => x.name).join(', ')} · ${displayMsgs.length.toLocaleString()} messages · ${fmtDate(displayMsgs[0] && displayMsgs[0].date)} – ${fmtDate(displayMsgs[displayMsgs.length - 1] && displayMsgs[displayMsgs.length - 1].date)}`;
      frag.appendChild(s);
    }
    return frag;
  }

  // Each render has its own day cursor; preparing a PDF must not change the preview.
  function messageRows(msgs, ctx) {
    const { me, evidence, embed, numWidth, tailMarkerCount } = ctx;
    const frag = document.createDocumentFragment();
    const imageTasks = [];

    for (const m of msgs) {
      const day = m.date.toDateString();
      if (day !== ctx.lastDay) {
        ctx.lastDay = day;
        const d = document.createElement('div'); d.className = 'day'; const sp = document.createElement('span'); sp.textContent = fmtDay(m.date); d.appendChild(sp); frag.appendChild(d);
      }
      const row = document.createElement('div');
      row.className = 'msg' + (m.system ? ' system' : (me && m.sender === me ? ' me' : ''));
      const b = document.createElement('div'); b.className = 'bubble';
      if (evidence) { const n = document.createElement('span'); n.className = 'num'; n.textContent = '#' + String(m.id).padStart(numWidth, '0'); b.appendChild(n); }
      if (!m.system && m.sender && (evidence || ctx.plain || m.sender !== me)) { const s = document.createElement('span'); s.className = 'sender'; s.textContent = m.sender; b.appendChild(s); }
      for (const a of m.attachments) {
        const entry = state.media.get(a);
        if (embed && entry && /\.(jpe?g|png|gif|webp)$/i.test(a)) {
          const img = document.createElement('img'); img.alt = a; img.loading = 'eager'; b.appendChild(img);
          imageTasks.push(async () => {
            try {
              img.src = await (ctx.imageUrl || objectUrl)(a, entry);
              await img.decode();
            } catch (err) {
              const label = document.createElement('span'); label.className = 'att';
              label.textContent = '📎 ' + a + ' (image unavailable)'; img.replaceWith(label);
              if (ctx.onImageError) ctx.onImageError();
            }
          });
        } else { const c = document.createElement('span'); c.className = 'att'; c.textContent = '📎 ' + a; b.appendChild(c); }
      }
      if (m.mediaOmitted) { const c = document.createElement('span'); c.className = 'att'; c.textContent = '📎 media (not included in export)'; b.appendChild(c); }
      if (m.deleted) { const t = document.createElement('span'); t.className = 'deleted'; t.textContent = 'This message was deleted'; b.appendChild(t); }
      else if (m.text) { b.appendChild(linkify(m.text)); }
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = evidence ? fmtDateTime(m.date, m.hasSeconds) : fmtTime(m.date); b.appendChild(meta);
      row.appendChild(b); frag.appendChild(row);
    }

    // Add free-tier tail marker if requested
    if (tailMarkerCount > 0) {
      const end = document.createElement('div'); end.className = 'day'; const sp = document.createElement('span'); sp.textContent = `… ${tailMarkerCount.toLocaleString()} more messages in the full version`; end.appendChild(sp); frag.appendChild(end);
    }

    return { frag, imageTasks };
  }

  // Everything the header/rows need for the current filters + tier.
  function docContext() {
    const p = state.parsed;
    const excluded = els.safe.checked && state.safe.status === 'applied' ? state.safe.excludedIds : new Set();
    const all = currentMessages().filter(m => !excluded.has(m.id));
    const limited = !state.pro && all.length > CONFIG.FREE_LIMIT;
    const displayMsgs = limited ? all.slice(0, CONFIG.FREE_LIMIT) : all;
    return {
      all, limited, displayMsgs, senders: p.senders,
      me: els.me.value,
      plain: els.style.value === 'plain',
      lastDay: '',
      evidence: state.pro && els.evidence.checked,
      embed: state.pro && els.media.checked && state.media.size > 0,
      title: els.title.value || 'WhatsApp chat',
      numWidth: String(displayMsgs.length).length,
      hiddenCount: limited ? all.length - displayMsgs.length : 0,
    };
  }

  // Render one on-screen chunk. Chunk 0 replaces the document (header + first rows); later chunks append.
  function renderChunk(chunkIndex) {
    if (printJob) return;
    if (chunkIndex === 0) clearDownload();
    clearPrintDocument();
    const p = state.parsed; if (!p) return;
    const ctx = docContext();
    const { all, limited, displayMsgs } = ctx;
    const chunkStart = chunkIndex * CHUNK_SIZE;
    if (chunkIndex > 0 && chunkStart >= displayMsgs.length) return;  // nothing left to append
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, displayMsgs.length);
    const hasMore = chunkEnd < displayMsgs.length;

    const frag = document.createDocumentFragment();
    if (chunkIndex === 0) {
      els.doc.className = 'doc size-' + els.size.value + (els.style.value === 'plain' ? ' plain' : '') + (limited ? ' wm' : '');
      setPaper(els.paper.value);
      els.stats.textContent = `${p.messages.length.toLocaleString()} messages · ${p.senders.length} participants · ${fmtDate(p.first)} → ${fmtDate(p.last)} · dates read as ${p.dateOrder}` + (all.length !== p.messages.length ? ` · ${all.length.toLocaleString()} match filters` : '');
      if (limited) {
        els.notice.hidden = false;
        els.notice.innerHTML = `Free preview shows the first <strong>${CONFIG.FREE_LIMIT}</strong> of <strong>${all.length.toLocaleString()}</strong> messages with a watermark. <a href="${CONFIG.GUMROAD_PRODUCT_URL || '#pro'}" target="_blank" rel="noopener">Unlock Pro</a> for the full chat.`;
      } else els.notice.hidden = true;
      state.lastDay = '';
      frag.appendChild(docHeader(ctx));
    }
    ctx.lastDay = state.lastDay;
    ctx.tailMarkerCount = hasMore ? 0 : ctx.hiddenCount;
    const rows = messageRows(displayMsgs.slice(chunkStart, chunkEnd), ctx);
    state.lastDay = ctx.lastDay;
    frag.appendChild(rows.frag);
    if (chunkIndex === 0) els.doc.replaceChildren(frag); else els.doc.appendChild(frag);
    runImageTasks(rows.imageTasks);

    state.chunkIndex = chunkIndex;
    els.loadMoreControls.hidden = !hasMore;
    if (hasMore) els.loadStatus.textContent = `Showing ${chunkEnd.toLocaleString()} of ${displayMsgs.length.toLocaleString()} messages`;
  }

  function render() { renderChunk(0); }

  // Hidden on screen: the browser lays out the full chat only once, for printing.
  function createPrintDocument(ctx) {
    clearPrintDocument();
    setPaper(els.paper.value);
    const doc = document.createElement('article');
    doc.id = 'print-doc';
    doc.className = 'doc size-' + els.size.value + (ctx.plain ? ' plain' : '') + (ctx.limited ? ' wm' : '');
    doc.appendChild(docHeader(ctx));
    document.body.appendChild(doc);
    printDocument = doc;
    return doc;
  }

  function clearPrintDocument() {
    if (printDocument) {
      if (printDocument.releaseImages) printDocument.releaseImages();
      printDocument.remove();
    }
    printDocument = null;
    document.body.classList.remove('print-ready');
  }

  async function runImageTasks(tasks, job) {
    // Avoid inflating/decoding an entire ZIP's photos concurrently.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (cursor < tasks.length && !(job && job.cancelled)) await tasks[cursor++]();
    }));
  }

  function coverPage(title, all) {
    const p = state.parsed;
    const c = document.createElement('div'); c.className = 'cover';
    const h = document.createElement('h1'); h.textContent = title; c.appendChild(h);
    const sub = document.createElement('div'); sub.className = 'muted'; sub.textContent = 'WhatsApp chat transcript — evidence export'; c.appendChild(sub);
    const rows = [
      ['Source file', state.fileName],
      ['SHA-256 of chat text', state.sha256 || 'n/a'],
      ['Participants', p.senders.map(s => `${s.name} (${s.count.toLocaleString()} messages)`).join('; ')],
      ['Messages in export', p.messages.length.toLocaleString()],
      ['Messages in this document', all.length.toLocaleString() + (all.length !== p.messages.length ? ' (filtered: ' + filterDesc() + ')' : '')],
      ['Date range', `${fmtDateTime(all[0] && all[0].date, true)} to ${fmtDateTime(all[all.length - 1] && all[all.length - 1].date, true)}`],
      ['Date format in source', p.dateOrder === 'DMY' ? 'day/month/year' : p.dateOrder === 'MDY' ? 'month/day/year' : 'year/month/day'],
      ['Document generated', fmtDateTime(new Date(), true) + ' (local time)'],
      ['Method', 'Parsed locally in the browser from the unmodified WhatsApp "Export chat" file. Message numbers follow the original order in the export.'],
    ];
    const t = document.createElement('table');
    for (const [k, v] of rows) { const tr = document.createElement('tr'); const a = document.createElement('td'); a.textContent = k; const b = document.createElement('td'); b.textContent = v; if (k.startsWith('SHA')) b.className = 'hash'; tr.append(a, b); t.appendChild(tr); }
    c.appendChild(t);
    return c;
  }
  function filterDesc() {
    const parts = [];
    if (els.from.value) parts.push('from ' + els.from.value);
    if (els.to.value) parts.push('to ' + els.to.value);
    if (els.search.value.trim()) parts.push('containing "' + els.search.value.trim() + '"');
    return parts.join(', ') || 'none';
  }
  async function objectUrl(name, entry) {
    if (state.mediaUrls.has(name)) return state.mediaUrls.get(name);
    if (state.mediaLoads.has(name)) return state.mediaLoads.get(name);
    const urls = state.mediaUrls, loads = state.mediaLoads;
    const pending = entry.async('blob').then(blob => {
      if (urls !== state.mediaUrls) throw new Error('Chat changed');
      const u = URL.createObjectURL(blob); urls.set(name, u); return u;
    }).finally(() => loads.delete(name));
    loads.set(name, pending);
    return pending;
  }

  function printImageUrl(name, entry, job) {
    if (job.images.has(name)) return job.images.get(name);
    const pending = (async () => {
      const blob = await entry.async('blob');
      if (job.cancelled) throw new Error('Cancelled');
      const source = URL.createObjectURL(blob);
      const img = new Image();
      try {
        img.src = source;
        await img.decode();
        if (job.cancelled) throw new Error('Cancelled');
        // Keep photos at print resolution instead of their full camera resolution.
        // Full-resolution phone photos otherwise exhaust the print engine's memory.
        const scale = Math.min(1, 1800 / img.naturalWidth, 1260 / img.naturalHeight);
        let output = blob;
        if (scale < 1) {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const type = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
          output = await new Promise(resolve => canvas.toBlob(resolve, type, 0.92));
          canvas.width = canvas.height = 0;
          if (!output) throw new Error('Could not prepare photo');
        }
        if (job.cancelled) throw new Error('Cancelled');
        const url = URL.createObjectURL(output);
        job.urls.add(url);
        return url;
      } finally {
        img.removeAttribute('src');
        URL.revokeObjectURL(source);
      }
    })();
    job.images.set(name, pending);
    return pending;
  }
  function setPaper(p) {
    let st = document.getElementById('paper-style');
    if (!st) { st = document.createElement('style'); st.id = 'paper-style'; document.head.appendChild(st); }
    const heading = `${els.title.value || 'WhatsApp chat'} — exported ${fmtDate(new Date())} — ${state.fileName}`;
    // A page-margin box stays outside the messages. Fixed DOM headers can overlap
    // photos and long messages when Chromium fragments thousands of pages.
    st.textContent = `@page { size: ${p === 'letter' ? 'letter' : 'A4'};
      @top-left { content: "${CSS.escape(heading)}"; font: 8pt sans-serif; color: #666; max-width: 180mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }`;
  }

  // ---------- Helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function linkify(text) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s<>"]+)/g; let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement('a'); a.href = m[1]; a.textContent = m[1]; a.rel = 'noopener'; a.target = '_blank'; frag.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  // Reusing Intl formatters avoids thousands of costly ICU allocations per export.
  const dateFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  function fmtDate(d) { return d ? dateFormatter.format(d) : ''; }
  function fmtDay(d) { return dayFormatter.format(d); }
  function fmtTime(d) { return timeFormatter.format(d); }
  function fmtDateTime(d, secs) { return d ? `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}${secs ? ':' + pad(d.getSeconds()) : ''}` : ''; }

  // ---------- Print handling ----------
  // Route keyboard printing through the asynchronous preparation, including images.
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && state.parsed) {
      e.preventDefault(); printChat();
    }
  });
  // File > Print cannot await preparation. Preserve the full text for that path too.
  window.addEventListener('beforeprint', () => {
    if (!printJob) scheduleRender.flush();
    if (state.parsed && els.safe.checked && !safeReady()) {
      clearPrintDocument();
      const doc = document.createElement('article'); doc.id = 'print-doc'; doc.className = 'doc';
      const warning = document.createElement('h1'); warning.textContent = 'Safe mode review required'; doc.appendChild(warning);
      document.body.appendChild(doc); printDocument = doc; document.body.classList.add('print-ready'); return;
    }
    if (!state.parsed || (printJob && printJob.ready) || (!printJob && printDocument)) return;
    // A browser-menu print during preparation must never print a partial batch.
    if (printJob) { printJob.cancelled = true; if (printJob.cancel) printJob.cancel(); }
    const ctx = docContext();
    const doc = createPrintDocument(ctx);
    ctx.tailMarkerCount = ctx.hiddenCount;
    const rows = messageRows(ctx.displayMsgs, ctx);
    doc.appendChild(rows.frag);
    runImageTasks(rows.imageTasks);
    document.body.classList.add('print-ready');
  });
  window.addEventListener('afterprint', () => {
    if (!printJob || printJob.ready || printJob.cancelled) clearPrintDocument();
  });

  // ---------- Load-more handlers ----------
  els.loadMore.addEventListener('click', () => {
    const last = els.doc.lastElementChild;
    renderChunk(state.chunkIndex + 1);
    if (last && last.nextElementSibling) last.nextElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  els.loadAll.addEventListener('click', () => {
    const total = docContext().displayMsgs.length;
    while ((state.chunkIndex + 1) * CHUNK_SIZE < total) renderChunk(state.chunkIndex + 1);
  });

  function clearDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    els.download.hidden = true;
    els.download.removeAttribute('href');
    els.exportStatus.textContent = '';
  }

  // Generate the file off the main thread. Never invoke Edge's print preview for saving.
  async function exportPdf() {
    if (!state.parsed || printJob) return;
    scheduleRender.flush();
    if (!safeReady()) { updateSafeExportState(); return; }
    clearPrintDocument();
    clearDownload();
    const ctx = docContext();
    const job = { cancelled: false };
    printJob = job;
    const controls = Array.from(els.app.querySelectorAll('input, select, button')).map(el => [el, el.disabled]);
    controls.forEach(([el]) => { el.disabled = true; });
    els.export.textContent = 'Creating PDF…';
    els.cancelExport.hidden = false; els.cancelExport.disabled = false;
    els.exportStatus.textContent = 'Starting PDF generator…';
    let worker, startupTimer;
    try {
      const result = await new Promise((resolve, reject) => {
        worker = new Worker('pdf-worker.js');
        job.cancel = () => { worker.terminate(); resolve(null); };
        startupTimer = setTimeout(() => reject(new Error('PDF generator did not load. Check your connection and retry.')), 45000);
        worker.onerror = event => { event.preventDefault(); reject(new Error(event.message || 'PDF worker stopped unexpectedly.')); };
        worker.onmessageerror = () => reject(new Error('Could not receive the PDF.'));
        worker.onmessage = async ({ data }) => {
          if (job.cancelled) return;
          if (data.type === 'ready') clearTimeout(startupTimer);
          else if (data.type === 'progress') els.exportStatus.textContent = data.message;
          else if (data.type === 'error') reject(new Error(data.message));
          else if (data.type === 'done') resolve(data);
          else if (data.type === 'image') {
            // Only one photo is inflated at a time; never copy the entire ZIP to the worker.
            try {
              const entry = state.media.get(data.name);
              const buffer = entry ? await entry.async('arraybuffer') : null;
              if (!job.cancelled) worker.postMessage({ type: 'image', buffer }, buffer ? [buffer] : []);
            } catch (err) {
              if (!job.cancelled) worker.postMessage({ type: 'image', buffer: null });
            }
          }
        };
        const header = docHeader(ctx);
        worker.postMessage({
          type: 'export', messages: ctx.displayMsgs,
          options: {
            title: ctx.title, fileName: state.fileName, me: ctx.me, plain: ctx.plain,
            evidence: ctx.evidence, embed: ctx.embed, limited: ctx.limited,
            hiddenCount: ctx.hiddenCount, numWidth: ctx.numWidth,
            paper: els.paper.value, size: els.size.value, locale: dateFormatter.resolvedOptions().locale,
            subtitle: header.querySelector('.doc-sub')?.textContent || '',
            cover: Array.from(header.querySelectorAll('tr'), row => Array.from(row.cells, cell => cell.textContent)),
          },
        });
      });
      if (!result || job.cancelled) return;
      downloadUrl = URL.createObjectURL(new Blob([result.buffer], { type: 'application/pdf' }));
      els.download.href = downloadUrl;
      els.download.download = (ctx.title.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 160).trim() || 'WhatsApp chat') + '.pdf';
      els.download.hidden = false;
      els.download.click();
      els.exportStatus.textContent = `PDF ready (${result.pages.toLocaleString()} ${result.pages === 1 ? 'page' : 'pages'}). Download started; use the link above if needed.`
        + (result.imageErrors ? ` ${result.imageErrors.toLocaleString()} ${result.imageErrors === 1 ? 'photo' : 'photos'} unavailable; filenames are included.` : '');
    } catch (err) {
      els.exportStatus.textContent = 'Could not create the PDF. Please retry. ' + err.message;
    } finally {
      clearTimeout(startupTimer);
      if (worker) worker.terminate();
      if (job.cancelled) els.exportStatus.textContent = 'PDF preparation cancelled.';
      printJob = null;
      controls.forEach(([el, disabled]) => { el.disabled = disabled; });
      els.cancelExport.hidden = true;
      els.export.textContent = 'Save as PDF';
    }
  }

  // ---------- Paper printing: prepare in batches without changing the screen preview ----------
  async function printChat() {
    if (!state.parsed || printJob) return;
    // Apply pending edits once, before taking the export snapshot. A delayed
    // preview render must not remove the print document in a non-blocking browser.
    scheduleRender.flush();
    if (!safeReady()) { updateSafeExportState(); return; }
    clearPrintDocument();
    const job = { cancelled: false, ready: false, images: new Map(), urls: new Set(), imageErrors: 0 };
    printJob = job;
    const controls = Array.from(els.app.querySelectorAll('input, select, button')).map(el => [el, el.disabled]);
    controls.forEach(([el]) => { el.disabled = true; });
    els.export.textContent = 'Preparing PDF…';
    els.cancelExport.hidden = false; els.cancelExport.disabled = false;
    els.exportStatus.textContent = 'Preparing messages…';
    try {
      await nextTask();
      if (job.cancelled) return;
      const ctx = docContext();
      ctx.imageUrl = (name, entry) => printImageUrl(name, entry, job);
      ctx.onImageError = () => { if (!job.cancelled) job.imageErrors++; };
      const doc = createPrintDocument(ctx);
      job.doc = doc;
      doc.releaseImages = () => { job.urls.forEach(url => URL.revokeObjectURL(url)); job.urls.clear(); job.images.clear(); };
      for (let start = 0; start < ctx.displayMsgs.length; start += CHUNK_SIZE) {
        if (job.cancelled) return;
        const end = Math.min(start + CHUNK_SIZE, ctx.displayMsgs.length);
        ctx.tailMarkerCount = end === ctx.displayMsgs.length ? ctx.hiddenCount : 0;
        const rows = messageRows(ctx.displayMsgs.slice(start, end), ctx);
        doc.appendChild(rows.frag);
        els.exportStatus.textContent = `Preparing ${end.toLocaleString()} of ${ctx.displayMsgs.length.toLocaleString()} messages…`;
        await runImageTasks(rows.imageTasks, job);
        await nextTask();
      }
      if (job.cancelled) return;
      await document.fonts.ready;
      if (job.cancelled) return;
      job.ready = true;
      document.body.classList.add('print-ready');
      els.cancelExport.hidden = true;
      els.exportStatus.textContent = 'Opening print dialog…';
      await nextTask();
      window.print();
      els.exportStatus.textContent = job.imageErrors
        ? `Print dialog opened. ${job.imageErrors.toLocaleString()} ${job.imageErrors === 1 ? 'photo is' : 'photos are'} unavailable and labelled in the document.`
        : 'Choose Save as PDF in the print dialog.';
    } catch (err) {
      clearPrintDocument();
      els.exportStatus.textContent = 'Could not prepare the PDF. Please try again. ' + err.message;
    } finally {
      if (job.cancelled) {
        if (printDocument === job.doc) clearPrintDocument();
        els.exportStatus.textContent = 'PDF preparation cancelled.';
      }
      printJob = null;
      controls.forEach(([el, disabled]) => { el.disabled = disabled; });
      els.cancelExport.hidden = true;
      els.export.textContent = 'Save as PDF';
      // Do not await afterprint: some browsers return without firing it. The hidden
      // document is retained until afterprint or the next edit/export in those browsers.
    }
  }
  els.cancelExport.addEventListener('click', () => {
    if (printJob) {
      printJob.cancelled = true;
      if (printJob.cancel) printJob.cancel();
      els.cancelExport.disabled = true;
      els.exportStatus.textContent = 'Cancelling preparation…';
    }
  });

  // ---------- Wiring ----------
  const scheduleRender = debounce(render, 150);
  ['title', 'me', 'from', 'to', 'search', 'paper', 'size', 'style', 'media', 'evidence'].forEach(k => els[k].addEventListener(k === 'search' || k === 'title' ? 'input' : 'change', scheduleRender));
  ['from', 'to', 'search', 'media'].forEach(k => els[k].addEventListener(k === 'search' ? 'input' : 'change', () => invalidateSafe('Selection changed. Analyse again before exporting.')));
  els.safe.addEventListener('change', () => {
    if (els.safe.checked) { els.evidence.checked = false; els.safeOptions.hidden = false; invalidateSafe('Choose categories, then analyse the current selection.'); }
    else { resetSafeMode(false); els.safeOptions.hidden = true; render(); }
  });
  els.evidence.addEventListener('change', () => { if (els.evidence.checked && els.safe.checked) { els.safe.checked = false; resetSafeMode(false); els.safeOptions.hidden = true; } });
  document.querySelectorAll('[name="safe-category"]').forEach(el => el.addEventListener('change', () => invalidateSafe('Categories changed. Analyse again before exporting.')));
  els.safeTerms.addEventListener('input', () => invalidateSafe('Custom terms changed. Analyse again before exporting.'));
  els.safeAnalyse.addEventListener('click', () => ['review', 'applied'].includes(state.safe.status) ? openSafeReview() : startSafeScan());
  els.safeCancel.addEventListener('click', () => {
    if (state.safe.status !== 'scanning') return; destroySafeWorker(true, true);
    state.safe.status = 'stale'; els.safeCancel.hidden = true; els.safeAnalyse.disabled = false; els.safeStatus.textContent = 'Analysis cancelled. Analyse again before exporting.'; updateSafeExportState();
  });
  els.safeSelectAll.addEventListener('click', () => els.safeReviewList.querySelectorAll('[name="safe-remove"]').forEach(x => { x.checked = true; }));
  els.safeClearAll.addEventListener('click', () => els.safeReviewList.querySelectorAll('[name="safe-remove"]').forEach(x => { x.checked = false; }));
  els.safeAck.addEventListener('change', () => { els.safeApply.disabled = state.safe.unanalysed.length && !els.safeAck.checked; });
  els.safeApply.addEventListener('click', applySafeReview);
  els.order.addEventListener('change', () => { if (!printJob) parseAndShow(); });
  els.export.addEventListener('click', exportPdf);
  els.print.addEventListener('click', printChat);
  els.reset.addEventListener('click', () => { clearDownload(); clearPrintDocument(); resetMedia(); resetSafeMode(true); state.parsed = null; state.rawText = ''; els.file.value = ''; els.title.value = ''; els.from.value = ''; els.to.value = ''; els.search.value = ''; els.exportStatus.textContent = ''; els.app.hidden = true; els.hero.hidden = false; });
  function debounce(fn, ms) {
    let timer = null;
    const run = () => { timer = null; fn(); };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(run, ms); };
    schedule.flush = () => { if (timer !== null) { clearTimeout(timer); run(); } };
    return schedule;
  }

  loadLicense();
})();
