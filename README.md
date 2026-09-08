# WhatsApp Chat → PDF

Convert a WhatsApp "Export chat" file (`.txt` or `.zip` with media) into a clean, printable PDF — entirely in the browser. Nothing is uploaded; there is no server.

**Live:** https://jbarca.github.io/whatsapp-chat-to-pdf/

## Features
- iPhone and Android exports, any language; 12/24-hour times; day-first, month-first or year-first dates (auto-detected, overridable)
- Chat-bubble or plain-transcript layout, "I am …" alignment, date-range and keyword filters, A4/Letter
- Direct PDF downloads in a cancellable background worker, with progress and photos sized for printing; no browser print prompt is needed
- **Pro (one-time unlock):** unlimited messages, no watermark, embedded photos, Evidence mode, and on-device Safe Mode screening with review-before-export

## Privacy
The page is static HTML/JS on GitHub Pages. Parsing happens in `parser.js`, preview rendering in `app.js`, and direct PDF creation in `pdf-worker.js`. PDF code, Safe Mode runtime, and fonts are served with the site; messages and photos never leave the device. Safe Mode downloads only pinned model assets using GET requests and caches them in the browser. ZIP support loads JSZip from a CDN. Activating Pro sends only the license key to Gumroad's public license API.

**Save as PDF** downloads a file directly. A download link remains available if automatic downloading is blocked. **Print…** and Ctrl/Cmd+P retain browser printing. Direct PDFs use embedded text; complex scripts and emoji use browser-rendered line images with a searchable Unicode text layer. Pagination can differ from the browser print layout.

## Development
```bash
node test/parser.test.mjs   # Node 18+
python3 -m http.server 8080  # then open http://localhost:8080
```
No build step. JSZip loads from a CDN for `.zip` support; the PDF worker uses vendored jsPDF and Noto Sans (versions and licenses in `vendor/`).

Browser export regression tests (Node 22+, installed Edge and/or Chrome):
```bash
npm install --no-save --package-lock=false playwright jszip pdfjs-dist
node test/pdf-export.test.mjs
node test/pdf-download.test.mjs  # actual downloads in Edge
PDF_BROWSER=chrome node test/pdf-download.test.mjs
PDF_TEST_MESSAGES=30000 node test/pdf-download.test.mjs  # full download stress test
```
These are development dependencies only. Tests use synthetic chats, verify every message in actual PDFs, and check filters, evidence mode, photos, cancellation and print recovery. PDFs and screenshots are written to a temporary directory.

## License
Source is MIT. The hosted Pro unlock is a paid license for the hosted service.
