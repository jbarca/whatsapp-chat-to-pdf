/* Pure Safe Mode scheduling helpers shared by the worker and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SafeScheduler = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  function preprocess(messages, classifyLanguage, isScannable, normalize) {
    const groups = [], byKey = new Map(), attachmentOwners = new Map();
    for (let index = 0; index < (messages || []).length; index++) {
      const message = messages[index];
      if (!message || message.deleted || !message.text) continue;
      const key = normalize(message.text);
      let group = byKey.get(key);
      if (!group) {
        group = { text: message.text, key, scannable: isScannable(key), owners: [] };
        // `.english` is expensive (classifyLanguage runs a full \p{L} match) and only read for
        // English-only categories on scannable groups — compute lazily, cache on first read.
        Object.defineProperty(group, 'english', {
          configurable: true, enumerable: true,
          get() {
            const value = classifyLanguage(message.text, key);
            Object.defineProperty(group, 'english', { value, enumerable: true, configurable: true, writable: false });
            return value;
          },
        });
        byKey.set(key, group); groups.push(group);
      }
      group.owners.push({ id: message.id, index });
      for (const name of message.attachments || []) {
        let owners = attachmentOwners.get(name);
        if (!owners) { owners = []; attachmentOwners.set(name, owners); }
        owners.push({ id: message.id, index });
      }
    }
    return { groups, attachmentOwners };
  }
  function bucketed(items, sizeOf) {
    const order = items.map((_, i) => i).sort((a, b) => (sizeOf(items[a]) - sizeOf(items[b])) || (a - b));
    return {
      items: order.map(i => items[i]),
      restore(results) {
        const out = new Array(items.length);
        for (let p = 0; p < order.length; p++) out[order[p]] = results[p];
        return out;
      },
    };
  }
  async function batched(items, initialSize, invoke, onBatch, isFatal) {
    const output = [];
    for (let offset = 0; offset < items.length;) {
      let size = Math.min(initialSize, items.length - offset);
      while (true) {
        try {
          const batch = items.slice(offset, offset + size);
          const result = await invoke(batch);
          if (result.length !== batch.length) throw new Error(`batched: invoke returned ${result.length} results for a batch of ${batch.length}`);
          output.push(...result); offset += size;
          if (onBatch) onBatch(offset, items.length, size);
          break;
        } catch (error) {
          if ((isFatal && isFatal(error)) || size === 1) throw error;
          size = Math.max(1, Math.floor(size / 2));
        }
      }
    }
    return output;
  }
  function fanOut(groups, results, makeFindings) {
    const findings = [];
    groups.forEach((group, groupIndex) => {
      const items = makeFindings(results[groupIndex], group) || [];
      for (const owner of group.owners) for (const item of items) findings.push(Object.assign({ messageId: owner.id, _messageIndex: owner.index }, item));
    });
    return findings;
  }
  function ordered(findings) {
    return (findings || []).map((finding, sequence) => ({ finding, sequence })).sort((a, b) =>
      (a.finding._messageIndex - b.finding._messageIndex) || ((a.finding._phase || 0) - (b.finding._phase || 0)) || a.sequence - b.sequence
    ).map(({ finding }) => { const clean = Object.assign({}, finding); delete clean._messageIndex; delete clean._phase; return clean; });
  }
  return { preprocess, batched, bucketed, fanOut, ordered };
});
