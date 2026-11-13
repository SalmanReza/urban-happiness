import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredWindow } from '../src/preferred-times.js';

const start = new Date('2026-06-01T04:00:00Z');
const end = new Date('2026-06-01T06:00:00Z');

test('preferred windows stay inside the prayer and name the approximation', () => {
  for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'duha', 'witr', 'eid_prayer']) {
    const window = preferredWindow(key, start, end, 'hanafi', { eid: 'fitr' });
    assert.ok(window.start >= start && window.end <= end, key);
    assert.ok(window.end > window.start, key);
    assert.match(window.en, /approximation|already the last third|Jumu/i);
  }
});

test('Hanafi Fajr is later than the other schools, and a prayer with no window has none', () => {
  const hanafi = preferredWindow('fajr', start, end, 'hanafi');
  const shafii = preferredWindow('fajr', start, end, 'shafii');
  assert.ok(hanafi.start > shafii.start);
  assert.equal(preferredWindow('istikhara', start, end, 'hanafi'), null);
  assert.equal(preferredWindow('fajr', end, start, 'hanafi'), null);
});
