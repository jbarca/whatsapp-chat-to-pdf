/* Safe Mode policy v1.0.0. Pure helpers are shared by the UI, worker and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SafePolicy = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const VERSION = '1.2.0';
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
  const PLACEHOLDER = /^(media omitted|image omitted|video omitted|audio omitted|gif omitted|sticker omitted|document omitted|contact card omitted|this message was deleted|you deleted this message|missed voice call|missed video call)$/;

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('und')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\p{M}/gu, '')
      .replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}'\n]+/gu, ' ').replace(/[ \t]+/g, ' ').trim();
  }
  function isScannable(key) { return !!key && !PLACEHOLDER.test(key) && /\p{L}{2}/u.test(key); }
  function customTerms(value) {
    return [...new Set(String(value || '').split(/\r?\n/).map(normalize).filter(Boolean))];
  }
  function hasTerm(text, term) {
    if (!term) return false;
    const haystack = ` ${normalize(text)} `, needle = ` ${term} `;
    return haystack.includes(needle);
  }
  const NORMALIZED_RULES = Object.freeze(Object.fromEntries(Object.entries(RULES).map(([category, words]) => [category, words.map(normalize)])));
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // One compiled alternation per category (built once): a single scan replaces ~6 `.includes()` calls per category per group.
  // Still space-padded substrings, not `\b` — matches the exact "word" semantics `hasTerm`/the old loop used.
  const CATEGORY_REGEX = Object.freeze(Object.fromEntries(Object.entries(NORMALIZED_RULES)
    .map(([category, words]) => [category, new RegExp(` (?:${words.map(escapeRe).join('|')}) `)])));
  let customRegexCache = { terms: null, regex: null }; // 1-entry memo: same terms array in => no recompile
  function customRegexFor(terms) {
    if (customRegexCache.terms === terms) return customRegexCache.regex;
    const regex = terms && terms.length ? new RegExp(` (?:${terms.map(escapeRe).join('|')}) `) : null;
    customRegexCache = { terms, regex };
    return regex;
  }
  function ruleFindingsNormalized(paddedHaystack, categories, terms) {
    const selected = new Set(categories || []), findings = [];
    for (const [category, words] of Object.entries(NORMALIZED_RULES)) {
      if (!selected.has(category) || !CATEGORY_REGEX[category].test(paddedHaystack)) continue;
      // Regex only answers "did anything match"; re-resolve via declaration order so the reported
      // phrase stays byte-identical to the old `words.find` (first-declared, not leftmost-in-text).
      const hit = words.find(word => paddedHaystack.includes(` ${word} `));
      findings.push({ category, reason: `Matched risk phrase: “${hit}”`, score: 1, source: 'rule' });
    }
    const customRegex = customRegexFor(terms);
    if (customRegex && customRegex.test(paddedHaystack)) {
      const custom = terms.find(term => paddedHaystack.includes(` ${term} `));
      findings.push({ category: 'custom', reason: `Matched custom term: “${custom}”`, score: 1, source: 'custom' });
    }
    return findings;
  }
  function ruleFindings(text, categories, terms) {
    return ruleFindingsNormalized(` ${normalize(text)} `, categories, terms);
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
  return { VERSION, THRESHOLDS, LABELS, RULES, normalize, isScannable, customTerms, hasTerm, ruleFindings, ruleFindingsNormalized, mergeFindings, stableFingerprint };
});
