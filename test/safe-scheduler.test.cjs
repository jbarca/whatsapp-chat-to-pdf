const assert = require('node:assert/strict');
const scheduler = require('../safe-scheduler.js');
const normalize = text => String(text || '').toLowerCase().trim();

(async () => {
  let classifications = 0;
  const messages = [
    { id: 3, text: 'same', attachments: ['a.jpg'] },
    { id: 1, text: 'Same', attachments: ['a.jpg'] },
    { id: 2, text: 'hola', attachments: ['missing.jpg'] },
    { id: 4, text: '', attachments: ['ignored.jpg'] },
    { id: 5, text: 'deleted', deleted: true },
  ];
  const prepared = scheduler.preprocess(messages, (text, key) => { classifications++; return key !== 'hola'; }, key => key !== 'hola', normalize);
  assert.equal(classifications, 0); // .english is lazy
  assert.deepEqual(prepared.groups.map(x => [x.text, x.owners.map(y => y.id), x.english, x.scannable]), [['same', [3, 1], true, true], ['hola', [2], false, false]]);
  assert.equal(classifications, 2);
  assert.deepEqual([...prepared.attachmentOwners].map(([name, owners]) => [name, owners.map(x => x.id)]), [['a.jpg', [3, 1]], ['missing.jpg', [2]]]);

  const calls = [];
  const values = await scheduler.batched([1, 2, 3, 4, 5], 4, async batch => {
    calls.push(batch.slice());
    if (batch.length > 2) throw new Error('mock batch limit');
    return batch.map(x => x * 10);
  });
  assert.deepEqual(values, [10, 20, 30, 40, 50]);
  assert.deepEqual(calls, [[1, 2, 3, 4], [1, 2], [3, 4, 5], [3], [4, 5]]);
  await assert.rejects(() => scheduler.batched([1], 8, async () => { throw new Error('persistent'); }), /persistent/);

  const fatalCalls = [];
  await assert.rejects(() => scheduler.batched([1, 2, 3, 4], 4, async batch => {
    fatalCalls.push(batch.length); const error = new Error('Cancelled'); error.cancelled = true; throw error;
  }, null, error => !!error.cancelled), /Cancelled/);
  assert.deepEqual(fatalCalls, [4]);
  const softCalls = [];
  assert.deepEqual(await scheduler.batched([1, 2, 3, 4], 4, async batch => {
    softCalls.push(batch.length);
    if (batch.length > 2) throw new Error('mock batch limit');
    return batch.map(x => x * 10);
  }, null, error => !!error.cancelled), [10, 20, 30, 40]);
  assert.deepEqual(softCalls, [4, 2, 2]);

  const fanned = scheduler.fanOut(prepared.groups, [['hit'], []], result => result.map(reason => ({ category: 'abuse', reason, _phase: 1 })));
  assert.deepEqual(scheduler.ordered(fanned).map(x => x.messageId), [3, 1]);
  const reordered = scheduler.ordered([
    { messageId: 2, category: 'images', reason: 'later', _messageIndex: 1, _phase: 3 },
    { messageId: 1, category: 'custom', reason: 'first', _messageIndex: 0, _phase: 0 },
  ]);
  assert.deepEqual(reordered.map(x => x.messageId), [1, 2]);
  assert.equal('_messageIndex' in reordered[0], false);

  const items = ['ccc', 'a', 'bb', 'a', 'dddd'];
  const bucket = scheduler.bucketed(items, s => s.length);
  assert.deepEqual(bucket.items, ['a', 'a', 'bb', 'ccc', 'dddd']);
  assert.deepEqual(bucket.restore(bucket.items.map(s => s.toUpperCase())), items.map(s => s.toUpperCase()));
  await assert.rejects(() => scheduler.batched([1], 1, async () => [10, 20]), /batched: invoke returned/);

  // Stable tiebreak: equal-size items must preserve their original relative order.
  const tagged = ['bb-1', 'a-1', 'bb-0', 'ccc-0', 'bb-2', 'a-0'];
  const bucketTagged = scheduler.bucketed(tagged, s => s.split('-')[0].length);
  assert.deepEqual(bucketTagged.items, ['a-1', 'a-0', 'bb-1', 'bb-0', 'bb-2', 'ccc-0']);
  assert.deepEqual(bucketTagged.restore(bucketTagged.items.map(s => s.toUpperCase())), tagged.map(s => s.toUpperCase()));
  console.log('safe scheduler tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
