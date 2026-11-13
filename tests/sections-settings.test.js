import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSections, SECTION_KEYS, CARD_KEYS, ALL_CARD_KEYS, sanitizeCards, tabVisible } from '../src/sections.js';
import { reminderRowVisible, isRamadan, isEidDay } from '../src/season.js';
import { readText } from './helpers/read-text.js';

const html = readText('../index.html', import.meta.url);
const app = readText('../src/app.js', import.meta.url);
const css = readText('../src/styles.css', import.meta.url);

test('v1.4.1 removes the home sections for descriptions, Qur’an, history and seerah without inventing new toggles', () => {
  assert.deepEqual(SECTION_KEYS, []);
  assert.deepEqual(sanitizeSections({ quran: false, descriptions: false }), {});
  assert.deepEqual(ALL_CARD_KEYS, []);
  assert.equal(tabVisible('quran', { quran: true }, {}), false);
  assert.equal(tabVisible('descriptions', { descriptions: true }, sanitizeCards()), false);
  assert.doesNotMatch(html, /id="prayerDetails"|id="descriptionList"|id="quranSection"|id="showDescriptionsToggle"|SUNNAH & SEERAH|ISLAMIC HISTORY|Finished events/);
  assert.match(app, /sections: \{\}/);
  assert.match(app, /sections: sanitizeSections\(saved\.sections\)/);
  assert.doesNotMatch(app, /function renderQuran|function renderOnThisDay|function renderPropheticDay|function renderQuranRevelation|seerah-glimpses|islamic-history/);
  assert.match(app, /function navigateToPrayerDescription/);
  assert.match(app, /eventInfo/);
  assert.match(css, /\.section-block\[hidden\] \{ display: none !important; \}/);
});

test('settings toggles are bilingual', () => {
  for (const text of ['Send test notification']) {
    assert.ok(html.includes(text), `${text} is in the HTML`);
    assert.ok(app.includes(`'${text}':'`), `${text} has a Bangla translation`);
  }
});

test('prayer information is one card opened from the event, not a home-page description section', () => {
  assert.equal((html.match(/id="prayerDetails"/g) || []).length, 0);
  assert.match(app, /keys: \['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'\]/);
  assert.match(app, /<section class="description-group"><h3>\$\{heading\}<\/h3><div class="ref-grid">/);
});

test('v1.4.1 per-card home toggles are gone; saved card junk is not revived', () => {
  assert.equal(ALL_CARD_KEYS.length, 0);
  assert.deepEqual(sanitizeCards({ daily: false, bogus: false }), {});
  assert.equal(Object.keys(CARD_KEYS).length, 0);
  assert.doesNotMatch(html, /data-card="/);
  assert.match(app, /cards: sanitizeCards\(saved\.cards\)/);
});

test('v1.3.4 reminder rows: Tarawih only in Ramadan, Eid prayer only on Eid days, everything else always; saved values untouched', () => {
  assert.ok(isRamadan({ month: 9, day: 12 }) && !isRamadan({ month: 8, day: 29 }) && !isRamadan(null));
  assert.ok(isEidDay({ month: 10, day: 1 }) && isEidDay({ month: 12, day: 10 }));
  assert.ok(!isEidDay({ month: 10, day: 2 }) && !isEidDay({ month: 12, day: 9 }));
  assert.equal(reminderRowVisible('tarawih', { month: 3, day: 1 }), false);
  assert.equal(reminderRowVisible('tarawih', { month: 9, day: 1 }), true);
  assert.equal(reminderRowVisible('eid_prayer', { month: 9, day: 1 }), false);
  assert.equal(reminderRowVisible('eid_prayer', { month: 10, day: 1 }), true);
  assert.equal(reminderRowVisible('fajr', { month: 3, day: 1 }), true);
  assert.match(app, /\.filter\(item => reminderRowVisible\(item\.key, hijriNow\)\)/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderEventReminderSettings'), app.indexOf('function renderEventReminderSettings') + 1500), /delete state\.reminders/, 'hiding a row never deletes the saved choice');
});
