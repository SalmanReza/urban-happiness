import test from 'node:test';
import assert from 'node:assert/strict';
import { lockInstant, isLockedAt, dayIsLocked, nextWatermark, sealRecord, lockKey } from '../src/tick-lock.js';
import { recordingOpen, partRecordable } from '../src/recording-window.js';
import { twoPrecedingFard, recoveryEligible, recoverableFards } from '../src/recovery.js';
import { preferredWindow, preferredState } from '../src/preferred-times.js';
import { migrateRecord } from '../src/history-migrate.js';
import { addDaysKey } from '../src/habits.js';
import { readText } from './helpers/read-text.js';

const H = 3600000;
const T0 = Date.UTC(2026, 10, 13, 0, 0, 0);
const at = h => new Date(T0 + h * H);
const ev = (kind, key, startH, endH) => ({ kind, key, dateKey: '2026-11-13', start: at(startH), end: at(endH) });
const DAY = [
  ev('fard', 'fajr', 5, 6.4),
  ev('voluntary', 'duha', 6.7, 11.5),
  ev('fard', 'dhuhr', 12, 15.2),
  ev('fard', 'asr', 15.4, 17.2),
  ev('fard', 'maghrib', 17.4, 18.6),
  ev('voluntary', 'awwabin', 17.4, 18.6),
  ev('fard', 'isha', 18.8, 29),
  ev('voluntary', 'witr', 18.8, 29),
  ev('fard', 'fajr', 29, 30.4),
  ev('fard', 'dhuhr', 36, 39)
];
const NEXT_FAJR = at(29);
const lockOf = (kind, key, prayer) => lockInstant({ kind, key, prayer }, DAY, NEXT_FAJR);

test('each Fard stays recordable through the next period and locks at the second following Fard', () => {
  const expect = { fajr: ['asr', 15.4], dhuhr: ['maghrib', 17.4], asr: ['isha', 18.8], maghrib: ['fajr', 29], isha: ['dhuhr', 36] };
  for (const [key, [by, hour]] of Object.entries(expect)) {
    const lock = lockOf('fard', key);
    assert.equal(lock.by, by, key);
    assert.equal(lock.at, at(hour).getTime(), key);
    const event = DAY.find(item => item.kind === 'fard' && item.key === key);
    assert.equal(recordingOpen(event.start, event.end, lock.at, at(hour - 0.001)), true, `${key} still open one millisecond before the lock`);
    assert.equal(recordingOpen(event.start, event.end, lock.at, at(hour)), false, `${key} locks exactly when the second following Fard begins`);
    assert.equal(recordingOpen(event.start, event.end, lock.at, new Date(event.end.getTime() + 1000)), true, `${key} delayed recording is still a normal record`);
    assert.equal(isLockedAt({ kind: 'fard', key }, DAY, NEXT_FAJR, lock.at - 1), false);
    assert.equal(isLockedAt({ kind: 'fard', key }, DAY, NEXT_FAJR, lock.at), true);
  }
});

test('a voluntary event between Fard prayers does not move the Fard lock, and uses the same second-Fard boundary', () => {
  assert.equal(lockOf('fard', 'fajr').by, 'asr', 'Duha between Fajr and Dhuhr is not a Fard boundary');
  assert.deepEqual(lockOf('voluntary', 'duha'), lockOf('fard', 'dhuhr') ? lockOf('voluntary', 'duha') : null);
  const duha = lockOf('voluntary', 'duha');
  assert.equal(duha.by, 'asr');
  assert.equal(lockOf('voluntary', 'awwabin').by, 'fajr');
  assert.equal(lockOf('voluntary', 'witr').by, 'dhuhr');
  assert.deepEqual(lockOf('sunnah', 'dhuhr_before', 'dhuhr'), lockOf('fard', 'dhuhr'));
  const dhuhr = DAY.find(item => item.key === 'dhuhr' && item.start.getTime() === at(12).getTime());
  assert.equal(partRecordable({ position: 'before', fardDone: false, start: dhuhr.start, end: dhuhr.end, now: at(16), lockAt: lockOf('fard', 'dhuhr').at }), true);
  assert.equal(partRecordable({ position: 'after', fardDone: true, start: dhuhr.start, end: dhuhr.end, now: at(16), lockAt: lockOf('fard', 'dhuhr').at }), true);
  assert.equal(partRecordable({ position: 'before', fardDone: true, start: dhuhr.start, end: dhuhr.end, now: at(16), lockAt: lockOf('fard', 'dhuhr').at }), false);
  assert.equal(partRecordable({ position: 'after', fardDone: false, start: dhuhr.start, end: dhuhr.end, now: at(13), lockAt: lockOf('fard', 'dhuhr').at }), false);
  assert.equal(partRecordable({ position: 'after', fardDone: true, start: dhuhr.start, end: dhuhr.end, now: at(17.4), lockAt: lockOf('fard', 'dhuhr').at }), false);
});

test('the prayer-day change does not close Isha before the next Dhuhr, and a restart keeps a seal', () => {
  assert.equal(dayIsLocked('2026-11-12', '2026-11-13'), false);
  const beforeDhuhr = nextWatermark(null, '2026-11-13', addDaysKey, false);
  assert.equal(beforeDhuhr, '2026-11-11');
  assert.equal(dayIsLocked('2026-11-12', '2026-11-13', beforeDhuhr), false);
  const afterDhuhr = nextWatermark(beforeDhuhr, '2026-11-13', addDaysKey, true);
  assert.equal(afterDhuhr, '2026-11-12');
  assert.equal(dayIsLocked('2026-11-12', '2026-11-13', afterDhuhr), true);
  const record = { fard: { isha: true }, voluntary: { witr: true }, sunnah: {}, nafl: {} };
  assert.equal(sealRecord(record, (layer, key) => ({ item: { kind: layer, key, prayer: key.split('_')[0] }, events: DAY, nextFajr: NEXT_FAJR }), at(30)), false, 'Isha is still open after the next Fajr');
  assert.equal(sealRecord(record, (layer, key) => ({ item: { kind: layer, key, prayer: key.split('_')[0] }, events: DAY, nextFajr: NEXT_FAJR }), at(36)), true);
  const restarted = migrateRecord(JSON.parse(JSON.stringify(record)));
  assert.equal(restarted.fard.isha, true);
  assert.equal(isLockedAt({ kind: 'fard', key: 'isha' }, DAY, NEXT_FAJR, at(20), !!restarted.locked[lockKey('fard', 'isha')]), true, 'a sealed lock survives restart even if the clock is set back');
  restarted.fard.isha = true;
  assert.equal(Object.keys(restarted.fard).filter(key => key === 'isha').length, 1, 'a second write does not create a duplicate record');
});

test('recovery needs both preceding Fard records and cannot take an open window', () => {
  const events = DAY.filter(item => item.kind === 'fard' && item.start.getTime() < at(29).getTime());
  const now = at(20);
  const preceding = twoPrecedingFard(events, now);
  assert.deepEqual(preceding.map(item => item.key), ['maghrib', 'asr']);
  const onlyOne = event => event.key === 'asr';
  assert.equal(recoveryEligible(preceding, onlyOne), false);
  assert.deepEqual(recoverableFards(events, now, { isRecorded: onlyOne, isLocked: () => true }), []);
  const both = event => event.key === 'maghrib' || event.key === 'asr';
  const isLocked = event => {
    const lockAt = lockInstant({ kind: 'fard', key: event.key }, DAY, NEXT_FAJR)?.at ?? null;
    if (recordingOpen(event.start, event.end, lockAt, now)) return false;
    return lockAt != null && now.getTime() >= lockAt;
  };
  const list = recoverableFards(events, now, { isRecorded: both, isLocked });
  assert.deepEqual(list.map(item => item.key), ['dhuhr', 'fajr']);
  assert.ok(!list.some(item => item.key === 'isha' || item.key === 'maghrib'), 'an open recording window is not recovered');
});

test('preferred time has upcoming, active and expired states and does not invent a window', () => {
  const start = at(12);
  const end = at(15);
  const pref = preferredWindow('dhuhr', start, end, 'hanafi');
  assert.equal(preferredState(pref, new Date(pref.start.getTime() - 1)), 'upcoming');
  assert.equal(preferredState(pref, pref.start), 'active');
  assert.equal(preferredState(pref, new Date(pref.end.getTime() - 1)), 'active');
  assert.equal(preferredState(pref, pref.end), 'expired');
  assert.equal(preferredState(null, start), 'none');
  assert.equal(preferredWindow('not-a-prayer', start, end, 'shafii'), null);
  const fajr = preferredWindow('fajr', at(5), at(6.4), 'shafii');
  const hanafi = preferredWindow('fajr', at(5), at(6.4), 'hanafi');
  assert.ok(fajr.start.getTime() < hanafi.start.getTime(), 'the earlier schools and Hanafi do not share one Fajr window');
});

test('the page wires summaries, preferred-time hiding, title versus countdown, and no Qada control', () => {
  const app = readText('../src/app.js', import.meta.url);
  const html = readText('../index.html', import.meta.url);
  assert.match(app, /if \(!record\[part\.layer\]\?\.\[part\.key\]\) continue/);
  assert.match(html, /Completion summaries/);
  assert.doesNotMatch(html, /Finished events|id="prayerDetails"|id="quranSection"|id="sunnahSection"|ISLAMIC HISTORY/);
  assert.match(app, /phase === 'none' \|\| phase === 'expired'/);
  assert.match(app, /best\.hidden = true/);
  assert.match(app, /classList\.toggle\('is-gold', phase === 'active'\)/);
  assert.match(app, /navigateToPrayerDescription\(nextPrayer\.key\)/);
  assert.match(app, /\$\('nextCountdownOpen'\)\.addEventListener\('click', openNextCountdown\)/);
  assert.match(app, /partRecordable\(\{ position: slot\.position, fardDone, start: parent\.start, end: parent\.end, now: new Date\(\), lockAt: partLock && partLock\.at \}\)/);
  assert.match(app, /if \(recordingOpen\(event\.start, event\.end, lockAt, now\)\) return false/);
  assert.doesNotMatch(app, /Qada|কাজা|qada/i);
  assert.match(html, /celestial\/sun\.png/);
  assert.match(html, /celestial\/moon\.png/);
  assert.match(html, /id="timeCards"/);
  assert.doesNotMatch(html, /id="descriptionList"/);
});
