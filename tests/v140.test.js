import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingOpen, religiouslyOpen, partRecordable, eventPlace } from '../src/recording-window.js';
import { recognitionKey, recognitionSeconds, FARD_SECONDS, phraseLines } from '../src/recognition.js';
import { twoPrecedingFard, recoveryEligible, recoverableFards, RECOVERY_CONFIRM } from '../src/recovery.js';
import { parseBackup, splitBackup, mergeHistory } from '../src/backup.js';
import { recentIdsWithin } from '../src/progress-lines.js';

const at = h => new Date(Date.UTC(2026, 10, 13, 0, 0, 0) + h * 3600000);

test('recording stays open through the next period and is not the same as the religious window', () => {
  assert.equal(religiouslyOpen(at(4), at(6), at(5)), true);
  assert.equal(religiouslyOpen(at(4), at(6), at(7)), false);
  assert.equal(recordingOpen(at(4), at(6), at(9), at(7)), true);
  assert.equal(recordingOpen(at(4), at(6), at(9), at(9)), false);
  assert.equal(recordingOpen(at(4), at(6), null, at(5)), true);
  assert.equal(recordingOpen(at(4), at(6), null, at(7)), false);
});

test('Sunnah before closes once Fard is recorded; Sunnah after opens only then, and only inside the period', () => {
  assert.equal(partRecordable({ position: 'before', fardDone: false, start: at(4), end: at(6), now: at(5) }), true);
  assert.equal(partRecordable({ position: 'before', fardDone: true, start: at(4), end: at(6), now: at(5) }), false);
  assert.equal(partRecordable({ position: 'after', fardDone: false, start: at(4), end: at(6), now: at(5) }), false);
  assert.equal(partRecordable({ position: 'after', fardDone: true, start: at(4), end: at(6), now: at(5) }), true);
  assert.equal(partRecordable({ position: 'after', fardDone: true, start: at(4), end: at(6), now: at(7) }), false);
});

test('an event is completed only when every part is recorded, and an expired unfinished event is not called complete', () => {
  assert.equal(eventPlace([{ done: true }, { done: true }]), 'completed');
  assert.equal(eventPlace([{ done: true, actionable: false }, { done: false, actionable: true }]), 'live');
  assert.equal(eventPlace([{ done: false, actionable: false }]), 'closed');
});

test('recognition phrases and the fixed Fard durations', () => {
  assert.equal(recognitionKey({ fardDone: 1, firstJustNow: true }), 'first');
  assert.equal(recognitionKey({ fardDone: 5 }), 'fard');
  assert.equal(recognitionKey({ fardDone: 5, allStructured: true }), 'all');
  assert.equal(recognitionSeconds('first', {}), FARD_SECONDS[1]);
  assert.equal(recognitionSeconds('fard', { fardDone: 5 }), 30);
  assert.equal(recognitionSeconds('sunnah', { sunnahCount: 2, naflCount: 1 }), 5);
  const line = phraseLines('fard', 'bn');
  assert.equal(line.ar, 'مَا شَاءَ اللَّهُ');
  assert.match(line.meaning, /[\u0980-\u09FF]/);
});

test('recovery needs the two preceding Fard records and never uses Qada wording', () => {
  const events = [
    { kind: 'fard', key: 'fajr', dateKey: 'a', start: at(4), end: at(6) },
    { kind: 'fard', key: 'dhuhr', dateKey: 'a', start: at(11), end: at(15) },
    { kind: 'fard', key: 'asr', dateKey: 'a', start: at(15), end: at(17) }
  ];
  const preceding = twoPrecedingFard(events, at(18));
  assert.deepEqual(preceding.map(event => event.key), ['asr', 'dhuhr']);
  const recorded = new Set(['a:dhuhr', 'a:asr']);
  const isRecorded = event => recorded.has(`${event.dateKey}:${event.key}`);
  assert.equal(recoveryEligible(preceding, isRecorded), true);
  const list = recoverableFards(events, at(18), { isRecorded, isLocked: () => true });
  assert.deepEqual(list.map(event => event.key), ['fajr']);
  assert.doesNotMatch(`${RECOVERY_CONFIRM.en} ${RECOVERY_CONFIRM.bn}`, /qada|missed/i);
});

test('backup replace/merge reports unknown fields and does not drop a conflicting completion', () => {
  assert.equal(parseBackup('nope').ok, false);
  const parsed = parseBackup(JSON.stringify({ data: { history: { '2026-11-01': { fard: { fajr: false } } }, extraBook: true } }));
  assert.equal(parsed.ok, true);
  const split = splitBackup(parsed.backup.data);
  assert.deepEqual(split.unknown, ['extraBook']);
  const merged = mergeHistory({ '2026-11-01': { fard: { fajr: true } } }, split.clean.history);
  assert.equal(merged.history['2026-11-01'].fard.fajr, true);
  assert.equal(merged.conflicts.length, 1);
});

test('a progress line shown inside 90 days stays banned, and an older one does not', () => {
  const now = Date.UTC(2026, 10, 12);
  const ids = recentIdsWithin([{ id: 'a', at: now - 10 * 86400000 }, { id: 'b', at: now - 100 * 86400000 }], now);
  assert.deepEqual(ids, ['a']);
});
