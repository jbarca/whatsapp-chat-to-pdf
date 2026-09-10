const assert = require('node:assert/strict');
const policy = require('../safe-policy.js');

assert.equal(policy.normalize('  HÉLLO\u200b—WORLD  '), 'héllo world');
assert.deepEqual(policy.customTerms('Secret Phrase\nsecret phrase\n\nAnother'), ['secret phrase', 'another']);
assert.equal(policy.hasTerm('not a gunship', 'gun'), false);
assert.equal(policy.hasTerm('bring the gun tonight', 'gun'), true);
assert.equal(policy.ruleFindings('I will kill you', ['abuse'], []).length, 1);
assert.equal(policy.ruleFindings('I will kill you', ['crime'], []).length, 0);
assert.equal(policy.ruleFindings('a SECRET phrase here', [], ['secret phrase']).length, 1);
assert.equal(policy.ruleFindingsNormalized(' i will kill you ', ['abuse'], []).length, 1);
assert.equal(policy.isScannable(policy.normalize('<Media omitted>')), false);
assert.equal(policy.isScannable(policy.normalize('👍')), false);
assert.equal(policy.isScannable(policy.normalize('')), false);
assert.equal(policy.isScannable(policy.normalize('ok')), true);
assert.equal(policy.isScannable(policy.normalize('http://example.com/x')), true);
assert.equal(policy.THRESHOLDS.text, 0.30);
assert.equal(policy.THRESHOLDS.image, 0.25);
assert.equal(policy.stableFingerprint({ a: 1 }), policy.stableFingerprint({ a: 1 }));
assert.notEqual(policy.stableFingerprint({ a: 1 }), policy.stableFingerprint({ a: 2 }));
const merged = policy.mergeFindings([
  { messageId: 2, category: 'abuse', reason: 'x', score: .3 },
  { messageId: 2, category: 'abuse', reason: 'x', score: .8 },
]);
assert.equal(merged.length, 1); assert.equal(merged[0].score, .8);
console.log('safe policy tests passed');
