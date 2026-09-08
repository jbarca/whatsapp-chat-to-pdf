# whatsapp-chat-to-pdf — project notes

Static site, no build. `index.html` + `styles.css` + `parser.js` (UMD, browser + Node) + `app.js`.
Pro unlock = Gumroad license key verified client-side (`api.gumroad.com/v2/licenses/verify`, CORS `*` confirmed 2026-09-07). Config block at top of `app.js`.

## Rendering model (app.js, 2026-09-08)
- Screen shows `CHUNK_SIZE` (250) messages per chunk; `renderChunk(i)` (0 replaces, >0 appends), `render()` = chunk 0. `#load-more`/`#load-all` buttons in `#load-more-controls`. Day separators continue across chunks via `state.lastDay`.
- Shared builders: `docContext()` (filters/tier → ctx), `docHeader(ctx)`, `messageRows(msgs, ctx)`; `buildFullDocument()`/`showFullDocument()` render everything for print. Never duplicate the row loop.
- Print: `exportPdf()` (button) swaps in the full doc, awaits object URLs + `img.decode()`, `window.print()`, restores chunks via `renderChunksUpTo()`. `beforeprint` handles Ctrl+P the same way synchronously (`printingFull` guard prevents double handling). Free-tier tail marker ("… N more messages in the full version") appears after the last on-screen chunk and in the PDF.
- Large synthetic export for perf tests: scratchpad `gen-large.js` → `large-export.txt` (30k msgs), not committed.

## Commands
- Tests: `~/.nvm/versions/node/v26.8.1/bin/node test/parser.test.mjs` (default `node` is v14 and fails on `node:assert/strict`).
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
