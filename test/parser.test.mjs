import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse } = require('../parser.js');

const ios = `[07/09/2026, 10:15:32] Alice: Hey there
[07/09/2026, 10:16:01] Bob: Hi!
second line of Bob
[07/09/2026, 10:17:00] Alice: ‎<attached: 00000003-PHOTO-2026-09-07-10-17-00.jpg>
[07/09/2026, 10:18:00] Bob: This message was deleted
‎[08/09/2026, 09:00:00] ‎Messages and calls are end-to-end encrypted. No one outside of this chat can read them.
[13/09/2026, 11:00:00] Alice: after the 12th
`;
let r = parse(ios);
assert.equal(r.dateOrder, 'DMY');
assert.equal(r.messages.length, 6);
assert.equal(r.messages[1].text, 'Hi!\nsecond line of Bob');
assert.deepEqual(r.messages[2].attachments, ['00000003-PHOTO-2026-09-07-10-17-00.jpg']);
assert.equal(r.messages[3].deleted, true);
assert.equal(r.messages[4].system, true);
assert.equal(r.messages[4].sender, null);
assert.equal(r.messages[0].date.getHours(), 10);
assert.equal(r.messages[5].date.getDate(), 13);
assert.equal(r.senders[0].name, 'Alice');

const android = `07/09/2026, 10:15 - Messages to this group are now secured with end-to-end encryption.
07/09/2026, 10:15 - Alice: Hey
07/09/2026, 10:16 - Bob: IMG-20260907-WA0001.jpg (file attached)
07/09/2026, 10:17 - Bob: <Media omitted>
07/09/2026, 10:18 - Alice added Carol
`;
r = parse(android);
assert.equal(r.messages.length, 5);
assert.equal(r.messages[0].system, true);
assert.deepEqual(r.messages[2].attachments, ['IMG-20260907-WA0001.jpg']);
assert.equal(r.messages[3].mediaOmitted, true);
assert.equal(r.messages[4].system, true);

const us = `9/7/26, 10:15 PM - Alice: evening
9/7/26, 12:05 AM - Bob: after midnight
9/23/26, 1:00 PM - Alice: later
`;
r = parse(us);
assert.equal(r.dateOrder, 'MDY');
assert.equal(r.messages[0].date.getHours(), 22);
assert.equal(r.messages[1].date.getHours(), 0);
assert.equal(r.messages[2].date.getMonth(), 8);
assert.equal(r.messages[2].date.getDate(), 23);

const iosUS = `[9/7/26, 10:15:32 AM] Alice: hi
[9/7/26, 10:15:40 AM] Bob: url with colon: https://x.y/z: ok
`;
r = parse(iosUS);
assert.equal(r.messages[1].sender, 'Bob');
assert.equal(r.messages[1].text, 'url with colon: https://x.y/z: ok');

const de = `07.09.26, 10:15 - Anna: Hallo
`;
r = parse(de);
assert.equal(r.messages.length, 1);
assert.equal(r.messages[0].date.getFullYear(), 2026);

// ambiguous dates: monotonic hint
const amb = `01/02/26, 10:00 - A: x
01/03/26, 10:00 - A: y
02/03/26, 10:00 - A: z
`;
r = parse(amb);
assert.equal(r.dateOrder, 'DMY'); // 1 Feb, 1 Mar, 2 Mar is monotonic under DMY; under MDY Jan 2, Jan 3, Feb 3 is also monotonic -> tie -> DMY default
r = parse(amb, { dateOrder: 'MDY' });
assert.equal(r.messages[0].date.getMonth(), 0);

r = parse('random text\nno headers');
assert.equal(r.messages.length, 0);
assert.ok(r.warnings.length);

console.log('parser tests passed');
