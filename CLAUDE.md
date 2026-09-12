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

## Safe mode asset caching (2026-09-12)
- `safe-worker.js` (`importScripts`), `index.html`'s `<script src="safe-policy.js">`, and
  `app.js`'s `new Worker(...)` all carry a manual `?v=1.1.0` cache-buster matching
  `SafePolicy.VERSION` in `safe-policy.js`. Bump all three literals together whenever
  `safe-policy.js`/`safe-scheduler.js` changes — Chrome caches Worker scripts and their
  `importScripts` far more aggressively than normal page assets, so without this a client
  can end up running a new `safe-worker.js` against a stale `safe-policy.js` (symptom seen:
  "Safe mode failed: isScannable is not a function" even though the checked-out file defines
  it). Diagnose this class of report first with `node -e "require('./safe-policy.js').isScannable"`
  (fast: not `~/.nvm/.../node`, that's only needed for the `assert/strict` test files) before
  assuming the code is broken — if it resolves, the bug is stale browser/worker cache, not source.

## Gotchas
- `[hidden]{display:none!important}` is required because `.app{display:grid}` otherwise overrides the attribute.
- Auto-mode classifier blocks `gh repo create` (publishing); user must run it (commands in MANUAL_STEPS.md).
- Status/next steps: `MANUAL_STEPS.md`; launch copy: `launch/POSTS.md`.

## Distribution research (2026-09-07)
- `launch/REPLIES.md`: 20 verified threads with per-thread replies, best-first; link-free versions for legal subs.
- Reddit blocks this machine's IP for `.json`/HTML fetches (403 "Blocked") even via headless Chrome; Firecrawl `scrape` refuses most reddit URLs ("do not support this site") but `firecrawl_search` with `site:reddit.com` + exact title works for existence checks and snippets often carry "Nmo ago". Quora also 403s curl.
- Reddit post-ID → date anchors: 1htz3bp≈Jan 2025, 1odwqyo≈Sep 2025, 1tc5y2f≈May 2026, 1vgdtox≈Aug 2026, 1w8tf25≈Sep 2026.
