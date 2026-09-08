# WhatsApp Chat → PDF

Convert a WhatsApp "Export chat" file (`.txt` or `.zip` with media) into a clean, printable PDF — entirely in the browser. Nothing is uploaded; there is no server.

**Live:** https://jbarca.github.io/whatsapp-chat-to-pdf/

## Features
- iPhone and Android exports, any language; 12/24-hour times; day-first, month-first or year-first dates (auto-detected, overridable)
- Chat-bubble or plain-transcript layout, "I am …" alignment, date-range and keyword filters, A4/Letter
- Large-chat PDF preparation in cancellable batches, with progress, a separate print document, and photos sized for printing
- **Pro (one-time unlock):** unlimited messages, no watermark, embedded photos from a `.zip`, and *Evidence mode* — sequential message numbers, timestamps to the second, cover page with participants, date range and SHA-256 of the source, running page headers and numbers

## Privacy
The page is static HTML/JS on GitHub Pages. Parsing happens in `parser.js`, rendering in `app.js`, and PDF creation uses the browser's own print-to-PDF. The only outbound request the page can make is the license check to Gumroad's public license API when you activate Pro, which sends the license key only.

## Development
```bash
node test/parser.test.mjs   # Node 18+
python3 -m http.server 8080  # then open http://localhost:8080
```
No build step, no dependencies beyond JSZip from a CDN for `.zip` support.

Browser export regression tests (Node 22+, installed Chrome):
```bash
npm install --no-save --package-lock=false playwright jszip pdfjs-dist
node test/pdf-export.test.mjs
PDF_TEST_MESSAGES=30000 node test/pdf-export.test.mjs  # full PDF stress test
```
These are development dependencies only. Tests use synthetic chats, verify every message in actual PDFs, and check filters, evidence mode, photos, cancellation and print recovery. PDFs and screenshots are written to a temporary directory.

## License
Source is MIT. The hosted Pro unlock is a paid license for the hosted service.
