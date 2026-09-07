# Reply targets — "how do I export / print a WhatsApp chat" threads

Tool: https://jbarca.github.io/whatsapp-chat-to-pdf/  ·  Source: https://github.com/jbarca/whatsapp-chat-to-pdf
Every thread below was checked to exist on 2026-09-07. Dates are estimated from Reddit post IDs
(±1 month) unless marked "confirmed". Reddit no longer archives threads by default, so old threads
usually still accept comments, but only the 2026 ones will get eyeballs. Post best-first.

## Posting etiquette
- 1–2 replies per hour, from your own account, spaced across the day. Reddit shadow-filters accounts
  that drop the same domain repeatedly in a short burst.
- Answer the actual question first. The tool is the last 1–2 sentences.
- Say "I built" every time. Undisclosed self-promo gets removed and reported.
- r/legaladvice, r/legaladvicecanada and r/LegalAdviceUK remove links/advertising. Use the
  link-free versions there. If someone asks "which tool?", answer in a reply with the link.
- Never say "upload". The whole pitch is that nothing leaves the browser.
- Come back and answer follow-ups within a day. Replies with a conversation under them rank higher.
- Don't post in the r/summerprogramresults "WaMorePDF" spam thread or similar.

Facts you can state safely (all in WhatsApp's own help centre):
- iPhone: open chat → tap the contact/group name → scroll down → Export Chat → Attach Media / Without Media.
- Android: open chat → ⋮ → More → Export chat → Include media / Without media.
- WhatsApp exports at most the most recent 40,000 messages without media, or 10,000 with media.
- Export produces a .txt (or a .zip with the .txt plus media). WhatsApp Web/Desktop cannot export.

---

## 1. r/SingleParents — "Need Advice on Preserving Evidence for Family Court (Father Seeking Custody)"
URL: https://www.reddit.com/r/SingleParents/comments/1vgdtox/need_advice_on_preserving_evidence_for_family/
Date: ~Aug 2026 · Open: yes · Asked: father in a custody case wants to know how to preserve messages as evidence.
Link OK: yes (parenting sub, no anti-link rule seen; keep it low-key).

> Not a lawyer, so treat this as practical rather than legal advice. The two things that
> matter most are (1) keep the originals and (2) don't cherry-pick. Screenshots get challenged
> because they're easy to edit and they don't show what came before or after. Use WhatsApp's own
> Export Chat instead (open the chat → tap her name at the top → Export Chat → "Without Media" for
> a quick text copy, "Attach Media" if photos matter). Save that file somewhere you won't lose it,
> keep the phone, and don't delete anything. Your lawyer will usually want the export plus a short
> statement from you that it's unaltered.
>
> For the readable version to hand over, I built a small in-browser converter that turns that
> export into a PDF with every message numbered, exact timestamps, and a hash of the original file
> on the cover so you can show the PDF matches the export. Nothing gets uploaded; it runs entirely
> on your device: https://jbarca.github.io/whatsapp-chat-to-pdf/ (free for short chats).

## 2. r/whatsapp — "WhatsApp is terrible and cruel"
URL: https://www.reddit.com/r/whatsapp/comments/1vytwfe/whatsapp_is_terrible_and_cruel/
Date: ~Aug 2026 · Open: yes · Context: complaint thread; a top comment already says "many exporters make a PDF with bubbles, pictures, reactions". Reply under that comment.
Link OK: yes (r/whatsapp allows tools).

> Adding to this since it's the part most people miss: the built-in Export Chat is the only
> official way out, and it caps at the most recent 40k messages (10k with media), so anyone with a
> very long chat should export now rather than later. The .txt it gives you is ugly but it's
> complete and it's what any tool works from.
>
> I built one of those converters after needing a court-friendly copy of a chat: drop the .txt or
> .zip in and it renders a PDF in the browser, photos included if you exported with media.
> No account, no upload, source is on GitHub. https://jbarca.github.io/whatsapp-chat-to-pdf/

## 3. r/FamilyLaw — "How do you present text messages as evidence in court?" (California)
URL: https://www.reddit.com/r/FamilyLaw/comments/1tc5y2f/how_do_you_present_text_messages_as_evidence_in/
Date: ~May 2026 (search snippet says "4mo ago", confirmed) · Open: yes · Asked: has screenshots of husband's texts, wants to know how to present them.
Link OK: cautious. Use the link-free version; add the link only if asked.

> Not legal advice, but from what family lawyers generally ask for: the court cares about
> authenticity and completeness, not formatting. Screenshots can be admitted, but they're easy to
> attack ("what did you say before this?", "how do we know it wasn't edited?"). What holds up better
> is a full, continuous export of the thread with dates and both numbers, plus your declaration that
> it's a true copy, and keeping the phone available in case the other side disputes it. If any of
> it is on WhatsApp rather than SMS, use its Export Chat (chat → tap the name → Export Chat) rather
> than screenshots; it gives you a dated text file of everything. Then produce a clean, page-numbered
> PDF from that for the exhibit binder and number the messages so counsel can cite "message 412"
> instead of "the third screenshot". Ask your attorney how they want exhibits labelled before you
> print anything.
>
> (If asked which tool: "I built one that does exactly the numbering/hash part in the browser:
> https://jbarca.github.io/whatsapp-chat-to-pdf/ ")

## 4. r/FamilyLaw — "Abusive acts only caught through text messages. Strong or weak?"
URL: https://www.reddit.com/r/FamilyLaw/comments/1so0ui2/abusive_acts_only_caught_through_text_messages/
Date: ~Apr 2026 · Open: yes · Asked: whether texts alone are strong evidence.
Link OK: cautious (same as above).

> Texts can be strong, but only if they're presented as a complete, verifiable record. A judge who
> sees a handful of screenshots will wonder what was cut. A judge who sees the whole thread, in
> order, with timestamps, and a statement that it's unaltered, has much less to doubt. So: export
> the entire conversation (WhatsApp has Export Chat under the contact's name; iMessage needs a Mac
> or a desktop tool), keep the original file and the phone, and give your lawyer both the raw export
> and a tidy PDF with page numbers. Let them decide what to lead with. Not legal advice.

## 5. r/DataHoarder — "How do I back up 10+ years of WhatsApp chats in human-readable format?"
URL: https://www.reddit.com/r/DataHoarder/comments/1rq15jm/how_do_i_back_up_10_years_of_whatsapp_chats_in/
Date: ~Mar 2026 · Open: yes · Asked: keep old chats, images and videos readable long-term.
Link OK: yes (sub welcomes open-source tools; disclose).

> The 40k/10k export cap is the real enemy here, so export each long chat now before the oldest
> messages fall off the window, and export "Without Media" and "Attach Media" separately (the
> no-media one gets you 4× the message depth). Archive the raw .zip exports untouched: they're the
> canonical copy and any future tool can re-parse them. For the readable layer I'd keep a PDF per
> chat next to the zip.
>
> Disclosure, I built the converter I use for that: https://jbarca.github.io/whatsapp-chat-to-pdf/
> It's a static page, parses the export client-side, embeds the photos from the zip and prints to
> PDF via the browser. Code's on GitHub if you'd rather run it locally. Free for the first 100
> messages, one-off $5 for unlimited.

## 6. r/I130Suffering — "Efficient way to collect WhatsApp messages for Evidence"
URL: https://www.reddit.com/r/I130Suffering/comments/1qt0yr5/efficient_way_to_collect_whatsapp_messages_for/
Date: ~Jan 2026 · Open: yes · Asked: gathering WhatsApp history as I-130 bona-fide-relationship evidence.
Link OK: yes (small niche sub, practical tools welcomed).

> Don't screenshot months of chat, it's hundreds of images and USCIS wants a PDF anyway. Use
> WhatsApp's Export Chat on the conversation with your spouse (tap their name → Export Chat →
> "Without Media" for the main file; do a second "Attach Media" export if you want photos of you
> together in it). You get one .txt with every message dated. Most people then submit a sampled
> selection (first messages, a few pages per month, key events) plus a cover note saying the full
> log is available on request, so the packet doesn't balloon.
>
> I built a free in-browser tool for exactly this step: it turns that export into a paginated PDF
> with dates, both names, and the photos embedded, and you can filter by date range to pull out
> specific months. Nothing is uploaded. https://jbarca.github.io/whatsapp-chat-to-pdf/

## 7. r/whatsapp — "I built a free WhatsApp chat export viewer (no login, runs locally)"
URL: https://www.reddit.com/r/whatsapp/comments/1r1a969/i_built_a_free_whatsapp_chat_export_viewer_no/
Date: ~Feb 2026 · Open: yes · Context: another dev's viewer, 39 upvotes / 38 comments. Commenters here are exactly your users. Be collegial, not competitive.
Link OK: yes.

> Nice work, and agreed the raw .txt is unreadable past a few hundred lines. I went down the same
> road but ended up with a different output: I needed a PDF to give a lawyer, so mine renders the
> export as a printable document (bubbles, embedded photos from the zip, page numbers) with an
> optional "evidence" layout that numbers every message and puts a SHA-256 of the original export on
> a cover page. Same philosophy as yours: static page, nothing leaves the browser, source on GitHub.
> https://jbarca.github.io/whatsapp-chat-to-pdf/ if anyone in this thread needs the print side.

## 8. r/TenantsInTheUK — "Landlord threatened to evict me and call the police if I have guests (England)"
URL: https://www.reddit.com/r/TenantsInTheUK/comments/1oeqd2e/landlord_threatened_to_evict_me_and_call_the/
Date: ~Oct 2025 · Open: yes · Asked: landlord making threats over WhatsApp; what to do.
Link OK: yes, but keep it to one line.

> Whatever else you do, preserve the messages now, before he deletes his side or you change phones.
> Screenshots are fine as a backup but the stronger record is WhatsApp's own export: open the chat
> → ⋮ → More → Export chat → Without media. That gives you a dated transcript of the whole
> conversation, which is what Shelter, your council's tenancy relations officer, or a tribunal will
> actually want to read. Keep the original file and don't edit it.
>
> If you need it as a tidy, page-numbered PDF for a complaint, I built a browser-only converter
> (nothing uploaded): https://jbarca.github.io/whatsapp-chat-to-pdf/  Not legal advice; Shelter's
> helpline is free and very good on illegal eviction threats.

## 9. r/LegalAdviceUK — "Builder threatening me to small claims courts. Can I use WhatsApp backup messages as evidence? (Text not screenshot)"
URL: https://www.reddit.com/r/LegalAdviceUK/comments/1odwqyo/builder_threatening_me_to_small_claims_courts_can/
Date: ~Sep 2025 (confirmed "1y ago", 44 comments) · Open: yes.
Link OK: NO. Sub removes advertising. Link-free reply only.

> Yes. Small claims judges see WhatsApp threads all the time, and a full export is generally
> preferred to screenshots precisely because it's continuous and timestamped. Use the app's own
> Export chat (⋮ → More → Export chat → Without media) on the conversation with the builder, keep
> that file unaltered, and include a printed copy in your bundle with page numbers and a short
> witness statement saying it's a true export from your phone on [date]. If there are photos of
> the work in the chat, do a second export with media so they're captured too. Number the pages
> and, ideally, the messages so you can point the judge to "message 87" in your statement. Keep the
> phone; if he disputes anything the judge may want to see the original. Not legal advice.

## 10. r/SpouseVisaUk — "Whatsapp messages/call history"
URL: https://www.reddit.com/r/SpouseVisaUk/comments/1j5jyed/whatsapp_messagescall_history/
Date: ~Mar 2025 · Open: yes · Asked: how to include WhatsApp chat and call logs as relationship evidence for a UK spouse visa.
Link OK: yes (sub shares tools and templates routinely).

> UKVI wants PDFs uploaded, and caseworkers won't read thousands of pages, so the usual approach
> is: export the full chat once as proof it exists, then submit a sample (a few pages per month
> across the whole relationship, plus the dates around visits, engagement, wedding) with a cover
> sheet listing the date range and total message count. Get the export from WhatsApp itself (tap
> their name → Export Chat → Without Media), not screenshots; it includes the timestamps and both
> names on every line. Call history you'll have to screenshot from the Calls tab.
>
> I built a free in-browser converter that turns the export into a dated PDF and lets you filter
> to a date range before printing, which makes the monthly sampling quick. Nothing is uploaded
> anywhere. https://jbarca.github.io/whatsapp-chat-to-pdf/

## 11. r/whatsapp — "Can I save (download) an entire WhatsApp group chat?"
URL: https://www.reddit.com/r/whatsapp/comments/1htz3bp/can_i_save_download_an_entire_whatsapp_group_chat/
Date: ~Jan 2025 · Open: yes · Asked: leaving a years-long group and wants to keep it.
Link OK: yes.

> Yes, and do it before you leave the group, because after you leave you can still see history but
> can't export new messages. Open the group → tap the group name → scroll to Export Chat → choose
> Attach Media if you want the photos (this caps at the last 10,000 messages) or Without Media
> (last 40,000). You'll get a .zip or .txt you can email to yourself.
>
> That file is plain text and painful to read, so I built a page that turns it into a proper PDF
> with the bubbles and photos, all in the browser with nothing uploaded:
> https://jbarca.github.io/whatsapp-chat-to-pdf/  Free for short chats, a few dollars for a
> years-long group.

## 12. r/DataHoarder — "Full WhatsApp chat export (40000+ messages)"
URL: https://www.reddit.com/r/DataHoarder/comments/a7c0yq/full_whatsapp_chat_export_40000_messages/
Date: Dec 2018 · Open: likely (DataHoarder disabled archiving) but very old; it still ranks on Google for the query, which is why it's here.
Link OK: yes.

> For anyone landing here from Google in 2026: the cap is still 40,000 messages (10,000 with
> media) per export, and there's still no official way around it other than exporting regularly so
> the window never drops anything. Keep the raw .zip; it's the only lossless form. If you want a
> readable copy, I built a converter that renders the export to PDF locally in the browser (no
> upload, source on GitHub): https://jbarca.github.io/whatsapp-chat-to-pdf/

## 13. Quora — "What's the best way to save a huge amount of WhatsApp messages to use as legal evidence in a small claims court in the United States?"
URL: https://www.quora.com/Whats-the-best-way-to-save-a-huge-amount-of-WhatsApp-messages-to-use-as-legal-evidence-in-a-small-claims-court-in-the-United-States
Open: yes (Quora answers never close; ranks on Google for "whatsapp evidence small claims").
Link OK: yes. Quora tolerates one disclosed link in a substantive answer.

> Export it from WhatsApp itself rather than screenshotting. On iPhone: open the chat, tap the
> contact's name, scroll down, Export Chat, choose Without Media (or Attach Media if photos are part
> of the dispute). On Android: ⋮ → More → Export chat. You'll get a text file with every message,
> dated, which is far harder to challenge than a stack of screenshots because it's complete and in
> order.
>
> Then, for court:
> 1. Keep the original export file untouched, and keep the phone.
> 2. Print a paginated copy with numbered messages so you can cite specific lines.
> 3. Bring a short signed statement that it's a true and complete export.
> 4. Check your court's rules on exhibit formatting and how many copies to bring.
>
> I built a free tool that does step 2 in the browser without sending the chat anywhere; its
> evidence layout numbers every message and prints a SHA-256 hash of your export on the cover so
> you can show the printout matches the file: https://jbarca.github.io/whatsapp-chat-to-pdf/
> This is practical guidance, not legal advice.

## 14. Quora — "How do I export a WhatsApp chat in a PDF document, including the media, on WhatsApp Web?"
URL: https://www.quora.com/How-do-I-export-a-WhatsApp-chat-in-a-PDF-document-including-the-media-on-the-WhatsApp-web
Open: yes. Link OK: yes.

> You can't from WhatsApp Web; export only exists in the phone app. On the phone, open the chat,
> tap the name at the top, choose Export Chat, then Attach Media. WhatsApp produces a .zip
> containing a .txt of the messages and every photo/voice note/document as separate files (up to
> the most recent 10,000 messages). Send that zip to your computer.
>
> To turn the zip into one PDF with the photos in place, you need a converter. I built a free one
> that runs entirely in the browser (drop the zip in, it renders the chat with the images inline,
> then you save as PDF): https://jbarca.github.io/whatsapp-chat-to-pdf/  Nothing is uploaded,
> which matters if the chat is private. Works with iPhone and Android exports in any language.

## 15. Quora — "How can I print a WhatsApp chat as it appears on the phone?"
URL: https://www.quora.com/How-can-I-print-whatsapp-chat-as-it-appears-on-phone
Open: yes. Link OK: yes.

> Two steps. First get the chat out: open it, tap the contact or group name, Export Chat, pick
> Without Media (text only) or Attach Media. Email the result to yourself. Second, render it: the
> export is a plain text file, so printing it directly gives you a wall of text, not chat bubbles.
>
> I built a page that draws the export as WhatsApp-style bubbles with the date separators and the
> photos, then hands it to your browser's print dialog so you can save a PDF or print straight
> away: https://jbarca.github.io/whatsapp-chat-to-pdf/  It runs locally in the browser with nothing
> uploaded; free for chats under 100 messages.

## 16. Quora — "How can I convert a WhatsApp exported .txt file into a real chat?"
URL: https://www.quora.com/How-can-I-convert-a-WhatsApp-exported-txt-file-as-a-real-chat
Open: yes. Link OK: yes.

> The .txt is just one line per message: date, time, sender, text. Anything that "looks like a
> chat" has to parse those lines and draw bubbles. There are a few desktop tools, but the simplest
> route is a web page that does it in the browser. I built one: drop the .txt (or the .zip if you
> exported with media) onto https://jbarca.github.io/whatsapp-chat-to-pdf/ and it shows the chat
> as bubbles with dates and photos, searchable, and printable to PDF. It never uploads the file,
> so private chats stay private. Handles the iPhone and Android formats and 12/24-hour times
> automatically.

## 17. r/legaladvicecanada — "Can WhatsApp data be used as legal evidence? What about downloaded WhatsApp chats?"
URL: https://www.reddit.com/r/legaladvicecanada/comments/1bg0fqs/can_whatsapp_data_be_used_as_a_legal_evidence/
Date: Mar 2024 (confirmed old, 25 comments) · Open: yes but stale; low priority.
Link OK: NO. Link-free only.

> Downloaded (exported) chats are routinely accepted; the question is always authentication, i.e.
> can you satisfy the court that the export is what it says it is. In practice that means: export
> it using WhatsApp's own Export Chat function rather than screenshots, keep the export file and
> the phone unaltered, and be ready to swear an affidavit that it's a complete and accurate copy.
> The other side deleting their copy doesn't change yours. A clean, page-numbered printout with
> the messages numbered helps everyone refer to specific lines. Not legal advice; a family lawyer
> will tell you how they want it formatted for filing.

## 18. r/LegalAdviceUK — "How do I extract WhatsApp message data for use as evidence in a small claims court?"
URL: https://www.reddit.com/r/LegalAdviceUK/comments/192gcdb/how_do_i_extract_whatsapp_message_data_for_use_as/
Date: Jan 2024 (confirmed old, 8 comments) · Open: yes but stale; low priority.
Link OK: NO. Link-free only.

> WhatsApp has this built in: open the chat → ⋮ → More → Export chat (on iPhone: tap the name
> at the top → Export Chat). Choose Without media for a small text file, or Include media if
> photos of the work matter. Email it to yourself, keep the original untouched, and produce a
> printed, page-numbered copy for the bundle with a short statement saying it's a true export
> taken on [date]. Judges prefer this over screenshots because it's the full conversation in
> order. Not legal advice.

## 19. r/iphone — "Best way to save a long text message thread for a court case?"
URL: https://www.reddit.com/r/iphone/comments/1bbkroi/best_way_to_save_a_long_text_message_thread_for_a/
Date: ~Mar 2024 (snippet says "3y ago") · Open: yes but stale. Mostly iMessage; only worth a reply if WhatsApp comes up.
Link OK: yes.

> If the thread is iMessage, the reliable routes are Messages on a Mac (select the conversation,
> File → Print → Save as PDF) or a desktop exporter like iMazing. If it's WhatsApp it's easier:
> tap the contact's name → Export Chat, which gives you a dated text file of the entire thread,
> and I built a free browser page that turns that into a numbered, page-numbered PDF without
> uploading anything: https://jbarca.github.io/whatsapp-chat-to-pdf/  Either way, keep the phone
> and the original file; the printout is the exhibit, the original is what authenticates it.

## 20. r/privacy — "WhatsApp's backups were stored on Google Cloud… so they were reading the backups?"
URL: https://www.reddit.com/r/privacy/comments/1cha8iv/whatsapps_backups_were_stored_on_google_cloud/
Date: ~Apr 2024 (confirmed "2y ago") · Open: yes but stale; low priority. r/privacy is hostile to promo; only post if you genuinely add to the thread.
Link OK: borderline. One line, disclosed.

> Worth separating two things: the cloud backup (msgstore .crypt15, now optionally end-to-end
> encrypted with your own key) and the Export Chat feature, which writes a plain .txt/.zip you
> control. If the goal is a readable archive that never touches Google or Meta, export each chat,
> keep the files on your own encrypted disk, and skip the cloud backup entirely. For reading them
> later I built a static page that renders the export in the browser with no network calls
> (source on GitHub): https://jbarca.github.io/whatsapp-chat-to-pdf/

---

## Dropped
- r/AusLegal "How can I get my bond back" (1p2tkbi): deleted by the poster.
- r/Custody 1dnb07g: 2024, off-topic (about the ex messaging the kids), skipped.
- r/summerprogramresults "WaMorePDF" thread: spam post, don't engage.

## Fresh-thread search (repeat daily while the launch is running)
Google/DDG with "past week" or "past month":
- site:reddit.com whatsapp export chat pdf
- site:reddit.com whatsapp messages evidence court export
- site:reddit.com/r/FamilyLaw OR site:reddit.com/r/Custody whatsapp
- site:reddit.com/r/SpouseVisaUk OR site:reddit.com/r/I130Suffering OR site:reddit.com/r/USCIS whatsapp
- site:reddit.com/r/AusLegal OR site:reddit.com/r/TenantsInTheUK whatsapp screenshots
- site:reddit.com/r/whatsapp "export chat"
