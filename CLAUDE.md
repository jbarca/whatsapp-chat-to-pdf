# whatsapp-chat-to-pdf — project notes

Static site, no build. `index.html` + `styles.css` + `parser.js` (UMD, browser + Node) + `app.js`.
Pro unlock = Gumroad license key verified client-side (`api.gumroad.com/v2/licenses/verify`, CORS `*` confirmed 2026-09-07). Config block at top of `app.js`.

## Commands
- Tests: `~/.nvm/versions/node/v26.8.1/bin/node test/parser.test.mjs` (default `node` is v14 and fails on `node:assert/strict`).
- Local: `python3 -m http.server 8080 --bind 127.0.0.1`; `?sample=1` loads `test/sample-ios.txt`.
- Headless smoke test: Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with `--headless=new --virtual-time-budget=8000 --dump-dom|--print-to-pdf=|--screenshot=`. Pro path: temporary harness page that seeds `localStorage['wa2pdf.license']={key,ok:true}` (see session 2026-09-07; harness is not committed).
- Verified 2026-09-07: free = 100 msgs + watermark (8-page PDF for sample); Pro evidence mode = all 351 numbered + SHA-256 cover (40 pages).

## Gotchas
- `[hidden]{display:none!important}` is required because `.app{display:grid}` otherwise overrides the attribute.
- Auto-mode classifier blocks `gh repo create` (publishing); user must run it (commands in MANUAL_STEPS.md).
- Status/next steps: `MANUAL_STEPS.md`; launch copy: `launch/POSTS.md`.
