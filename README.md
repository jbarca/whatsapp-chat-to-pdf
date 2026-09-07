# WhatsApp Chat → PDF

Convert a WhatsApp "Export chat" file (`.txt` or `.zip` with media) into a clean, printable PDF — entirely in the browser. Nothing is uploaded; there is no server.

**Live:** https://jbarca.github.io/whatsapp-chat-to-pdf/

## Features
- iPhone and Android exports, any language; 12/24-hour times; day-first, month-first or year-first dates (auto-detected, overridable)
- Chat-bubble or plain-transcript layout, "I am …" alignment, date-range and keyword filters, A4/Letter
- **Pro (one-time unlock):** unlimited messages, no watermark, embedded photos from a `.zip`, and *Evidence mode* — sequential message numbers, timestamps to the second, cover page with participants, date range and SHA-256 of the source, running page headers and numbers

## Privacy
The page is static HTML/JS on GitHub Pages. Parsing happens in `parser.js`, rendering in `app.js`, and PDF creation uses the browser's own print-to-PDF. The only outbound request the page can make is the license check to Gumroad's public license API when you activate Pro, which sends the license key only.

## Development
```bash
node test/parser.test.mjs   # Node 18+
python3 -m http.server 8080  # then open http://localhost:8080
```
No build step, no dependencies beyond JSZip from a CDN for `.zip` support.

## License
Source is MIT. The hosted Pro unlock is a paid license for the hosted service.
