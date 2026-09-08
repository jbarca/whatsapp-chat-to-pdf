/* Local PDF generation, independent of the browser's print engine. */
'use strict';
importScripts('vendor/jspdf-4.2.1.umd.min.js');

let receiveImage;
self.onmessage = ({ data }) => {
  if (data.type === 'image') { receiveImage(data.buffer); return; }
  if (data.type === 'export') generate(data.messages, data.options).catch(error => {
    self.postMessage({ type: 'error', message: error.message });
  });
};

async function generate(messages, options) {
  const response = await fetch('vendor/NotoSans-Regular.ttf', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not load the PDF font. Check your connection and retry.');
  const fontBytes = new Uint8Array(await response.arrayBuffer());
  let fontData = '';
  for (let i = 0; i < fontBytes.length; i += 8192) fontData += String.fromCharCode(...fontBytes.subarray(i, i + 8192));
  const font = new FontFace('Transcript', fontBytes);
  await font.load(); self.fonts.add(font);
  const pdf = new self.jspdf.jsPDF({ unit: 'pt', format: options.paper === 'letter' ? 'letter' : 'a4', compress: true });
  pdf.addFileToVFS('NotoSans.ttf', fontData);
  pdf.addFont('NotoSans.ttf', 'Transcript', 'normal');
  pdf.setFont('Transcript');
  pdf.setProperties({ title: options.title, creator: 'WhatsApp Chat to PDF' });
  self.postMessage({ type: 'ready' });
  const progress = message => self.postMessage({ type: 'progress', message });
  const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
  const margin = 42, top = 48, bottom = height - 42, usable = width - margin * 2;
  const size = { s: 9, m: 10.5, l: 12 }[options.size] || 10.5;
  const ink = '#1b1f23', muted = '#6b7280';
  const date = new Intl.DateTimeFormat(options.locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const day = new Intl.DateTimeFormat(options.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = new Intl.DateTimeFormat(options.locale, { hour: '2-digit', minute: '2-digit' });
  const pad = n => String(n).padStart(2, '0');
  const stamp = m => `${m.date.getFullYear()}-${pad(m.date.getMonth() + 1)}-${pad(m.date.getDate())} ${pad(m.date.getHours())}:${pad(m.date.getMinutes())}${m.hasSeconds ? ':' + pad(m.date.getSeconds()) : ''}`;
  const segmenter = new Intl.Segmenter(options.locale, { granularity: 'grapheme' });
  const canvas = new OffscreenCanvas(1, 1);
  const pen = canvas.getContext('2d');
  const metadata = pdf.internal.getFont().metadata;
  const searchText = unicodeTextLayer(pdf, fontData);
  let y = top, pageCount = 0, imageErrors = 0;
  const images = new Map();

  // Embed ordinary text as searchable vectors. Browser fonts preserve complex scripts,
  // CJK and colour emoji in small line images, without rasterising whole pages.
  function needsCanvas(text) {
    if (/[\u0590-\u109f\u1780-\u18af\u200c-\u200f\u202a-\u202e\u2066-\u2069\ua980-\uaaff\ufe00-\ufe0f]/u.test(text)) return true;
    return Array.from(text).some(c => c !== '\t' && !metadata.characterToGlyph(c.codePointAt(0)));
  }
  function measure(text, fontSize, raster) {
    if (raster) { pen.font = `${fontSize}px Transcript, sans-serif`; return pen.measureText(text).width; }
    pdf.setFontSize(fontSize); return pdf.getTextWidth(text);
  }
  function lines(text, maxWidth, fontSize = size, color = ink) {
    const result = [];
    for (const paragraph of String(text).replace(/\t/g, '    ').split(/\r\n?|\n|\u2028|\u2029/u)) {
      const raster = needsCanvas(paragraph);
      const urls = Array.from(paragraph.matchAll(/https?:\/\/[^\s<>"]+/g));
      let line = '', offset = 0;
      const push = () => {
        const links = urls.filter(match => match.index < offset + line.length && match.index + match[0].length > offset)
          .map(match => ({ url: match[0], start: Math.max(0, match.index - offset), end: Math.min(line.length, match.index + match[0].length - offset) }));
        result.push({ text: line, size: fontSize, color, raster, links, height: fontSize * 1.5 });
        offset += line.length; line = '';
      };
      for (const token of paragraph.match(/\s+|\S+/gu) || []) {
        if (measure(line + token, fontSize, raster) <= maxWidth) { line += token; continue; }
        if (line) push();
        if (measure(token, fontSize, raster) <= maxWidth) { line = token; continue; }
        for (const { segment } of segmenter.segment(token)) {
          if (line && measure(line + segment, fontSize, raster) > maxWidth) push();
          line += segment;
        }
      }
      push();
    }
    return result;
  }
  async function drawLine(line, x, lineY, align = 'left', boxWidth = usable) {
    const w = measure(line.text, line.size, line.raster);
    if (align === 'right') x += boxWidth - w;
    if (align === 'center') x += (boxWidth - w) / 2;
    if (!line.text.trim()) return;
    for (const link of line.links) {
      const left = measure(line.text.slice(0, link.start), line.size, line.raster);
      const linkWidth = measure(line.text.slice(link.start, link.end), line.size, line.raster);
      pdf.link(x + left, lineY, linkWidth, line.height, { url: link.url });
    }
    pdf.setTextColor(line.color); pdf.setFontSize(line.size);
    if (!line.raster) {
      pdf.text(line.text, x, lineY + line.size);
      return;
    }
    // Three pixels per point keeps fallback glyphs sharp at normal print sizes.
    canvas.width = Math.max(1, Math.ceil((w + line.size) * 3));
    canvas.height = Math.ceil(line.height * 3);
    pen.scale(3, 3); pen.font = `${line.size}px Transcript, sans-serif`;
    pen.fillStyle = line.color; pen.textBaseline = 'alphabetic';
    const rtl = /^[^\p{Letter}]*[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(line.text);
    pen.direction = rtl ? 'rtl' : 'ltr'; pen.textAlign = 'left';
    pen.fillText(line.text, line.size / 2, line.size);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    pdf.addImage(new Uint8Array(await blob.arrayBuffer()), 'PNG', x - line.size / 2, lineY, canvas.width / 3, canvas.height / 3, undefined, 'FAST');
    searchText(line.text, x, height - lineY - line.size, line.size, w);
    canvas.width = canvas.height = 1;
  }
  async function newPage() {
    if (pageCount) pdf.addPage();
    pageCount++; y = top;
    const heading = `${options.title} — exported ${date.format(new Date())} — ${options.fileName}`;
    const first = lines(heading, usable, 7.5, muted)[0];
    await drawLine(first, margin, 20);
    pdf.setFontSize(8); pdf.setTextColor(muted);
    pdf.text(String(pageCount), width / 2, height - 20, { align: 'center' });
    if (options.limited) {
      pdf.setTextColor('#e5e7eb'); pdf.setFontSize(40);
      pdf.text('PREVIEW', width / 2 - 90, height / 2, { angle: 35 });
    }
  }
  async function ensure(space) { if (y + space > bottom) await newPage(); }
  async function paragraph(text, fontSize = size, color = ink, align = 'left') {
    for (const line of lines(text, usable, fontSize, color)) {
      await ensure(line.height);
      await drawLine(line, margin, y, align);
      y += line.height;
    }
  }
  async function photo(name) {
    if (images.has(name)) return images.get(name);
    const buffer = await new Promise(resolve => { receiveImage = resolve; self.postMessage({ type: 'image', name }); });
    let bitmap;
    try {
      if (!buffer) throw new Error('Missing photo');
      bitmap = await createImageBitmap(new Blob([buffer]));
      const scale = Math.min(1, 1800 / bitmap.width, 1260 / bitmap.height);
      const imageCanvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const context = imageCanvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
      context.drawImage(bitmap, 0, 0, imageCanvas.width, imageCanvas.height);
      const blob = await imageCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const image = { data: new Uint8Array(await blob.arrayBuffer()), width: imageCanvas.width, height: imageCanvas.height, alias: `photo-${images.size}` };
      imageCanvas.width = imageCanvas.height = 1;
      images.set(name, image); return image;
    } catch (err) {
      images.set(name, null); return null;
    } finally { if (bitmap) bitmap.close(); }
  }

  await newPage();
  await paragraph(options.title, 18); y += 6;
  if (options.evidence) {
    await paragraph('WhatsApp chat transcript — evidence export', 10, muted); y += 16;
    for (const [label, value] of options.cover) {
      await ensure(45);
      await paragraph(label, 9, muted);
      await paragraph(value, 10); y += 9;
    }
    await newPage();
  } else { await paragraph(options.subtitle, 9, muted); y += 10; }
  let lastDay = '';
  if (!messages.length) await paragraph('No messages match the selected filters.', size, muted);
  for (let index = 0; index < messages.length; index++) {
    const m = messages[index];
    if (m.date.toDateString() !== lastDay) {
      lastDay = m.date.toDateString();
      await ensure(60); y += 8;
      await paragraph(day.format(m.date), 8.5, muted, 'center'); y += 8;
    }
    const own = !m.system && options.me && m.sender === options.me;
    const bubbleWidth = options.plain ? usable : usable * (m.system ? 0.9 : 0.78);
    const padding = options.plain ? 0 : 9;
    const textWidth = bubbleWidth - padding * 2;
    const x = options.plain ? margin : m.system ? (width - bubbleWidth) / 2 : own ? width - margin - bubbleWidth : margin;
    const blocks = [];
    const addText = (text, fontSize = size, color = ink, align = 'left') => {
      blocks.push(...lines(text, textWidth, fontSize, color).map(line => ({ ...line, align })));
    };
    if (options.evidence) addText('#' + String(m.id).padStart(options.numWidth, '0'), 8, muted);
    if (!m.system && m.sender && (options.evidence || options.plain || m.sender !== options.me)) addText(m.sender, size * 0.85, own ? '#3f6212' : '#0f766e');
    for (const name of m.attachments) {
      if (options.embed && /\.(jpe?g|png|gif|webp)$/i.test(name)) {
        const image = await photo(name);
        if (image) {
          const scale = Math.min(textWidth / image.width, 300 / image.height, 1);
          blocks.push({ image, width: image.width * scale, height: image.height * scale + 5 });
        } else { imageErrors++; addText(name + ' (image unavailable)', size * 0.85, muted); }
      } else addText('Attachment: ' + name, size * 0.85, muted);
    }
    if (m.mediaOmitted) addText('Media (not included in export)', size * 0.85, muted);
    if (m.deleted) addText('This message was deleted', size, muted);
    else if (m.text) addText(m.text);
    addText(options.evidence ? stamp(m) : time.format(m.date), 8, muted, 'right');
    const totalHeight = blocks.reduce((sum, block) => sum + block.height, padding * 2);
    if (totalHeight <= bottom - top) await ensure(totalHeight);
    // Fragment only oversized messages; preserve every line and keep photos intact.
    let cursor = 0;
    while (cursor < blocks.length) {
      await ensure(blocks[cursor].height + padding * 2);
      let end = cursor, blockHeight = padding * 2;
      while (end < blocks.length && y + blockHeight + blocks[end].height <= bottom) blockHeight += blocks[end++].height;
      if (!options.plain) {
        pdf.setFillColor(m.system ? '#fff5cc' : own ? '#dcf8c6' : '#f4f6f8');
        pdf.roundedRect(x, y, bubbleWidth, blockHeight, 5, 5, 'F');
      }
      y += padding;
      for (; cursor < end; cursor++) {
        const block = blocks[cursor];
        if (block.image) {
          const image = block.image;
          pdf.addImage(image.data, 'JPEG', x + padding, y, block.width, block.height - 5, image.alias, 'FAST');
          // jsPDF retains the compressed image; subsequent uses refer to its alias.
          image.data = new Uint8Array();
        } else await drawLine(block, x + padding, y, block.align, textWidth);
        y += block.height;
      }
      y += padding;
      if (cursor < blocks.length) await newPage();
    }
    y += options.plain ? 5 : 7;
    if ((index + 1) % 250 === 0 || index + 1 === messages.length) progress(`Creating PDF: ${(index + 1).toLocaleString()} of ${messages.length.toLocaleString()} messages…`);
  }
  if (options.hiddenCount) { y += 8; await paragraph(`… ${options.hiddenCount.toLocaleString()} more messages in the full version`, 9, muted, 'center'); }
  progress(`Finalising ${pageCount.toLocaleString()} pages…`);
  const buffer = pdf.output('arraybuffer');
  self.postMessage({ type: 'done', buffer, pages: pageCount, imageErrors }, [buffer]);
}

// A standard invisible CID text layer makes canvas-shaped lines searchable/copyable,
// including characters outside the bundled font and supplementary-plane emoji.
// ToUnicode stores the actual code points; the embedded glyphs are never painted.
function unicodeTextLayer(pdf, fontData) {
  const resource = pdf.internal.getFont('courier', 'normal'); // reserved; never used for visible text
  const characters = new Map();
  const hex = n => n.toString(16).padStart(4, '0');
  pdf.internal.events.subscribe('putFont', ({ font, out, newObject, putStream }) => {
    if (font !== resource || !characters.size) return;
    const stream = data => {
      const id = newObject(); putStream({ data, objectId: id }); out('endobj'); return id;
    };
    const file = newObject();
    putStream({ data: fontData, addLength1: true, objectId: file }); out('endobj');
    const mapping = Array.from(characters, ([char, id]) => `<${hex(id)}> <${Array.from({ length: char.length }, (_, i) => hex(char.charCodeAt(i))).join('')}>`);
    const groups = [];
    for (let i = 0; i < mapping.length; i += 100) {
      const group = mapping.slice(i, i + 100);
      groups.push(`${group.length} beginbfchar\n${group.join('\n')}\nendbfchar`);
    }
    const cmap = stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /TranscriptUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${groups.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`);
    const glyphs = stream('\0'.repeat((characters.size + 1) * 2));
    const descriptor = newObject();
    out(`<< /Type /FontDescriptor /FontName /TranscriptSearch /Flags 4 /FontBBox [-1000 -1000 3000 3000] /ItalicAngle 0 /Ascent 1069 /Descent -293 /CapHeight 714 /StemV 80 /FontFile2 ${file} 0 R >>`); out('endobj');
    const cid = newObject();
    out(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TranscriptSearch /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 500 /CIDToGIDMap ${glyphs} 0 R >>`); out('endobj');
    font.objectNumber = newObject();
    out(`<< /Type /Font /Subtype /Type0 /BaseFont /TranscriptSearch /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${cmap} 0 R >>`); out('endobj');
    font.isAlreadyPutted = true;
  });
  return (text, x, y, size, width) => {
    const chars = Array.from(text);
    const codes = chars.map(char => {
      if (!characters.has(char)) {
        if (characters.size === 65534) throw new Error('Too many distinct characters in one PDF. Export a smaller date range.');
        characters.set(char, characters.size + 1);
      }
      return hex(characters.get(char));
    }).join('');
    const scale = width / (chars.length * size * 0.5) * 100;
    pdf.internal.write(`q BT /${resource.id} ${size} Tf 3 Tr ${scale} Tz 1 0 0 1 ${x} ${y} Tm <${codes}> Tj ET Q`);
  };
}
