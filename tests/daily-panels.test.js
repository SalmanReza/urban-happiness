import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readText } from './helpers/read-text.js';

const html = readText('../index.html', import.meta.url);
const app = readText('../src/app.js', import.meta.url);
const content = readText('../src/islamic-content.js', import.meta.url);
const matching = readText('../src/daily-content.js', import.meta.url);
const sound = readText('../src/sound.js', import.meta.url);

test('the home page does not show a Qur’an reader, history, or Sunnah section', () => {
  assert.doesNotMatch(html, /id="quranSection"/);
  assert.doesNotMatch(html, /id="quranReader"/);
  assert.doesNotMatch(html, /id="onThisDaySection"/);
  assert.doesNotMatch(html, /id="sunnahSection"/);
  assert.doesNotMatch(html, /SUNNAH & SEERAH/);
  assert.doesNotMatch(html, /ISLAMIC HISTORY/);
});

test('current Hijri date switches at local sunset when location data is available', () => {
  assert.match(app, /function islamicCalendarDateAt\(moment = new Date\(\)\)/);
  assert.match(app, /moment >= times\.maghrib \? addDays\(moment, 1\) : moment/);
  assert.match(app, /function currentHijriDate\(moment = new Date\(\)\)/);
});

test('Seerah, history and the Qur’an reader are not part of the application shell', () => {
  assert.doesNotMatch(app, /not a claim that the report occurred on this exact historical date/);
  assert.doesNotMatch(app, /historyItemsFor\(/);
  assert.doesNotMatch(app, /quranItemsFor\(/);
  assert.doesNotMatch(app, /function renderQuran|quran-verse|seerah-glimpses/);
  assert.doesNotMatch(html, /id="quranSection"|id="onThisDaySection"|id="sunnahSection"/);
});

test('historical reference tables remain available to the offline library tests and are not mounted', () => {
  assert.match(content, /export const ISLAMIC_HISTORY_EVENTS/);
  assert.match(content, /export const QURAN_REVELATION_RECORDS/);
  assert.match(matching, /nearestHijriEvents\(month, day, events\)/);
  assert.doesNotMatch(app, /ISLAMIC_HISTORY_EVENTS|QURAN_REVELATION_RECORDS|HIJRI_DAY_NOTES/);
});

test('completion sounds are short synthesized wooden ticks on a pentatonic set', () => {
  assert.match(app, /function playLayerSound\(layer, ticked, before, after\)/);
  assert.match(app, /playCues\(cues, state\.tickStyle, window\)/);
  assert.match(app, /if \(!state\.sound\) return;/);
  assert.match(sound, /PENTATONIC_TICK_HZ = Object\.freeze\(\[783\.99, 880\.0, 987\.77, 1174\.66, 1318\.51\]\)/);
  assert.match(sound, /band\.type = 'bandpass'/);
  assert.doesNotMatch(sound, /fetch\(|new Audio\(|\.mp3|\.wav|\.ogg/);
});

test('signature and copyright are present in the bottom-left corner', () => {
  assert.match(html, /class="copyright-signature copyright-corner" id="copyrightMark"/);
  assert.match(html, /© 2026–2027 Salman Reza Amit/);
  assert.match(app, /'Salman Reza Amit':'সালমান রেজা অমিত'/);
  assert.match(app, /mark\.textContent = copyrightText\(lang\(\)\)/);
});

test('prayer descriptions are grouped and keep exactly five obligatory cards', () => {
  assert.match(app, /keys: \['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'\]/);
  assert.match(app, /keys: \['duha', 'awwabin', 'qiyam', 'tahajjud', 'witr', 'rawatib'\]/);
  assert.match(app, /keys: \['tahiyyatul_masjid', 'istikhara', 'tawbah'\]/);
  assert.match(app, /seasonalDescriptionWindows/);
  assert.match(app, /daytimeHijriDateForNight/);
  assert.match(app, /id=\"description-\$\{key\}\"/);
  assert.doesNotMatch(html, /id="description-tarawih"/);
  assert.doesNotMatch(html, /id="description-eid_prayer"/);
});

test('v1.3.4: Weekly Prayer History is removed from the home page; Weekly Prayer Progress stays in Your Record', () => {
  const record = html.indexOf('YOUR RECORD');
  const progress = html.indexOf('Weekly Prayer Progress');
  assert.ok(record > 0 && record < progress);
  assert.equal(html.indexOf('Weekly Prayer History'), -1);
  assert.equal(html.indexOf('historyList'), -1);
  assert.doesNotMatch(readText('../src/app.js', import.meta.url), /renderHistory/, 'stored history data is untouched; only the old 7-day strip is gone');
  assert.equal(html.indexOf('LOCAL TIMETABLE'), -1, 'the home-page timetable is gone (moved to Settings in v1.3.3)');
  assert.doesNotMatch(html, /Weekly prayer rhythm/);
});
