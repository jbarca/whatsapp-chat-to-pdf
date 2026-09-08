const assert = require('node:assert/strict');
const scheduler = require('../safe-scheduler.js');

(async () => {
  let classifications = 0;
  const messages = [
    { id: 3, text: 'same', attachments: ['a.jpg'] },
    { id: 1, text: 'same', attachments: ['a.jpg'] },
    { id: 2, text: 'hola', attachments: ['missing.jpg'] },
    { id: 4, text: '', attachments: ['ignored.jpg'] },
    { id: 5, text: 'deleted', deleted: true },
  ];
  const prepared = scheduler.preprocess(messages, text => { classifications++; return text !== 'hola'; });
  assert.equal(classifications, 2);
  assert.deepEqual(prepared.groups.map(x => [x.text, x.owners.map(y => y.id), x.english]), [['same', [3, 1], true], ['hola', [2], false]]);
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

  const fanned = scheduler.fanOut(prepared.groups, [['hit'], []], result => result.map(reason => ({ category: 'abuse', reason, _phase: 1 })));
  assert.deepEqual(scheduler.ordered(fanned).map(x => x.messageId), [3, 1]);
  const reordered = scheduler.ordered([
    { messageId: 2, category: 'images', reason: 'later', _messageIndex: 1, _phase: 3 },
    { messageId: 1, category: 'custom', reason: 'first', _messageIndex: 0, _phase: 0 },
  ]);
  assert.deepEqual(reordered.map(x => x.messageId), [1, 2]);
  assert.equal('_messageIndex' in reordered[0], false);
  console.log('safe scheduler tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
