# whatsapp-chat-to-pdf — project notes

Static site, no build. `index.html` + `styles.css` + `parser.js` (UMD, browser + Node) + `app.js` + `pdf-worker.js` + vendored PDF dependencies.
Pro unlock = Gumroad license key verified client-side (`api.gumroad.com/v2/licenses/verify`, CORS `*` confirmed 2026-09-07). Config block at top of `app.js`.

## Rendering model (app.js, 2026-09-08)
- Screen shows `CHUNK_SIZE` (250) messages per chunk; `renderChunk(i)` (0 replaces, >0 appends), `render()` = chunk 0. `#load-more`/`#load-all` buttons in `#load-more-controls`. Day separators continue across chunks via `state.lastDay`.
- Shared builders: `docContext()` (filters/tier → ctx), `docHeader(ctx)`, `messageRows(msgs, ctx)`. Each context owns its day cursor; the preview saves it in `state.lastDay`. Never duplicate the row loop. Reuse the cached `Intl.DateTimeFormat` instances.
- Save: `exportPdf()` flushes edits and sends the filtered/tier-limited snapshot to `pdf-worker.js`. It creates a PDF with vendored jsPDF + Noto Sans, then downloads a Blob directly. Never call `window.print()` on this path: Edge's large-document print preview can hang. The worker handles layout/serialization, requests ZIP images one at a time, resizes/deduplicates photos, and reports progress. Cancel terminates the worker immediately. The retained download URL is revoked on a new export/edit/file/reset.
- Unicode: vector text uses Noto Sans; unsupported/complex-script lines use OffscreenCanvas plus an invisible CID/ToUnicode text layer. Keep extraction and visual tests when changing this or upgrading jsPDF (pinned internal font hook). All font/code assets are local to the site; no transcript data is sent remotely.
- Print: `printChat()` is the separate Print button/Ctrl/Cmd+P path. It builds hidden `#print-doc` in batches, then invokes `window.print()`. Browser-menu `beforeprint` builds full text synchronously; `afterprint` cleans up. Preview nodes/cursor stay intact. Free-tier limits and tail markers apply to both download and print.
- Large synthetic export for perf tests: scratchpad `gen-large.js` → `large-export.txt` (30k msgs), not committed.

## Commands
- Tests: `~/.nvm/versions/node/v26.8.1/bin/node test/parser.test.mjs` (default `node` is v14 and fails on `node:assert/strict`).
- PDF regression: `node test/pdf-export.test.mjs` with Node 22+, Chrome, and development packages `playwright`, `jszip`, `pdfjs-dist`. Set `PDF_TEST_MESSAGES=30000` for a stress test that reads back every message from the PDF. Artifacts go to the OS temporary directory; no real chat data is used.
- Direct download regression: `node test/pdf-download.test.mjs` defaults to installed Edge; `PDF_BROWSER=chrome` selects Chrome. `PDF_TEST_MESSAGES=30000` checks every message in the actual downloaded file, without `page.pdf()` or a print prompt.
- Local: `python3 -m http.server 8080 --bind 127.0.0.1`; `?sample=1` loads `test/sample-ios.txt`.
- Headless smoke test: Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with `--headless=new --virtual-time-budget=8000 --dump-dom|--print-to-pdf=|--screenshot=`. Pro path: temporary harness page that seeds `localStorage['wa2pdf.license']={key,ok:true}` (see session 2026-09-07; harness is not committed).
- Verified 2026-09-07: free = 100 msgs + watermark (8-page PDF for sample); Pro evidence mode = all 351 numbered + SHA-256 cover (40 pages).

## Safe mode (client-side scanning: safe-worker.js + safe-policy.js + safe-scheduler.js)
- Cache-buster (2026-09-12): `safe-worker.js` (`importScripts`), `index.html`'s
  `<script src="safe-policy.js">`, and `app.js`'s `new Worker(...)` all carry a manual
  `?v=` cache-buster (currently `1.2.0`) matching `SafePolicy.VERSION` in `safe-policy.js`.
  Bump all four literals together whenever `safe-policy.js`/`safe-scheduler.js` changes —
  Chrome caches Worker scripts and their `importScripts` far more aggressively than normal
  page assets, so without this a client can end up running a new `safe-worker.js` against a
  stale `safe-policy.js` (symptom seen: "Safe mode failed: isScannable is not a function"
  even though the checked-out file defines it). `VERSION` also feeds the model score-cache
  epoch, so it must bump whenever scoring behaviour changes even without a script edit.
  Diagnose stale-cache reports first with `~/.nvm/versions/node/v26.8.1/bin/node -e "require('./safe-policy.js').isScannable"`
  before assuming the code is broken — if it resolves, the
  bug is stale browser/worker cache, not source.
- Test suite exists (don't assume it's untested): `test/safe-policy.test.cjs`,
  `test/safe-scheduler.test.cjs` (both via `~/.nvm/versions/node/v26.8.1/bin/node`), `test/safe-mode.test.mjs` (Playwright:
  fake-worker UI test + a real-worker rules-only page). Plus two gated harnesses not run by
  default: `test/safe-parity.mjs` (`SAFE_PARITY=1`) and `test/safe-recall.mjs`
  (`SAFE_RECALL_EVAL=1`, `SAFE_RECALL_WRITE=1` to re-record) — a 1.2M-token corpus + recorded
  MNLI reference (`safe-eval-reference.json`) used to gate the (currently unshipped) Stage 5
  cascade prefilter. Needs a HuggingFace model download; don't trigger blind/automatically.
  Re-record the reference whenever scored labels change (e.g. dropping/adding an MNLI label).
- Architecture (as of 2026-09-13 optimization pass): rule-based findings in `safe-policy.js`
  (`ruleFindingsNormalized`, one precompiled alternation regex per category + memo, not
  per-word `String.includes`); English detection in `safe-scheduler.js`'s `preprocess` is a
  memoised lazy `.english` getter (only pays for `isEnglish` on groups actually read).
  `safe-worker.js`: `abuse` is scored only by the multilingual toxicity pipeline, not
  duplicated in MNLI labels (toxicity covers all languages, MNLI is English-only); image
  batches decode concurrently (`Promise.all`); text-only score cache bounded by both entry
  count (200k) and total chars (`MAX_CACHE_CHARS` 8M) with epoch invalidation via
  `syncCacheEpoch()`; queued re-scans go through an extracted `startRun(data)`, not
  `postMessage` (a prior bug posted the queued run to the worker's own outbound channel,
  silently dropping it and hanging the UI in "scanning").
- Known gaps / follow-ups: Stage 5 cascade prefilter (single-hypothesis generic MNLI pass before per-category scoring) was measured and REJECTED on 2026-09-13 — a pessimization, not a win. Cost/group = passRate × labels + 1; break-even is passRate 0.75 (0.80 for 5 labels). MobileBERT-MNLI at THRESHOLDS.text 0.3 already flags >=1 label on 63.7% of groups, so optimal prefilter can only reach 4.19 vs 5.00 on the 5-label harness. Four candidate generic hypotheses swept the full corpus: the cheapest holding >=99.5% recall on every category needs bar <=0.15 and passes 96% (cost 5.80 vs 5.00). Crime recall collapses fastest; cheaper variants fail at 78-93%. `test/safe-eval-reference.json` was re-recorded 2026-09-13 against current 4-label code (5085 English groups, full run, complete:true, threshold 0.3) and is now valid. Images have no score cache at all (text-only) — re-scans re-decode/re-infer every
  attachment; needs a stable cache key since filenames aren't reliable across files.
  `mnliScores`' batched path hardcodes `max_length: 128`; the non-batched fallback path uses
  the pipeline default, so long messages can score differently between the two paths.

## Gotchas
- `[hidden]{display:none!important}` is required because `.app{display:grid}` otherwise overrides the attribute.
- Auto-mode classifier blocks `gh repo create` (publishing); user must run it (commands in MANUAL_STEPS.md).
- Status/next steps: `MANUAL_STEPS.md`; launch copy: `launch/POSTS.md`.

## Distribution research (2026-09-07)
- `launch/REPLIES.md`: 20 verified threads with per-thread replies, best-first; link-free versions for legal subs.
- Reddit blocks this machine's IP for `.json`/HTML fetches (403 "Blocked") even via headless Chrome; Firecrawl `scrape` refuses most reddit URLs ("do not support this site") but `firecrawl_search` with `site:reddit.com` + exact title works for existence checks and snippets often carry "Nmo ago". Quora also 403s curl.
- Reddit post-ID → date anchors: 1htz3bp≈Jan 2025, 1odwqyo≈Sep 2025, 1tc5y2f≈May 2026, 1vgdtox≈Aug 2026, 1w8tf25≈Sep 2026.
