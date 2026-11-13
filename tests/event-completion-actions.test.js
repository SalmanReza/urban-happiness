import test from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './helpers/read-text.js';
import { migrateRecord } from '../src/history-migrate.js';
import { mergeHistory } from '../src/backup.js';

const app = readText('../src/app.js', import.meta.url);
const css = readText('../src/styles.css', import.meta.url);

test('event cards expose Mark prayer event complete after the minimum tick and an Undo record action', () => {
  assert.match(app, /function eventMinimumComplete\(event/);
  assert.match(app, /if \(event\.kind === 'fard'\) return !!record\.fard\?\.\[event\.key\]/);
  assert.match(app, /return !!record\.voluntary\?\.\[event\.key\]/);
  assert.match(app, /Mark prayer event complete/);
  assert.match(app, /data-mark-event/);
  assert.match(app, /data-undo-event/);
  assert.match(app, /function undoPrayerEventRecord/);
  assert.match(app, /eventActionHtml\(event, dayRecord\(event\.date, false\)\)/);
  assert.match(app, /function bindEventRecordActions/);
  assert.match(app, /eventActionHtml\(\{ \.\.\.countdownState, date \}, record\)/);
  assert.match(css, /\.event-record-actions \{/);
});

test('explicit completion removes the event from live availability without requiring optional Sunnah/Nafl ticks', () => {
  assert.match(app, /record\.completedEvents\[\`\$\{kind\}:\$\{key\}\`\] = true/);
  assert.match(app, /if \(record\.completedEvents && Object\.prototype\.hasOwnProperty\.call\(record\.completedEvents, id\)\) return !!record\.completedEvents\[id\]/);
  assert.match(app, /filter\(event => !eventComplete\(event\)\)/);
  assert.match(app, /filter\(item => item\.lines\.length && eventComplete\(item\.event\)\)/);
  assert.match(app, /function eventMinimumComplete/);
});

test('voluntary cards have a main tick and situational cards have a completion tick and summary record', () => {
  assert.match(app, /data-live-kind="voluntary"/);
  assert.match(app, /data-situational-tick/);
  assert.match(app, /record\.situational\[key\] = true/);
  assert.match(app, /Situational prayer completed\./);
});

test('undo clears unlocked Fard, Sunnah and Nafl parts together while respecting existing locks', () => {
  assert.match(app, /kind === 'fard' \? eventParts\(\{ kind, key, date \}\)/);
  assert.match(app, /lockState\(part\.layer, part\.key, date\)\.locked/);
  assert.match(app, /delete record\.completedEvents\[\`\$\{kind\}:\$\{key\}\`\]/);
});

test('expanded clock page refreshes main and preferred countdowns every second', () => {
  assert.match(app, /if \(currentPage === 'time'\) updateTimeViewCountdown\(now\)/);
  assert.match(app, /function updateTimeViewCountdown/);
  assert.match(app, /id="timeMainCount"/);
  assert.match(app, /id="timePreferredCount"/);
  assert.match(app, /prefCard\.hidden = !pref \|\| phase === 'none' \|\| phase === 'expired'/);
});

test('new completion maps survive history migration and backup merging', () => {
  const record = migrateRecord({ fard: {}, voluntary: {}, situational: { istikhara: true }, completedEvents: { 'situational:istikhara': true } });
  assert.equal(record.situational.istikhara, true);
  assert.equal(record.completedEvents['situational:istikhara'], true);
  const merged = mergeHistory({ '2026-11-14': { fard: {}, voluntary: {}, situational: {}, completedEvents: {} } }, { '2026-11-14': { fard: {}, voluntary: {}, situational: { tawbah: true }, completedEvents: { 'situational:tawbah': true } } });
  assert.equal(merged.history['2026-11-14'].situational.tawbah, true);
  assert.equal(merged.history['2026-11-14'].completedEvents['situational:tawbah'], true);
  const legacyMerge = mergeHistory({ '2026-11-13': { fard: { fajr: true }, voluntary: { duha: true } } }, { '2026-11-13': { fard: {}, voluntary: {} } });
  assert.equal(Object.hasOwn(legacyMerge.history['2026-11-13'], 'completedEvents'), false, 'merging legacy records must not switch them into explicit-completion mode');
});
