/* WhatsApp export parser. Works in browser (window.WAParser) and Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WAParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INVISIBLE = /[‎‏⁦⁧⁨⁩﻿]/g;

  // [07/09/2026, 10:15:32] Name: text          (iOS)
  // 07/09/2026, 10:15 - Name: text             (Android)
  // 9/7/26, 10:15 AM - Name: text              (Android, US)
  // [9/7/26, 10:15:32 AM] Name: text           (iOS, US)
  // 07.09.26, 10:15 - Name: text               (Android, DE etc.)
  // 2026-09-07, 10:15 - Name: text             (some locales)
  const HEADER = new RegExp(
    '^\\[?' +
    '(\\d{1,4})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{2,4})' +          // date
    '[,\\s]+' +
    '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?' +                          // time
    '\\s*([AaPp]\\.?[Mm]\\.?)?' +                                   // am/pm
    '\\]?' +
    '(?:\\s+-\\s+|\\s*[:\\]]?\\s+|\\s*-\\s*)' +                     // separator
    '(.*)$'
  );

  const MEDIA_IOS = /<attached:\s*([^>]+)>/i;
  const MEDIA_ANDROID = /^(\S[^\n]*?\.(?:jpe?g|png|gif|webp|heic|mp4|mov|3gp|opus|ogg|mp3|m4a|aac|pdf|docx?|xlsx?|pptx?|txt|vcf|zip))\s+\(file attached\)/i;
  const OMITTED = /^(?:<media omitted>|‎?(?:image|video|audio|sticker|gif|document|contact card)\s+omitted|<?Médias omis>?|<?Medien ausgelassen>?|<?Archivo omitido>?)$/i;
  const DELETED = /^(?:this message was deleted|you deleted this message|message deleted)\.?$/i;
  const SYSTEM_HINTS = /(?:end-to-end encrypted|created group|added|left|removed|changed the subject|changed this group|joined using|security code changed|changed their phone number|missed voice call|missed video call|deleted this group|turned on disappearing|turned off disappearing)/i;

  function normalizeLine(line) {
    return line.replace(INVISIBLE, '').replace(/[  ]/g, ' ').replace(/\r$/, '');
  }

  function splitHeader(line) {
    const m = HEADER.exec(line);
    if (!m) return null;
    return { a: +m[1], b: +m[2], c: +m[3], hh: +m[4], mm: +m[5], ss: m[6] != null ? +m[6] : null, ampm: m[7] ? m[7][0].toUpperCase() : null, rest: m[8] };
  }

  function detectDateOrder(headers) {
    // Returns 'YMD' | 'DMY' | 'MDY'
    if (headers.some(h => h.a > 31)) return 'YMD';
    if (headers.some(h => h.a > 12)) return 'DMY';
    if (headers.some(h => h.b > 12)) return 'MDY';
    // Ambiguous: check monotonicity under each order; pick the one with fewer backwards jumps.
    let backDMY = 0, backMDY = 0, prevD = 0, prevM = 0;
    for (const h of headers) {
      const d = keyOf(h, 'DMY'), m = keyOf(h, 'MDY');
      if (d < prevD) backDMY++; if (m < prevM) backMDY++;
      prevD = d; prevM = m;
    }
    if (backDMY !== backMDY) return backDMY < backMDY ? 'DMY' : 'MDY';
    return 'DMY';
  }

  function keyOf(h, order) {
    const { y, mo, d } = ymd(h, order);
    return y * 10000 + mo * 100 + d;
  }

  function ymd(h, order) {
    let y, mo, d;
    if (order === 'YMD') { y = h.a; mo = h.b; d = h.c; }
    else if (order === 'MDY') { mo = h.a; d = h.b; y = h.c; }
    else { d = h.a; mo = h.b; y = h.c; }
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return { y, mo, d };
  }

  function toDate(h, order) {
    const { y, mo, d } = ymd(h, order);
    let hh = h.hh;
    if (h.ampm === 'P' && hh < 12) hh += 12;
    if (h.ampm === 'A' && hh === 12) hh = 0;
    const dt = new Date(y, mo - 1, d, hh, h.mm, h.ss || 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function splitSender(rest) {
    // "Name: text" – sender names never contain ": " except pathological cases; system messages have no sender.
    const i = rest.indexOf(': ');
    if (i === -1) {
      if (rest.endsWith(':')) return { sender: rest.slice(0, -1), text: '' };
      return { sender: null, text: rest };
    }
    return { sender: rest.slice(0, i), text: rest.slice(i + 2) };
  }

  function parse(text, opts) {
    opts = opts || {};
    const lines = text.split('\n');
    const raw = []; // {h, senderText, lines[]}
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const line = normalizeLine(lines[i]);
      const h = splitHeader(line);
      if (h) { cur = { h, rest: h.rest, extra: [] }; raw.push(cur); }
      else if (cur) cur.extra.push(line);
    }

    const order = (opts.dateOrder && opts.dateOrder !== 'auto') ? opts.dateOrder : detectDateOrder(raw.map(r => r.h));
    const messages = [];
    const senderCounts = new Map();
    const warnings = [];
    let dropped = 0;

    for (const r of raw) {
      const date = toDate(r.h, order);
      if (!date) { dropped++; continue; }
      const { sender, text: first } = splitSender(r.rest);
      const body = [first].concat(r.extra).join('\n').replace(/\s+$/, '');
      const msg = {
        id: messages.length + 1,
        date,
        hasSeconds: r.h.ss != null,
        sender,
        text: body,
        system: sender == null || (body === '' && SYSTEM_HINTS.test(r.rest)),
        attachments: [],
        mediaOmitted: false,
        deleted: false,
      };
      // media
      let m;
      if ((m = MEDIA_IOS.exec(body))) {
        msg.attachments.push(m[1].trim());
        msg.text = body.replace(MEDIA_IOS, '').trim();
      } else if ((m = MEDIA_ANDROID.exec(body))) {
        msg.attachments.push(m[1].trim());
        msg.text = body.replace(MEDIA_ANDROID, '').trim();
      } else if (OMITTED.test(body.trim())) {
        msg.mediaOmitted = true; msg.text = '';
      } else if (DELETED.test(body.trim())) {
        msg.deleted = true;
      }
      if (sender) senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
      messages.push(msg);
    }
    if (dropped) warnings.push(dropped + ' line(s) had unparseable dates and were skipped.');
    if (!messages.length) warnings.push('No messages recognised. Is this a WhatsApp "Export chat" .txt file?');

    const senders = [...senderCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return {
      messages, senders, dateOrder: order, warnings,
      first: messages.length ? messages[0].date : null,
      last: messages.length ? messages[messages.length - 1].date : null,
    };
  }

  return { parse, detectDateOrder, normalizeLine, _HEADER: HEADER };
});
