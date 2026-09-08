# whatsapp-chat-to-pdf — project notes

Static site, no build. `index.html` + `styles.css` + `parser.js` (UMD, browser + Node) + `app.js`.
Pro unlock = Gumroad license key verified client-side (`api.gumroad.com/v2/licenses/verify`, CORS `*` confirmed 2026-09-07). Config block at top of `app.js`.

## Rendering model (app.js, 2026-09-08)
- Screen shows `CHUNK_SIZE` (250) messages per chunk; `renderChunk(i)` (0 replaces, >0 appends), `render()` = chunk 0. `#load-more`/`#load-all` buttons in `#load-more-controls`. Day separators continue across chunks via `state.lastDay`.
- Shared builders: `docContext()` (filters/tier → ctx), `docHeader(ctx)`, `messageRows(msgs, ctx)`. Each context owns its day cursor; the preview saves it in `state.lastDay`. Never duplicate the row loop. Reuse the cached `Intl.DateTimeFormat` instances.
- Print: `exportPdf()` flushes pending option edits, builds hidden `#print-doc` in 250-message batches with progress/cancellation, waits for bounded image processing and fonts, then calls `window.print()`. The preview nodes and chunk cursor stay intact. Print CSS uses block layout without bubble shadows. Photos larger than their print resolution are resized; print-only object URLs are revoked on cleanup. Unreadable photos retain labelled placeholders.
- Ctrl/Cmd+P uses asynchronous export; browser-menu `beforeprint` builds the full text synchronously if needed. `afterprint` removes the print document; export controls recover without awaiting that event (some browsers omit it). A subsequent edit/export also removes any retained print document. Free-tier limits and tail markers apply to both preview and PDF.
- Large synthetic export for perf tests: scratchpad `gen-large.js` → `large-export.txt` (30k msgs), not committed.

## Commands
- Tests: `~/.nvm/versions/node/v26.8.1/bin/node test/parser.test.mjs` (default `node` is v14 and fails on `node:assert/strict`).
- PDF regression: `node test/pdf-export.test.mjs` with Node 22+, Chrome, and development packages `playwright`, `jszip`, `pdfjs-dist`. Set `PDF_TEST_MESSAGES=30000` for a stress test that reads back every message from the PDF. Artifacts go to the OS temporary directory; no real chat data is used.
- Local: `python3 -m http.server 8080 --bind 127.0.0.1`; `?sample=1` loads `test/sample-ios.txt`.
- Headless smoke test: Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with `--headless=new --virtual-time-budget=8000 --dump-dom|--print-to-pdf=|--screenshot=`. Pro path: temporary harness page that seeds `localStorage['wa2pdf.license']={key,ok:true}` (see session 2026-09-07; harness is not committed).
- Verified 2026-09-07: free = 100 msgs + watermark (8-page PDF for sample); Pro evidence mode = all 351 numbered + SHA-256 cover (40 pages).

## Gotchas
- `[hidden]{display:none!important}` is required because `.app{display:grid}` otherwise overrides the attribute.
- Auto-mode classifier blocks `gh repo create` (publishing); user must run it (commands in MANUAL_STEPS.md).
- Status/next steps: `MANUAL_STEPS.md`; launch copy: `launch/POSTS.md`.

## Distribution research (2026-09-07)
- `launch/REPLIES.md`: 20 verified threads with per-thread replies, best-first; link-free versions for legal subs.
- Reddit blocks this machine's IP for `.json`/HTML fetches (403 "Blocked") even via headless Chrome; Firecrawl `scrape` refuses most reddit URLs ("do not support this site") but `firecrawl_search` with `site:reddit.com` + exact title works for existence checks and snippets often carry "Nmo ago". Quora also 403s curl.
- Reddit post-ID → date anchors: 1htz3bp≈Jan 2025, 1odwqyo≈Sep 2025, 1tc5y2f≈May 2026, 1vgdtox≈Aug 2026, 1w8tf25≈Sep 2026.
