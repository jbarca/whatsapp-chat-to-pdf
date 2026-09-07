# Launch posts (copy-paste)

Replace LINK with https://jbarca.github.io/whatsapp-chat-to-pdf/

---
## r/whatsapp — title
I built a free WhatsApp chat → PDF converter that runs entirely in your browser (nothing gets uploaded)

## r/whatsapp — body
Every "WhatsApp to PDF" site I found wants you to upload your entire chat to their server, which felt insane for something that personal. So I made one that doesn't.

LINK

- Drop the .txt or .zip from *Export chat* → get a clean PDF with chat bubbles, day dividers, and your messages on the right
- Works with iPhone and Android exports, 12h/24h, any date format (auto-detects day/month order)
- Filter by date range or keyword, A4 or Letter
- Zero uploads: it's a static page, you can watch the Network tab and see nothing leave. Source is on GitHub.

Free for up to 100 messages. There's a one-time Pro unlock for unlimited messages + an "evidence mode" (numbered messages, seconds, SHA-256 of the original file on a cover page) because a surprising number of people need these for HR, court or insurance and get told to "just print the chat".

Happy to fix any export format that doesn't parse — paste the first two lines (dates only) and I'll sort it.

---
## Show HN — title
Show HN: WhatsApp chat to PDF, parsed entirely client-side (no uploads)

## Show HN — body (first comment)
Static page, no backend. Parsing (~150 lines, handles iOS/Android/locale date variants) and rendering are plain JS; the PDF comes from the browser's own print-to-PDF so there's no PDF library to trust with your data. Photos from a .zip export are read with JSZip and embedded as object URLs.

The interesting part was date-order detection: exports are locale-dependent and "03/04/26" is ambiguous, so it looks for any day > 12 and falls back to checking which interpretation keeps timestamps monotonic.

Free tier is capped at 100 messages; Pro is a one-time Gumroad license verified against their public license API from the browser, so still no server of mine ever sees a chat.

LINK · source: https://github.com/jbarca/whatsapp-chat-to-pdf

---
## r/privacy — title
Made a WhatsApp export → PDF tool that never uploads your chat (static page, verifiable in the Network tab)

---
## Reply template for "how do I print/export a WhatsApp chat for court/HR" threads
Export the chat from WhatsApp (chat → name/⋮ → Export chat, choose with or without media), then drop the file into LINK — it converts it to a PDF in your browser without uploading anything, and its evidence mode numbers every message, keeps the exact timestamps and puts a SHA-256 of the original file on the cover so you can show the PDF matches the export. Keep the original export file too; that's what a lawyer will ask for.

---
## Tweet / X
Needed to turn a WhatsApp chat into a PDF and every site wanted me to upload it first. So I built one that runs 100% in the browser — nothing leaves your device. iPhone + Android exports, photos, evidence mode for HR/court. LINK

---
## Product Hunt
Tagline: Turn WhatsApp exports into PDFs — privately, in your browser
