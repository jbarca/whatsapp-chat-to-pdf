/* Pure Safe Mode scheduling helpers shared by the worker and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SafeScheduler = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  function preprocess(messages, classifyLanguage) {
    const groups = [], byText = new Map(), attachmentOwners = new Map();
    for (let index = 0; index < (messages || []).length; index++) {
      const message = messages[index];
      if (!message || message.deleted || !message.text) continue;
      let group = byText.get(message.text);
      if (!group) { group = { text: message.text, english: classifyLanguage(message.text), owners: [] }; byText.set(message.text, group); groups.push(group); }
      group.owners.push({ id: message.id, index });
      for (const name of message.attachments || []) {
        let owners = attachmentOwners.get(name);
        if (!owners) { owners = []; attachmentOwners.set(name, owners); }
        owners.push({ id: message.id, index });
      }
    }
    return { groups, attachmentOwners };
  }
  async function batched(items, initialSize, invoke, onBatch) {
    const output = [];
    for (let offset = 0; offset < items.length;) {
      let size = Math.min(initialSize, items.length - offset);
      while (true) {
        try {
          const result = await invoke(items.slice(offset, offset + size));
          output.push(...result); offset += size;
          if (onBatch) onBatch(offset, items.length, size);
          break;
        } catch (error) {
          if (size === 1) throw error;
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
  return { preprocess, batched, fanOut, ordered };
});
