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
    media: $('opt-media'), evidence: $('opt-evidence'), proState: $('pro-state'), proCta: $('pro-cta'),
    buy: $('buy'), buy2: $('buy2'), price: $('price'), licenseForm: $('license-form'), licenseKey: $('license-key'), licenseMsg: $('license-msg'),
    export: $('export'), reset: $('reset'), chatTitle: $('chat-title'), stats: $('stats'), warnings: $('warnings'),
    loadMoreControls: $('load-more-controls'), loadMore: $('load-more'), loadAll: $('load-all'), loadStatus: $('load-status'),
  };

  const CHUNK_SIZE = 250;  // messages to show per chunk on screen
  const state = { rawText: '', fileName: '', sha256: '', media: new Map(), mediaUrls: new Map(), parsed: null, pro: false, chunkIndex: 0, lastDay: '' };
  let printingFull = false;  // flag to guard against double-restoration

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
    els.media.disabled = els.evidence.disabled = !state.pro;
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
    state.media = new Map(); state.mediaUrls = new Map();
  }
  async function sha256Hex(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }

  // ---------- Parse ----------
  function parseAndShow() {
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

  // ---------- Render ----------
  function currentMessages() {
    const p = state.parsed; if (!p) return [];
    const from = els.from.value ? new Date(els.from.value + 'T00:00:00') : null;
    const to = els.to.value ? new Date(els.to.value + 'T23:59:59') : null;
    const q = els.search.value.trim().toLowerCase();
    return p.messages.filter(m => (!from || m.date >= from) && (!to || m.date <= to) && (!q || (m.text || '').toLowerCase().includes(q) || (m.sender || '').toLowerCase().includes(q)));
  }

  // Helper: create document header (running head + cover/title)
  function docHeader(ctx) {
    const { title, displayMsgs, evidence, senders } = ctx;
    const frag = document.createDocumentFragment();
    const head = document.createElement('div'); head.className = 'running-head'; head.textContent = `${title} — exported ${fmtDate(new Date())} — ${state.fileName}`; frag.appendChild(head);
    if (evidence) frag.appendChild(coverPage(title, displayMsgs));
    else {
      const h = document.createElement('h1'); h.className = 'doc-title'; h.textContent = title; frag.appendChild(h);
      const s = document.createElement('div'); s.className = 'doc-sub';
      s.textContent = `${senders.map(x => x.name).join(', ')} · ${displayMsgs.length.toLocaleString()} messages · ${fmtDate(displayMsgs[0] && displayMsgs[0].date)} – ${fmtDate(displayMsgs[displayMsgs.length - 1] && displayMsgs[displayMsgs.length - 1].date)}`;
      frag.appendChild(s);
    }
    return frag;
  }

  // Message rows for `msgs`; day separators continue across chunks via state.lastDay.
  function messageRows(msgs, ctx) {
    const { me, evidence, embed, numWidth, displayMsgs, tailMarkerCount } = ctx;
    const frag = document.createDocumentFragment();
    const urlPromises = [];

    // Track day across chunks using state.lastDay
    for (const m of msgs) {
      const day = m.date.toDateString();
      if (day !== state.lastDay) {
        state.lastDay = day;
        const d = document.createElement('div'); d.className = 'day'; const sp = document.createElement('span'); sp.textContent = fmtDay(m.date); d.appendChild(sp); frag.appendChild(d);
      }
      const row = document.createElement('div');
      row.className = 'msg' + (m.system ? ' system' : (me && m.sender === me ? ' me' : ''));
      const b = document.createElement('div'); b.className = 'bubble';
      if (evidence) { const n = document.createElement('span'); n.className = 'num'; n.textContent = '#' + String(m.id).padStart(numWidth, '0'); b.appendChild(n); }
      if (!m.system && m.sender && !(me && m.sender === me && els.style.value !== 'plain')) { const s = document.createElement('span'); s.className = 'sender'; s.textContent = m.sender; b.appendChild(s); }
      if (evidence && !m.system && me && m.sender === me) { const s = document.createElement('span'); s.className = 'sender'; s.textContent = m.sender; b.appendChild(s); }
      for (const a of m.attachments) {
        const entry = state.media.get(a);
        if (embed && entry && /\.(jpe?g|png|gif|webp)$/i.test(a)) {
          const img = document.createElement('img'); img.alt = a; img.loading = 'eager'; b.appendChild(img);
          urlPromises.push(objectUrl(a, entry).then(u => { img.src = u; }));
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

    return { frag, urlPromises };
  }

  // Everything the header/rows need for the current filters + tier.
  function docContext() {
    const p = state.parsed;
    const all = currentMessages();
    const limited = !state.pro && all.length > CONFIG.FREE_LIMIT;
    const displayMsgs = limited ? all.slice(0, CONFIG.FREE_LIMIT) : all;
    return {
      all, limited, displayMsgs, senders: p.senders,
      me: els.me.value,
      evidence: state.pro && els.evidence.checked,
      embed: state.pro && els.media.checked && state.media.size > 0,
      title: els.title.value || 'WhatsApp chat',
      numWidth: String(displayMsgs.length).length,
      hiddenCount: limited ? all.length - displayMsgs.length : 0,
    };
  }

  // Render one on-screen chunk. Chunk 0 replaces the document (header + first rows); later chunks append.
  function renderChunk(chunkIndex) {
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
    frag.appendChild(messageRows(displayMsgs.slice(chunkStart, chunkEnd), { ...ctx, tailMarkerCount: hasMore ? 0 : ctx.hiddenCount }).frag);
    if (chunkIndex === 0) els.doc.replaceChildren(frag); else els.doc.appendChild(frag);

    state.chunkIndex = chunkIndex;
    els.loadMoreControls.hidden = !hasMore;
    if (hasMore) els.loadStatus.textContent = `Showing ${chunkEnd.toLocaleString()} of ${displayMsgs.length.toLocaleString()} messages`;
  }

  function render() { renderChunk(0); }

  // Re-render chunks 0..upTo (used to restore the screen after printing).
  function renderChunksUpTo(upTo) {
    if (!state.parsed) return;
    const total = docContext().displayMsgs.length;
    renderChunk(0);
    for (let i = 1; i <= upTo && i * CHUNK_SIZE < total; i++) renderChunk(i);
  }

  // Full document for printing: header + every displayable row + free-tier tail marker.
  function buildFullDocument() {
    if (!state.parsed) return null;
    const ctx = docContext();
    const frag = document.createDocumentFragment();
    frag.appendChild(docHeader(ctx));
    state.lastDay = '';
    const { frag: rows, urlPromises } = messageRows(ctx.displayMsgs, { ...ctx, tailMarkerCount: ctx.hiddenCount });
    frag.appendChild(rows);
    return { frag, urlPromises };
  }

  function showFullDocument() {
    const result = buildFullDocument(); if (!result) return null;
    els.doc.replaceChildren(result.frag);
    els.loadMoreControls.hidden = true;
    return result;
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
    const blob = await entry.async('blob');
    const u = URL.createObjectURL(blob); state.mediaUrls.set(name, u); return u;
  }
  function setPaper(p) {
    let st = document.getElementById('paper-style');
    if (!st) { st = document.createElement('style'); st.id = 'paper-style'; document.head.appendChild(st); }
    st.textContent = `@page { size: ${p === 'letter' ? 'letter' : 'A4'}; }`;
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
  function fmtDate(d) { return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }
  function fmtDay(d) { return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function fmtDateTime(d, secs) { return d ? `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}${secs ? ':' + pad(d.getSeconds()) : ''}` : ''; }

  // ---------- Print handling ----------
  // Ctrl+P / File > Print: swap in the full document synchronously, restore the chunked view afterwards.
  let printedViaShortcut = false;
  window.addEventListener('beforeprint', () => {
    if (printingFull || !state.parsed) return;
    if (els.doc.querySelectorAll('.msg').length < docContext().displayMsgs.length) { printedViaShortcut = true; showFullDocument(); }
  });
  window.addEventListener('afterprint', () => {
    if (printingFull || !printedViaShortcut) return;
    printedViaShortcut = false;
    renderChunksUpTo(state.chunkIndex);
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

  // ---------- PDF export: full render off-DOM, wait for images, print, restore chunked view ----------
  async function exportPdf() {
    if (!state.parsed) return;
    const savedChunk = state.chunkIndex;
    printingFull = true;
    els.export.disabled = true; els.export.textContent = 'Preparing PDF…';
    try {
      const result = showFullDocument(); if (!result) return;
      await Promise.all(result.urlPromises);
      await Promise.allSettled(Array.from(els.doc.querySelectorAll('img')).map(img => img.decode ? img.decode() : Promise.resolve()));
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));  // let layout settle
      const done = new Promise(r => window.addEventListener('afterprint', r, { once: true }));
      window.print();
      await done;
    } finally {
      printingFull = false;
      renderChunksUpTo(savedChunk);
      els.export.disabled = false; els.export.textContent = 'Save as PDF';
    }
  }

  // ---------- Wiring ----------
  ['title', 'me', 'from', 'to', 'search', 'paper', 'size', 'style', 'media', 'evidence'].forEach(k => els[k].addEventListener(k === 'search' || k === 'title' ? 'input' : 'change', debounce(render, 150)));
  els.order.addEventListener('change', parseAndShow);
  els.export.addEventListener('click', exportPdf);
  els.reset.addEventListener('click', () => { resetMedia(); state.parsed = null; state.rawText = ''; els.file.value = ''; els.title.value = ''; els.from.value = ''; els.to.value = ''; els.search.value = ''; els.app.hidden = true; els.hero.hidden = false; });
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  loadLicense();
})();
