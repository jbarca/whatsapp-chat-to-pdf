/* Safe Mode policy v1.0.0. Pure helpers are shared by the UI, worker and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SafePolicy = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const VERSION = '1.0.0';
  const THRESHOLDS = Object.freeze({ text: 0.30, image: 0.25 });
  const LABELS = Object.freeze({
    abuse: 'Abuse, hate, and threats', sexual: 'Sexual or explicit content',
    violence: 'Violence or self-harm', drugs: 'Drugs or weapons',
    crime: 'Crime, fraud, or admissions/planning', images: 'Sensitive images', custom: 'Custom term',
  });
  const RULES = Object.freeze({
    abuse: ['kill you', 'hate you', 'worthless', 'racial slur', 'death threat', 'go die'],
    sexual: ['nude', 'nudes', 'porn', 'explicit photo', 'sex video'],
    violence: ['suicide', 'self harm', 'cut myself', 'stab', 'shoot', 'murder'],
    drugs: ['cocaine', 'heroin', 'meth', 'drug deal', 'gun', 'firearm', 'ammunition'],
    crime: ['money laundering', 'stolen card', 'credit card fraud', 'scam them', 'fake invoice', 'break in'],
  });

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('und')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\p{M}/gu, '')
      .replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}'\n]+/gu, ' ').replace(/[ \t]+/g, ' ').trim();
  }
  function customTerms(value) {
    return [...new Set(String(value || '').split(/\r?\n/).map(normalize).filter(Boolean))];
  }
  function hasTerm(text, term) {
    if (!term) return false;
    const haystack = ` ${normalize(text)} `, needle = ` ${term} `;
    return haystack.includes(needle);
  }
  function ruleFindings(text, categories, terms) {
    const selected = new Set(categories || []), findings = [];
    for (const [category, words] of Object.entries(RULES)) {
      if (!selected.has(category)) continue;
      const hit = words.find(word => hasTerm(text, normalize(word)));
      if (hit) findings.push({ category, reason: `Matched risk phrase: “${hit}”`, score: 1, source: 'rule' });
    }
    const custom = (terms || []).find(term => hasTerm(text, term));
    if (custom) findings.push({ category: 'custom', reason: `Matched custom term: “${custom}”`, score: 1, source: 'custom' });
    return findings;
  }
  function mergeFindings(findings) {
    const merged = new Map();
    for (const finding of findings || []) {
      const key = `${finding.messageId}:${finding.category}:${finding.reason}`;
      const old = merged.get(key);
      if (!old || (finding.score || 0) > (old.score || 0)) merged.set(key, finding);
    }
    return [...merged.values()];
  }
  function stableFingerprint(input) {
    const text = JSON.stringify(input); let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `${VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  return { VERSION, THRESHOLDS, LABELS, RULES, normalize, customTerms, hasTerm, ruleFindings, mergeFindings, stableFingerprint };
});
