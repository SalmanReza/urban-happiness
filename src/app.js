import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TrayIcon } from '@tauri-apps/api/tray';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { calculatePrayerTimes, formatTime, dateKey, jafariMidnight, CALCULATION_METHODS, SCHOOLS, HIGH_LATITUDE_RULES, DEFAULT_PROFILE, sanitizeProfile, presetForSchool, isShiaProfile } from './prayer-engine.js';
import { parseCoordinates, isGoogleMapsUrl } from './location.js';
import { PRAYER_GUIDANCE } from './islamic-content.js';
import { weekStart, sevenCycleDates, weeklyFardTally, isFridayDhuhr, FRIDAY_DHUHR_LABEL, WEEK_DAY_LABELS, FRIDAY } from './weekly-cycle.js';
import { shortcutFor, pageScrollDistance, carouselArrowDelta } from './keyboard.js';
import { figureSvg, figureChanges, progressSummary } from './progress-figure.js';
import { slotLabel, slotShortLabel, fardPartLabel, prayerParts, FARD_RAKAHS, findSlot, layerState, splitVoluntary, isSeasonal } from './prayer-layers.js';
import { counterLabel, showsControls, stepIndex, reconcileIndex, wrapIndex } from './carousel.js';
import { playCues, soundCues, sanitizeTickStyle, DEFAULT_TICK_STYLE } from './sound.js';
import { trayTooltipText } from './tray-tooltip.js';
import { activeProhibition, PROHIBITED_LABELS, SUNRISE_PROHIBITED_MINUTES, SUNSET_PROHIBITED_MINUTES } from './forbidden-times.js';
import { parseReminderMinutes, sanitizeReminderMap, isReminderDue, preReminderFireAt, PRE_REMINDER_MAX } from './reminder-schedule.js';
import { APP_VERSION, copyrightText } from './branding.js';
import { UI_FONTS, DEFAULT_UI_FONT, sanitizeUiFont, uiFontStack, uiFontLabel } from './ui-fonts.js';
import { dayStatus } from './day-status.js';
import { reflectionFor } from './daily-reflections.js';
import { progressLine, recentIdsWithin, VOLUNTARY_HEADS_UP_MINUTES } from './progress-lines.js';
import { analyzeHabits, pickSuggestion, addDaysKey } from './habits.js';
import { lockInstant, dayIsLocked, nextWatermark, sealRecord, lockKey, lockTip } from './tick-lock.js';
import { recordingOpen, partRecordable, eventPlace } from './recording-window.js';
import { phraseLines, recognitionKey, recognitionSeconds } from './recognition.js';
import { twoPrecedingFard, recoveryEligible, recoverableFards, RECOVERY_CONFIRM } from './recovery.js';
import { parseBackup, splitBackup, mergeHistory } from './backup.js';
import { nextEclipse } from './eclipse.js';
import { migrateHistory } from './history-migrate.js';
import { sunPosition, moonPosition, moonPhase, phaseName, moonPass, passFraction, timeArcPoint, timeArcPath, skyColors, sunIntensity, moonLitPath, zoneSpans } from './sky.js';
import { preferredWindow, preferredState } from './preferred-times.js';
import { cardNote } from './prayer-card-notes.js';
import { evidenceFor, JAFARI_HIDDEN } from './prayer-evidence.js';
import { nextBoundary, needsRefresh, boundaryDelay } from './prayer-boundary.js';
import { buildTimeline, eventLabel } from './day-timeline.js';
import { nextPrayerEventAfter, activeIntervals } from './interval-rows.js';
import { cardCountdown } from './card-countdown.js';
import { sanitizeSections, sanitizeCards, tabVisible } from './sections.js';
import { reminderRowVisible } from './season.js';
import { prohibitedIntervals } from './forbidden-times.js';
import { formatClock, sanitizeClockFormat, DEFAULT_CLOCK_FORMAT } from './time-format.js';

const $ = id => document.getElementById(id);

const FARD = [
  { key: 'fajr', en: 'Fajr', bn: 'ফজর' },
  { key: 'dhuhr', en: 'Dhuhr', bn: 'যোহর' },
  { key: 'asr', en: 'Asr', bn: 'আসর' },
  { key: 'maghrib', en: 'Maghrib', bn: 'মাগরিব' },
  { key: 'isha', en: 'Isha', bn: 'ইশা' }
];

const THEMES = [
  ['Obsidian', 'dark', '#101719', '#192326', '#a9c6b5'],
  ['Midnight', 'dark', '#111a2a', '#1b2a40', '#9dbfe6'],
  ['Forest', 'dark', '#111c18', '#1c2b23', '#9bc8a7'],
  ['Burgundy', 'dark', '#21151b', '#30212a', '#d7a2b0'],
  ['Graphite', 'dark', '#191b1e', '#25292e', '#c9d0d4'],
  ['Porcelain', 'light', '#f2f3ef', '#ffffff', '#456b58'],
  ['Ivory', 'light', '#f3eee3', '#fffaf1', '#8a7046'],
  ['Mist Blue', 'light', '#edf3f7', '#ffffff', '#4d7397'],
  ['Sage', 'light', '#edf2eb', '#ffffff', '#52785b'],
  ['Rose', 'light', '#f5eeee', '#fffafa', '#95616b']
];

const VOLUNTARY = [
  { key: 'duha', en: 'Ishraq / Duha', bn: 'ইশরাক / দুহা', desc: 'Morning voluntary prayer after sunrise, before the Zawal interval.', rakahs: 'Commonly 2 or more rak‘ahs.' },
  { key: 'awwabin', en: 'Awwabin', bn: 'আওয়াবিন', desc: 'Voluntary prayer after Maghrib and before Isha. Terminology and recommended rak‘ahs differ among scholarly traditions.', rakahs: 'Commonly prayed in sets of 2.' },
  { key: 'qiyam', en: 'Qiyam al-Layl', bn: 'কিয়ামুল লাইল', desc: 'Voluntary night prayer after Isha and before Fajr.', rakahs: 'Prayed in sets of 2; no fixed maximum.' },
  { key: 'tahajjud', en: 'Tahajjud', bn: 'তাহাজ্জুদ', desc: 'Night prayer after sleep. This app highlights the final third of the night as a practical time window.', rakahs: 'Prayed in sets of 2.' },
  { key: 'tarawih', en: 'Tarawih', bn: 'তারাবিহ', desc: 'Night prayer during Ramadan, performed after Isha.', rakahs: 'Common Hanafi practice: 20 rak‘ahs.' },
  { key: 'eid_prayer', en: 'Eid prayer', bn: 'ঈদের নামাজ', desc: 'Special congregational prayer on Eid al-Fitr and Eid al-Adha.', rakahs: '2 rak‘ahs with additional takbirs according to the school.' },
  { key: 'witr', en: 'Witr', bn: 'বিতর', desc: 'The concluding odd-numbered prayer of the night; Hanafi practice treats it as wajib.', rakahs: '3 rak‘ahs in Hanafi practice.' },
  { key: 'rawatib', en: 'Sunnah Rawatib', bn: 'সুন্নাতে রাতিবাহ', desc: 'The regular Sunnah prayers associated with the five obligatory prayers. See the guidance section for the complete 12-rak‘ah arrangement.', rakahs: '12 regular Sunnah rak‘ahs across the day and night.' }
];

const REMINDER_VOLUNTARY = VOLUNTARY.filter(item => item.key !== 'rawatib');

const DEFAULTS = {
  // Location is deliberately unset on a fresh installation. The user must
  // supply a Google Maps link or enter coordinates; no device geolocation.
  lat: null,
  lon: null,
  place: '',
  theme: 'Obsidian',
  language: 'en',
  sound: true,
  tickStyle: DEFAULT_TICK_STYLE,
  // Calculation profile (v1.3.1). Default unchanged: Karachi 18°/18°, Hanafi Asr, no high-latitude rule.
  profile: { ...DEFAULT_PROFILE },
  // 24-hour (default, as before) or 12-hour, applied everywhere a time is shown.
  clock: DEFAULT_CLOCK_FORMAT,
  // Interface font id (see src/ui-fonts.js); 'system' is the unchanged v1.3.0 look.
  uiFont: DEFAULT_UI_FONT,
  notifications: false,
  reminders: {},
  preReminders: {},
  reminderSent: {},
  compact: false,
  startup: false,
  adjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  history: {},
  lockWatermark: null,
  // Home page sections that can be hidden in Settings (all shown by default). Hidden sections are not rendered.
  sections: {},
  cards: sanitizeCards(),
  recognitionPace: { sunnah: 2, nafl: 1 }
};

const saved = loadState() || {};
const state = {
  ...DEFAULTS,
  ...saved,
  adjustments: { ...DEFAULTS.adjustments, ...(saved.adjustments || {}) },
  history: migrateHistory(saved.history),
  lockWatermark: /^\d{4}-\d{2}-\d{2}$/.test(saved.lockWatermark || '') ? saved.lockWatermark : null,
  sections: sanitizeSections(saved.sections),
  cards: sanitizeCards(saved.cards),
  recognitionPace: {
    sunnah: Number(saved.recognitionPace?.sunnah) > 0 ? Number(saved.recognitionPace.sunnah) : 2,
    nafl: Number(saved.recognitionPace?.nafl) > 0 ? Number(saved.recognitionPace.nafl) : 1
  },
  reminders: saved.reminders && typeof saved.reminders === 'object' ? saved.reminders : {},
  reminderSent: saved.reminderSent && typeof saved.reminderSent === 'object' ? saved.reminderSent : {},
  // Minutes before each obligatory prayer begins (0/absent = off), validated 0–180.
  preReminders: sanitizeReminderMap(saved.preReminders, ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']),
  tickStyle: sanitizeTickStyle(saved.tickStyle),
  profile: sanitizeProfile(saved.profile),
  clock: sanitizeClockFormat(saved.clock),
  uiFont: sanitizeUiFont(saved.uiFont)
};
// v1.3.0: a Friday midday record stored under a legacy "jumuah" key also
// completes Dhuhr (records are copied, never removed).
for (const record of Object.values(state.history)) {
  if (record && record.fard && record.fard.jumuah && !record.fard.dhuhr) record.fard.dhuhr = true;
}
const savedLat = state.lat;
const savedLon = state.lon;
const hasSavedLocation = savedLat !== null && savedLat !== undefined && String(savedLat).trim() !== '' &&
  savedLon !== null && savedLon !== undefined && String(savedLon).trim() !== '' &&
  Number.isFinite(Number(savedLat)) && Number.isFinite(Number(savedLon)) &&
  Math.abs(Number(savedLat)) <= 90 && Math.abs(Number(savedLon)) <= 180;
if (hasSavedLocation) {
  state.lat = Number(savedLat);
  state.lon = Number(savedLon);
} else {
  state.lat = null;
  state.lon = null;
  state.place = '';
}

function hasLocation() {
  return Number.isFinite(state.lat) && Number.isFinite(state.lon) &&
    Math.abs(state.lat) <= 90 && Math.abs(state.lon) <= 180;
}

let selectedDate = startOfDay(new Date());
let currentTimes = null;
let liveTimes = null;
let nextPrayer = null;
let countdownState = null;
let currentPage = 'home';
let homeScrollTop = 0;
let toastHandle = null;
let lastNotificationCheck = 0;
let tickHandle = null;
let renderHandle = null;
let sentNotifications = new Set();
let lastScheduleDate = dateKey(new Date());

const gearIcon = $('settingsToggle').innerHTML;
const homeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.6 12 3l9 7.6v9.1a1.3 1.3 0 0 1-1.3 1.3h-5.2v-6.1h-5v6.1H4.3A1.3 1.3 0 0 1 3 19.7z"/></svg>';

function loadState() {
  try { return JSON.parse(localStorage.getItem('prayer-times-data') || '{}'); }
  catch { return {}; }
}

function save() {
  try { localStorage.setItem('prayer-times-data', JSON.stringify(state)); }
  catch { showToast('Could not save local data. Check available disk space.'); }
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, amount) {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function addMinutes(date, amount) {
  return new Date(date.getTime() + amount * 60000);
}

function dayRecord(date = selectedDate, create = true) {
  const key = dateKey(date);
  if (!state.history[key] && create) state.history[key] = { fard: {}, voluntary: {} };
  return state.history[key] || { fard: {}, voluntary: {} };
}

function lang() { return state.language === 'bn' ? 'bn' : 'en'; }
function text(item) { return item[lang()] || item.en || item.key; }
function fmt(date) { return formatClock(date, { lang: lang(), clock: state.clock }); }
function prayerName(key) { const extra = { jumuah: { en: 'Jumu’ah', bn: 'জুমুআ' }, tahiyyatul_masjid: { en: 'Tahiyyat al-Masjid', bn: 'তাহিয়্যাতুল মসজিদ' }, istikhara: { en: 'Salat al-Istikhara', bn: 'সালাতুল ইস্তিখারা' }, tawbah: { en: 'Salat al-Tawbah', bn: 'নামাজুত তওবা' } }; return text(FARD.find(item => item.key === key) || VOLUNTARY.find(item => item.key === key) || extra[key] || { en: key, bn: key }); }
/* Friday's midday slot reads "Dhuhr/Jumu’ah" everywhere: either prayer completes it. */
function slotName(key, date) {
  return isFridayDhuhr(key, date) ? FRIDAY_DHUHR_LABEL[lang()] : prayerName(key);
}
function dayName(date) {
  return new Intl.DateTimeFormat(lang() === 'bn' ? 'bn-BD' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(date);
}
function pad(value) { return String(value).padStart(2, '0'); }
function countdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const value = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map(pad).join(':');
  return lang() === 'bn' ? localizeDigits(value) : value;
}
/* v1.3.4: header subtitle "Location: 23.8103, 90.4125" (Bangla: "অবস্থান: ২৩.৮১০৩, ৯০.৪১২৫") */
function locationSubtitle() {
  const coords = `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`;
  return lang() === 'bn' ? `অবস্থান: ${localizeDigits(coords)}` : `Location: ${coords}`;
}
function localizeDigits(value) { return String(value).replace(/[0-9]/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]); }
function setTranslatedText(id, message) {
  $(id).textContent = message;
  translateRenderedText();
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = lang()==='bn' ? (BN_TEXT[message] || message.replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])) : message;
  toast.classList.add('show');
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => toast.classList.remove('show'), 2400);
}

function applyUiFont() {
  document.documentElement.style.setProperty('--ui-font', uiFontStack(state.uiFont));
}

function renderUiFontSelect() {
  const select = $('uiFontSelect');
  if (!select) return;
  select.innerHTML = UI_FONTS.map(font => `<option value="${font.id}">${escapeHtml(uiFontLabel(font.id, lang()))}</option>`).join('');
  select.value = state.uiFont;
}

function applyTheme() {
  applyUiFont();
  const theme = THEMES.find(item => item[0] === state.theme) || THEMES[0];
  const root = document.documentElement;
  root.style.setProperty('--bg', theme[2]);
  root.style.setProperty('--surface', theme[3]);
  root.style.setProperty('--surface2', theme[2]);
  root.style.setProperty('--accent', theme[4]);
  root.style.setProperty('--accent2', theme[3]);
  root.style.setProperty('--text', theme[1] === 'dark' ? '#f0f3ef' : '#202823');
  root.style.setProperty('--muted', theme[1] === 'dark' ? '#9daaa6' : '#6f7c74');
  root.style.setProperty('--line', theme[1] === 'dark' ? '#303d3c' : '#d9e0da');
  root.style.setProperty('--good', theme[1] === 'dark' ? '#5dbb83' : '#27854f');
  root.style.setProperty('--gold', theme[1] === 'dark' ? '#c8a86a' : '#a78240');
  document.body.dataset.mode = theme[1];
  document.documentElement.style.colorScheme = theme[1];
  $('themeSelect').value = state.theme;
}

function setLanguage() {
  document.documentElement.lang = lang();
  $('locationLabel').textContent = hasLocation() ? locationSubtitle() : (lang() === 'bn' ? 'অবস্থান নির্ধারণ করুন' : 'Location not set');
  $('timezoneLabel').textContent = `${Intl.DateTimeFormat().resolvedOptions().timeZone || (lang()==='bn'?'ডিভাইসের স্থানীয় সময়':'Device local time')} · ${new Intl.DateTimeFormat('en', { timeZoneName: 'longOffset' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC') || ''}`;
  $('dateLabel').textContent = dayName(new Date());
  const hijriDate = new Intl.DateTimeFormat(lang()==='bn'?'bn-BD':'en-GB-u-ca-islamic-umalqura', {day:'numeric',month:'long',year:'numeric',calendar:'islamic-umalqura'}).format(islamicCalendarDateAt(new Date()));
  $('hijriDateLabel').textContent = hijriDate;
  $('selectedDay').textContent = dateKey(selectedDate) === dateKey(new Date()) ? (lang() === 'bn' ? 'আজ' : 'Today') : dayName(selectedDate);
  const mark = $('copyrightMark');
  if (mark) mark.textContent = copyrightText(lang());
}

const shiaMode = () => isShiaProfile(state.profile);
const SCHOOL_SHORT = { hanafi: 'Hanafi', shafii: 'Shafi‘i', maliki: 'Maliki', hanbali: 'Hanbali', jafari: 'Ja‘fari' };

function profileOptions(date) {
  // Umm al-Qura's Ramadan Isha (120 min) applies to nights that belong to Ramadan.
  return { ...state.profile, ramadan: hijriParts(addDays(date, 1))?.month === 9 };
}

function getTimes(date) {
  if (!Number.isFinite(state.lat) || !Number.isFinite(state.lon)) return null;
  const times = calculatePrayerTimes(date, state.lat, state.lon, -date.getTimezoneOffset(), profileOptions(date));
  for (const key of Object.keys(state.adjustments)) {
    if (times[key] instanceof Date) times[key] = addMinutes(times[key], Number(state.adjustments[key]) || 0);
  }
  // Keep solar noon/Zawal derived from true solar noon, not the adjusted Dhuhr display time.
  times.zawalStart = addMinutes(times.solarNoon, -6);
  times.zawalEnd = addMinutes(times.solarNoon, 6);
  times.dhuhr = addMinutes(times.zawalEnd, Number(state.adjustments.dhuhr) || 0);
  if (shiaMode()) {
    // Ja'fari: Isha ends at midnight, halfway between sunset and the next Fajr.
    const nextDay = addDays(date, 1);
    const next = calculatePrayerTimes(nextDay, state.lat, state.lon, -nextDay.getTimezoneOffset(), profileOptions(nextDay));
    const nextFajr = addMinutes(next.fajr, Number(state.adjustments.fajr) || 0);
    times.midnight = jafariMidnight(times.sunset, nextFajr);
  }
  return times;
}

function hijriParts(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(date);
    return {
      day: Number(parts.find(part => part.type === 'day')?.value),
      month: Number(parts.find(part => part.type === 'month')?.value),
      year: Number(parts.find(part => part.type === 'year')?.value)
    };
  } catch { return null; }
}

function islamicCalendarDateAt(moment = new Date()) {
  const times = getTimes(startOfDay(moment));
  // Umm al-Qura Intl labels civil dates from midnight. The Hijri date changes
  // at sunset, so after Maghrib use the following civil date as the night date.
  return times?.maghrib && moment >= times.maghrib ? addDays(moment, 1) : moment;
}

function currentHijriDate(moment = new Date()) {
  return hijriParts(islamicCalendarDateAt(moment));
}

function occasionFor(date) {
  const hijri = hijriParts(date);
  if (!hijri) return null;
  const events = {
    '1-1': ['Islamic New Year', 'Start of Muharram'],
    '1-9': ['Day before Ashura (Tasu’a)', '9 Muharram'],
    '1-10': ['Day of Ashura', '10 Muharram'],
    '3-12': ['Mawlid an-Nabi', 'Observance varies among Muslim communities'],
    '7-27': ['Isra and Mi’raj', '27 Rajab'],
    '8-15': ['Mid-Sha’ban', '15 Sha’ban'],
    '9-1': ['Start of Ramadan', 'The month of fasting'],
    '9-17': ['Battle of Badr', '17 Ramadan'],
    '9-27': ['Laylat al-Qadr (commonly observed)', 'The Night of Decree; the exact night is not fixed'],
    '10-1': ['Eid al-Fitr', '1 Shawwal'],
    '12-9': ['Day of Arafah', '9 Dhul Hijjah'],
    '12-10': ['Eid al-Adha', '10 Dhul Hijjah']
  };
  const exact = events[`${hijri.month}-${hijri.day}`];
  if (exact) return exact;
  if (hijri.month === 9 && hijri.day >= 21) return ['Last ten nights of Ramadan', 'Seek Laylat al-Qadr in the odd-numbered nights'];
  if (hijri.month === 12 && hijri.day <= 10) return ['First ten days of Dhul Hijjah', 'Among the most significant days of the Islamic year'];
  if (hijri.day >= 13 && hijri.day <= 15) return ['White Days', '13th–15th of the lunar month'];
  return null;
}

function daytimeHijriDateForNight(ishaTime) {
  // The night after sunset belongs to the following daytime Hijri date.
  return hijriParts(addDays(ishaTime, 1));
}

function isRamadanNight(ishaTime) {
  return daytimeHijriDateForNight(ishaTime)?.month === 9;
}

function getVoluntaryEvents(date, times = getTimes(date), nextTimes = getTimes(addDays(date, 1))) {
  if (!times || !nextTimes) return [];
  const nightEnd = nextTimes.fajr;
  const nightDuration = nightEnd.getTime() - times.maghrib.getTime();
  const events = [
    {
      key: 'duha', kind: 'voluntary', start: addMinutes(times.sunrise, 20), end: times.zawalStart,
      desc: VOLUNTARY.find(item => item.key === 'duha').desc
    },
    {
      key: 'awwabin', kind: 'voluntary', start: times.maghrib, end: times.isha,
      desc: VOLUNTARY.find(item => item.key === 'awwabin').desc
    },
    {
      key: 'qiyam', kind: 'voluntary', start: times.isha, end: nightEnd,
      desc: VOLUNTARY.find(item => item.key === 'qiyam').desc
    },
    {
      key: 'tahajjud', kind: 'voluntary', start: new Date(nightEnd.getTime() - nightDuration / 3), end: nightEnd,
      desc: VOLUNTARY.find(item => item.key === 'tahajjud').desc
    },
    { key: 'witr', kind: 'voluntary', start: times.isha, end: nightEnd, desc: VOLUNTARY.find(item => item.key === 'witr').desc }
  ];
  if (isRamadanNight(times.isha)) {
    events.push({ key: 'tarawih', kind: 'voluntary', start: times.isha, end: nightEnd, desc: VOLUNTARY.find(item => item.key === 'tarawih').desc });
  }
  const hijri = hijriParts(date);
  if (hijri && ((hijri.month === 10 && hijri.day === 1) || (hijri.month === 12 && hijri.day === 10))) {
    events.push({ key: 'eid_prayer', kind: 'voluntary', start: addMinutes(times.sunrise, 20), end: times.zawalStart, eid: hijri.month === 10 ? 'fitr' : 'adha', desc: VOLUNTARY.find(item => item.key === 'eid_prayer').desc });
  }
  // Ja'fari mode: Duha, Awwabin and congregational Tarawih are not part of
  // Ja'fari practice, so they are not scheduled; the night prayer, Witr and Eid stay.
  const excluded = shiaMode() ? SHIA_EXCLUDED_VOLUNTARY : [];
  return events.filter(event => event.end > event.start && !excluded.includes(event.key)).map(event => ({ ...event, date: startOfDay(date) }));
}

const SHIA_EXCLUDED_VOLUNTARY = ['duha', 'awwabin', 'tarawih'];

function getFardEvents(date, times = getTimes(date), nextTimes = getTimes(addDays(date, 1))) {
  if (!times || !nextTimes) return [];
  return [
    { key: 'fajr', kind: 'fard', date, start: times.fajr, end: times.sunrise },
    { key: 'dhuhr', kind: 'fard', date, start: times.dhuhr, end: times.asr },
    { key: 'asr', kind: 'fard', date, start: times.asr, end: times.maghrib },
    { key: 'maghrib', kind: 'fard', date, start: times.maghrib, end: times.isha },
    { key: 'isha', kind: 'fard', date, start: times.isha, end: times.midnight && times.midnight > times.isha ? times.midnight : nextTimes.fajr }
  ];
}

function prayerDayEvents(now = new Date()) {
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const todayTimes = getTimes(today);
  const yesterdayTimes = getTimes(yesterday);
  const tomorrowTimes = getTimes(tomorrow);
  if (!todayTimes || !tomorrowTimes) return [];
  let events = [];
  if (now < todayTimes.fajr && yesterdayTimes) {
    events = events.concat(getFardEvents(yesterday, yesterdayTimes, todayTimes));
    events = events.concat(getVoluntaryEvents(yesterday, yesterdayTimes, todayTimes));
  } else {
    events = events.concat(getFardEvents(today, todayTimes, tomorrowTimes));
    events = events.concat(getVoluntaryEvents(today, todayTimes, tomorrowTimes));
  }
  return events.sort((a, b) => a.start - b.start);
}

function getActiveEvents(now = new Date()) {
  return prayerDayEvents(now).filter(event => now >= event.start && now < event.end);
}

function eventParts(event) {
  if (event.kind !== 'fard' || shiaMode()) return [{ layer: event.kind, key: event.key, position: 'single' }];
  return prayerParts(event.key).map(part => part.layer === 'fard'
    ? { layer: 'fard', key: event.key, position: 'fard' }
    : { layer: part.layer, key: part.slot.key, position: part.slot.position });
}

function eventComplete(event) {
  const record = dayRecord(event.date, false);
  const id = `${event.kind}:${event.key}`;
  if (record.completedEvents && Object.prototype.hasOwnProperty.call(record.completedEvents, id)) return !!record.completedEvents[id];
  // Backward compatibility: older records did not have an explicit completion action.
  return eventParts(event).every(part => !!record[part.layer]?.[part.key]);
}

function eventHasRecord(event, record = dayRecord(event.date, false)) {
  if (event.kind === 'fard') return eventParts(event).some(part => !!record[part.layer]?.[part.key]);
  if (event.kind === 'situational') return !!record.situational?.[event.key];
  return !!record.voluntary?.[event.key];
}

function eventMinimumComplete(event, record = dayRecord(event.date, false)) {
  if (event.kind === 'fard') return !!record.fard?.[event.key];
  if (event.kind === 'situational') return !!record.situational?.[event.key];
  return !!record.voluntary?.[event.key];
}

function eventActionHtml(event, record, { compact = false } = {}) {
  const bn = lang() === 'bn';
  const id = `${event.kind}:${event.key}`;
  const done = !!record.completedEvents?.[id];
  const minimum = eventMinimumComplete(event, record);
  const hasRecord = eventHasRecord(event, record);
  const lock = event.kind === 'situational' ? { locked: false } : lockState(event.kind, event.key, event.date);
  const undoDisabled = lock.locked ? ' disabled title="Recording is locked"' : '';
  return `<div class="event-record-actions${compact ? ' compact' : ''}">${minimum && !done ? `<button type="button" class="mark-event-complete" data-mark-event="${id}" data-mark-date="${dateKey(event.date)}">${bn ? 'নামাজের ইভেন্ট সম্পন্ন' : 'Mark prayer event complete'}</button>` : ''}${hasRecord || done ? `<button type="button" class="undo-event-record" data-undo-event="${id}" data-undo-date="${dateKey(event.date)}"${undoDisabled}>${bn ? 'রেকর্ড বাতিল' : 'Undo record'}</button>` : ''}</div>`;
}

function ensureCompletedEventMap(date, record = dayRecord(date)) {
  if (!record.completedEvents || typeof record.completedEvents !== 'object') record.completedEvents = {};
  return record.completedEvents;
}

function markPrayerEventComplete(kind, key, dateText) {
  const date = parseDateKey(dateText);
  if (!date) return;
  const event = kind === 'situational' ? { kind, key, date } : findRecordableEvent(kind, key, date);
  if (!event) return;
  const record = dayRecord(date);
  if (!eventMinimumComplete(event, record)) { showToast('Complete the main prayer tick first.'); return; }
  ensureCompletedEventMap(date, record);
  record.completedEvents[`${kind}:${key}`] = true;
  save(); render();
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function undoPrayerEventRecord(kind, key, dateText) {
  const date = parseDateKey(dateText);
  if (!date) return;
  const record = dayRecord(date, false);
  const before = dayLayers(date);
  const parts = kind === 'fard' ? eventParts({ kind, key, date }) : [{ layer: kind, key }];
  let changed = false;
  for (const part of parts) {
    if (!record[part.layer]?.[part.key] || (kind !== 'situational' && lockState(part.layer, part.key, date).locked)) continue;
    delete record[part.layer][part.key];
    if (record.at) delete record.at[`${part.layer}:${part.key}`];
    changed = true;
  }
  if (!changed) { showToast('This prayer record is locked.'); return; }
  if (record.completedEvents) delete record.completedEvents[`${kind}:${key}`];
  save();
  if (kind !== 'situational') playLayerSound(layerOf(kind, key), false, before, dayLayers(date));
  render();
}

function findRecordableEvent(kind, key, date) {
  const times = getTimes(date);
  const next = getTimes(addDays(date, 1));
  if (!times || !next) return null;
  const events = kind === 'fard' ? getFardEvents(date, times, next) : [...getVoluntaryEvents(date, times, next), ...getFardEvents(date, times, next)];
  return events.find(event => event.kind === kind && event.key === key) || null;
}

function summaryLines(event) {
  const record = dayRecord(event.date, false);
  const bn = lang() === 'bn';
  const lines = [];
  for (const part of eventParts(event)) {
    if (!record[part.layer]?.[part.key]) continue;
    if (part.layer === 'fard' || part.position === 'fard') {
      const n = FARD_RAKAHS[event.key];
      lines.push(bn ? `ফরজ: ${n ? localizeDigits(n) + ' রাকাত সম্পন্ন।' : 'সম্পন্ন।'}` : `Fard: ${n ? n + " Rak'ahs completed." : 'completed.'}`);
    } else if (part.layer === 'voluntary' || part.position === 'single') {
      const guide = PRAYER_GUIDANCE[event.key];
      const detail = guide ? (bn ? guide.bn : guide.rakahs) : '';
      lines.push(bn ? `নফল: সম্পন্ন।${detail ? ' ' + detail : ''}` : `Voluntary: completed.${detail ? ' ' + detail : ''}`);
    } else {
      const slot = findSlot(part.layer, part.key);
      const label = slot ? slotShortLabel(slot, event.date, bn ? 'bn' : 'en') : part.key;
      const name = part.layer === 'sunnah' ? (bn ? 'সুন্নাত' : 'Sunnah') : (bn ? 'নফল' : 'Nafl');
      lines.push(bn ? `${name}: ${label} সম্পন্ন।` : `${name}: ${label} completed.`);
    }
  }
  return lines;
}

function renderCompletedToday() {
  const box = $('completedToday');
  if (!box) return;
  const bn = lang() === 'bn';
  const events = prayerDayEvents(new Date());
  const cards = events.map(event => ({ event, lines: summaryLines(event) })).filter(item => item.lines.length && eventComplete(item.event));
  const todayRecord = dayRecord(progressDate(new Date()), false);
  for (const [key, done] of Object.entries(todayRecord.situational || {})) if (done && todayRecord.completedEvents?.[`situational:${key}`]) cards.push({ event: { kind: 'situational', key, date: progressDate(new Date()) }, lines: [lang() === 'bn' ? 'পরিস্থিতিভিত্তিক নামাজ সম্পন্ন।' : 'Situational prayer completed.'] });
  const count = $('completedCount');
  if (count) count.textContent = bn ? localizeDigits(cards.length) : String(cards.length);
  if (!cards.length) {
    box.innerHTML = `<div class="live-empty"><span class="empty-mark">✦</span><div><strong>${bn ? 'আজ এখনো কোনো অংশ রেকর্ড হয়নি।' : 'Nothing has been recorded yet today.'}</strong><small>${bn ? 'শুধু যে অংশে টিক পড়েছে, সেটিই দেখা যাবে।' : 'Only parts with an actual tick are shown.'}</small></div></div>`;
    return;
  }
  box.innerHTML = cards.map(({ event, lines }) => `<article class="completed-card summary-card"><button class="prayer-name-button" type="button" data-completed-info="${event.key}">${escapeHtml(slotName(event.key, event.date))}</button><ul class="summary-lines">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${eventActionHtml(event, dayRecord(event.date, false))}</article>`).join('');
  bindEventRecordActions(box);
  box.querySelectorAll('[data-completed-info]').forEach(button => button.addEventListener('click', () => navigateToPrayerDescription(button.dataset.completedInfo)));
}

function renderEclipse() {
  const card = $('eclipseCard');
  if (!card) return;
  if (!hasLocation()) { card.hidden = true; return; }
  const hit = nextEclipse(new Date(), state.lat, state.lon, 24);
  card.hidden = !hit;
  if (!hit) return;
  const bn = lang() === 'bn';
  const name = hit.kind === 'solar' ? (bn ? 'সূর্যগ্রহণ' : 'Solar eclipse') : (bn ? 'চন্দ্রগ্রহণ' : 'Lunar eclipse');
  const note = bn
    ? 'আনুমানিক হিসাব, পঞ্জিকার সঙ্গে মেলানো হয়নি। ইবাদতের আগে একটি নির্ভরযোগ্য সূত্র দেখে নিন।'
    : 'Approximate only. Not checked against an almanac. Confirm with a published source before worship.';
  card.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${escapeHtml(fmt(hit.at))} · ${escapeHtml(note)}</span>`;
}

function getAllFardForDate(date) {
  const times = getTimes(date);
  const nextTimes = getTimes(addDays(date, 1));
  return getFardEvents(date, times, nextTimes);
}

function getNextPrayer(now = new Date()) {
  const today = startOfDay(now);
  const todayTimes = getTimes(today);
  const tomorrow = addDays(today, 1);
  const tomorrowTimes = getTimes(tomorrow);
  if (!todayTimes || !tomorrowTimes) return null;
  const events = getFardEvents(today, todayTimes, tomorrowTimes).concat(getFardEvents(tomorrow, tomorrowTimes, getTimes(addDays(tomorrow, 1))));
  return events.find(event => event.start > now) || null;
}

function shiftDay(delta) {
  selectedDate = addDays(selectedDate, delta);
  render();
}

const ORIGINAL_TEXT = new WeakMap();
const LAST_TRANSLATED_TEXT = new WeakMap();
const BN_TEXT = {
  'NEXT PRAYER':'পরবর্তী নামাজ','NEXT EVENT':'এরপর যা আসছে','SUNNAH & SEERAH':'সুন্নাহ ও সীরাত','The countdown to the next event begins at the displayed local time.':'এরপরের সময়ের কাউন্টডাউন দেখানো স্থানীয় সময়ে শুরু হবে।','TODAY\'S PROGRESS':'আজকের অগ্রগতি','AVAILABLE RIGHT NOW':'এখন যা পড়া যায়','Prayer events':'এখনকার নামাজ','Mark a prayer after its time begins':'ওয়াক্ত শুরু হলে নামাজ পড়ে টিক দিন','THE FIVE OBLIGATORY PRAYERS':'পাঁচ ওয়াক্ত ফরজ নামাজ','Daily prayers':'দৈনিক নামাজ','ADDITIONAL WORSHIP':'অতিরিক্ত ইবাদত','Voluntary prayers':'নফল নামাজ','ISLAMIC HISTORY':'ইসলামের ইতিহাস','On this day':'আজকের দিনে','Hijri calendar':'হিজরি ক্যালেন্ডার','SEVEN-DAY REVIEW':'সাত দিনের পর্যালোচনা','Weekly Prayer History':'সাপ্তাহিক নামাজের ইতিহাস','Weekly Prayer Progress':'সাপ্তাহিক নামাজের অগ্রগতি','Friday to Thursday':'শুক্রবার থেকে বৃহস্পতিবার','Saturday to Friday':'শনিবার থেকে শুক্রবার','REFERENCE':'নির্দেশিকা','Prayer descriptions':'নামাজের বিবরণ','YOUR RECORD':'আপনার রেকর্ড','Prayer history':'নামাজের ইতিহাস','Stored on this device':'এই ডিভাইসে সংরক্ষিত','PREFERENCES':'পছন্দসমূহ','Settings':'সেটিংস','Your configuration is saved locally on this device.':'আপনার সেটিংস এই ডিভাইসেই সংরক্ষিত হয়।','YOUR LOCATION':'আপনার অবস্থান','Prayer location':'নামাজের অবস্থান','On-device':'ডিভাইসে সংরক্ষিত','Use a Google Maps share link or enter coordinates manually. No login or automatic location detection is used.':'Google Maps শেয়ার লিংক দিন অথবা স্থানাঙ্ক লিখুন। লগইন বা স্বয়ংক্রিয় অবস্থান শনাক্তকরণ ব্যবহৃত হয় না।','Google Maps sharing link':'Google Maps শেয়ার লিংক','Use link':'লিংক ব্যবহার করুন','Save location':'অবস্থান সংরক্ষণ','APPEARANCE':'চেহারা','Personalise Prayer Times':'অ্যাপের চেহারা','Colour theme':'রঙের থিম','Compact desktop mode':'কমপ্যাক্ট ডেস্কটপ মোড','Language':'ভাষা','Bangla prayer names and digits':'বাংলা নাম ও সংখ্যা','TIME ADJUSTMENTS':'সময়ের সমন্বয়','Fine-tune local timings':'স্থানীয় সময় সূক্ষ্মভাবে সমন্বয়','WINDOWS INTEGRATION':'উইন্ডোজ সংযোগ','Desktop behaviour':'ডেস্কটপ আচরণ','YOUR DATA':'আপনার তথ্য','Private by default':'ডিফল্টভাবে ব্যক্তিগত','Export backup':'ব্যাকআপ রপ্তানি','Reset local data':'স্থানীয় তথ্য মুছুন','Back to prayers':'নামাজের পাতায় ফিরুন','Completed':'সম্পন্ন','Obligatory prayer':'ফরজ নামাজ','Voluntary':'নফল','OBLIGATORY':'ফরজ','VOLUNTARY':'নফল','TIME LEFT':'বাকি সময়','No prayer event is currently in its time window.':'এই মুহূর্তে কোনো নামাজের নির্ধারিত সময় চলছে না।','Prayer times are unavailable.':'নামাজের সময় পাওয়া যায়নি।','No additional voluntary prayer period is scheduled for this date.':'এই তারিখে অতিরিক্ত নফল নামাজের সময় নির্ধারিত নেই।','Keep going':'চালিয়ে যান','Good Job!':'চমৎকার!','Great Job!':'অসাধারণ!','Sunrise':'সূর্যোদয়','Zawal exclusion':'জাওয়ালের নিষিদ্ধ সময়','Fard':'ফরজ','Previous day':'আগের দিন','Next day':'পরের দিন','Start Prayer Times when Windows starts':'উইন্ডোজ চালু হলে প্রেয়ার টাইমস চালু করুন','Enable Windows prayer notifications':'উইন্ডোজে নামাজের বিজ্ঞপ্তি চালু করুন','Play a short pentatonic sound when a prayer is marked complete':'নামাজ সম্পন্ন করলে ছোট পেন্টাটনিক সুর বাজান','Start Prayer Times when Windows starts':'উইন্ডোজ চালু হলে অ্যাপ চালু করুন','Calculation profile':'হিসাবের প্রোফাইল','Show details':'বিস্তারিত দেখুন','Calculation method':'হিসাবের পদ্ধতি','Asr method':'আসরের পদ্ধতি','Time zone':'সময় অঞ্চল','Device':'ডিভাইস','Zawal exclusion':'জাওয়ালের নিষিদ্ধ সময়','Your location':'আপনার অবস্থান','Latitude':'অক্ষাংশ','Longitude':'দ্রাঘিমাংশ','Place name':'স্থানের নাম','Save location':'অবস্থান সংরক্ষণ','Fine-tune local timings':'স্থানীয় সময় সমন্বয় করুন','Export backup':'ব্যাকআপ রপ্তানি','Reset local data':'স্থানীয় তথ্য মুছুন','Prayer reminders disabled':'নামাজের বিজ্ঞপ্তি বন্ধ','Prayer reminders enabled':'নামাজের বিজ্ঞপ্তি চালু','Location saved':'অবস্থান সংরক্ষিত','Saved location':'সংরক্ষিত অবস্থান','Current:':'বর্তমান:','Begins in':'শুরু হতে বাকি','Time remaining':'বাকি সময়','This prayer period has ended':'এই নামাজের সময় শেষ হয়েছে','All five obligatory prayers and every voluntary event for today are complete.':'আজকের পাঁচ ওয়াক্ত ফরজ ও সব নফল নামাজ সম্পন্ন হয়েছে।','Prayer Times':'নামাজের সময়','Fajr':'ফজর','Dhuhr':'যোহর','Asr':'আসর','Maghrib':'মাগরিব','Isha':'ইশা','Sunset':'সূর্যাস্ত','Obligatory':'ফরজ','Prayer times are calculated on this device':'নামাজের সময় এই ডিভাইসেই হিসাব করা হয়','Complete the five obligatory prayers to earn your daily achievement.':'দৈনিক লক্ষ্য পূরণে পাঁচ ওয়াক্ত ফরজ নামাজ আদায় করুন।','Time until the next prayer':'পরবর্তী নামাজের বাকি সময়','Calculated on this device · Prayer records stay on this device':'এই ডিভাইসে হিসাব করা হয় · নামাজের রেকর্ড এই ডিভাইসেই থাকে','Expanded Google Maps links with coordinates work offline. Shortened share links cannot be expanded offline; copy coordinates from Maps or enter them below.':'স্থানাঙ্কসহ Google Maps লিংক অফলাইনে পড়া যায়। সংক্ষিপ্ত লিংক অফলাইনে খোলা যায় না; Maps থেকে স্থানাঙ্ক কপি করে লিখুন।','Currently saved location':'বর্তমানে সংরক্ষিত অবস্থান','University of Islamic Sciences, Karachi · Fajr 18° / Isha 18°':'ইউনিভার্সিটি অব ইসলামিক সায়েন্সেস, করাচি · ফজর ১৮° / ইশা ১৮°','Hanafi · shadow factor 2':'হানাফি · ছায়ার অনুপাত ২','True solar noon · six-minute prohibited interval':'প্রকৃত সৌর মধ্যাহ্ন · ছয় মিনিটের নিষিদ্ধ সময়',"Prayer calculations follow the device's local time zone. Location coordinates do not change Windows time-zone settings.":'নামাজের সময় ডিভাইসের স্থানীয় সময় অঞ্চল অনুযায়ী হিসাব হয়। অবস্থানের স্থানাঙ্ক উইন্ডোজের সময় অঞ্চল পরিবর্তন করে না।','Personalise Prayer Times':'নামাজের সময় অ্যাপ সাজান','English':'ইংরেজি','Bangla':'বাংলা','Optional minute offsets are applied after the calculation. Use these only when you have a trusted local timetable to compare against.':'হিসাবের পরে ঐচ্ছিক মিনিট সমন্বয় প্রয়োগ হয়। নির্ভরযোগ্য স্থানীয় সময়সূচির সঙ্গে মিলিয়ে তবেই ব্যবহার করুন।','When enabled, Prayer Times starts quietly in the system tray. This setting is optional and stays off until you enable it.':'চালু করলে অ্যাপটি সিস্টেম ট্রেতে নীরবে চালু হবে। আপনি নিজে চালু না করা পর্যন্ত সেটিংটি বন্ধ থাকবে।','Windows notification permission is requested only when you enable reminders. Prayer calculations and tracking work without it.':'আপনি স্মরণিকা চালু করলেই শুধু উইন্ডোজের বিজ্ঞপ্তির অনুমতি চাওয়া হবে। অনুমতি ছাড়াও সময় হিসাব ও নামাজ ট্র্যাকিং চলবে.',"Prayer history, preferences, themes and location stay in this application's local profile. Nothing is uploaded or synchronised.":'নামাজের ইতিহাস, পছন্দ, থিম ও অবস্থান অ্যাপের স্থানীয় প্রোফাইলে থাকে। কোনো তথ্য আপলোড বা সিঙ্ক করা হয় না।','Umm al-Qura estimate; local moon-sighting may differ.':'উম্মুল কুরা পদ্ধতির আনুমানিক তারিখ; স্থানীয় চাঁদ দেখার কারণে পার্থক্য হতে পারে।','The dawn prayer, performed after true dawn begins and before sunrise.':'সুবহে সাদিক শুরু হওয়ার পর এবং সূর্যোদয়ের আগে আদায় করা হয়।','The midday prayer, after the sun has passed its zenith and the prohibited solar-noon interval has ended.':'সূর্য মধ্যাকাশ অতিক্রম ও নিষিদ্ধ সময় শেষ হওয়ার পর আদায় করা হয়।','The afternoon prayer. This application uses the Hanafi shadow-factor-two criterion.':'বিকেলের নামাজ। এই অ্যাপে হানাফি ছায়ার অনুপাত দুই অনুসরণ করা হয়।','The sunset prayer, beginning after the sun has set.':'সূর্যাস্তের পর মাগরিবের সময় শুরু হয়.',"The night prayer, beginning when the selected calculation method's twilight criterion is reached.":'নির্বাচিত হিসাব পদ্ধতির গোধূলির মান পূর্ণ হলে ইশার সময় শুরু হয়।','A morning voluntary prayer after sunrise, once the short prohibited interval after sunrise has passed, and before solar noon.':'সূর্যোদয়ের নিষিদ্ধ সময় পার হওয়ার পর থেকে সৌর মধ্যাহ্নের আগে আদায় করা সকালের নফল নামাজ.',"A voluntary prayer commonly performed after Maghrib and before Isha. Its classification and recommended rak'ahs vary among scholarly traditions.":'মাগরিবের পর ও ইশার আগে প্রচলিত নফল নামাজ। এর শ্রেণিবিন্যাস ও রাকাতসংখ্যা নিয়ে আলেমদের মতভেদ রয়েছে।','Voluntary night prayer after Isha and before Fajr.':'ইশার পর থেকে ফজরের আগে পর্যন্ত নফল রাতের নামাজ.','Night prayer performed after sleep; this application highlights the final third of the night as a practical time window.':'ঘুমিয়ে উঠে আদায় করা রাতের নামাজ; অ্যাপে রাতের শেষ এক-তৃতীয়াংশকে বিশেষ সময় হিসেবে দেখানো হয়.',"Night prayer associated with Ramadan, performed after Isha. It is shown only when the device's built-in Islamic date calculation indicates a Ramadan night.":'রমজানের রাতে ইশার পর আদায় করা রাতের নামাজ। ডিভাইসের হিজরি হিসাব রমজান দেখালেই এটি দেখানো হয়।','The special congregational prayer on Eid al-Fitr and Eid al-Adha, within its morning time window.':'ঈদুল ফিতর ও ঈদুল আজহার বিশেষ জামাত; শুধু সকালের নির্ধারিত সময়ে আদায় করা হয়।','The regular Sunnah prayers associated with the five obligatory prayers.':'পাঁচ ওয়াক্ত ফরজ নামাজের সঙ্গে সংশ্লিষ্ট নিয়মিত সুন্নাত নামাজ.','Friday congregational prayer in place of Dhuhr for those upon whom it is obligatory.':'যাদের ওপর ফরজ, তাদের জন্য শুক্রবার যোহরের পরিবর্তে জামাতে আদায় করা নামাজ.'
};
Object.assign(BN_TEXT, {
  'Prayer Times':'নামাজের সময়','Fajr':'ফজর','Dhuhr':'যোহর','Asr':'আসর','Maghrib':'মাগরিব','Isha':'ইশা','Sunset':'সূর্যাস্ত','Obligatory':'ফরজ',
  'Prayer times are calculated on this device':'নামাজের সময় এই ডিভাইসেই হিসাব করা হয়',
  'Complete the five obligatory prayers to earn your daily achievement.':'দৈনিক লক্ষ্য পূরণে পাঁচ ওয়াক্ত ফরজ নামাজ আদায় করুন।',
  'Time until the next prayer':'পরবর্তী নামাজের বাকি সময়','Calculated on this device · Prayer records stay on this device':'এই ডিভাইসে হিসাব করা হয় · নামাজের রেকর্ড এই ডিভাইসেই থাকে',
  'Expanded Google Maps links with coordinates work offline. Shortened share links cannot be expanded offline; copy coordinates from Maps or enter them below.':'স্থানাঙ্কসহ Google Maps লিংক অফলাইনে পড়া যায়। সংক্ষিপ্ত লিংক অফলাইনে খোলা যায় না; Maps থেকে স্থানাঙ্ক কপি করে লিখুন।',
  'Currently saved location':'বর্তমানে সংরক্ষিত অবস্থান',
  'University of Islamic Sciences, Karachi · Fajr 18° / Isha 18°':'ইউনিভার্সিটি অব ইসলামিক সায়েন্সেস, করাচি · ফজর ১৮° / ইশা ১৮°',
  'Hanafi · shadow factor 2':'হানাফি · ছায়ার অনুপাত ২','True solar noon · six-minute prohibited interval':'প্রকৃত সৌর মধ্যাহ্ন · ছয় মিনিটের নিষিদ্ধ সময়',
  "Prayer calculations follow the device's local time zone. Location coordinates do not change Windows time-zone settings.":'নামাজের সময় ডিভাইসের স্থানীয় সময় অঞ্চল অনুযায়ী হিসাব হয়। অবস্থানের স্থানাঙ্ক উইন্ডোজের সময় অঞ্চল পরিবর্তন করে না।',
  'Personalise Prayer Times':'নামাজের সময় অ্যাপ সাজান','English':'ইংরেজি','Bangla':'বাংলা',
  'Optional minute offsets are applied after the calculation. Use these only when you have a trusted local timetable to compare against.':'হিসাবের পরে ঐচ্ছিক মিনিট সমন্বয় প্রয়োগ হয়। নির্ভরযোগ্য স্থানীয় সময়সূচির সঙ্গে মিলিয়ে তবেই ব্যবহার করুন।',
  'When enabled, Prayer Times starts quietly in the system tray. This setting is optional and stays off until you enable it.':'চালু করলে অ্যাপটি সিস্টেম ট্রেতে নীরবে চালু হবে। আপনি নিজে চালু না করা পর্যন্ত সেটিংটি বন্ধ থাকবে।',
  'Windows notification permission is requested only when you enable reminders. Prayer calculations and tracking work without it.':'আপনি স্মরণিকা চালু করলেই শুধু উইন্ডোজের বিজ্ঞপ্তির অনুমতি চাওয়া হবে। অনুমতি ছাড়াও সময় হিসাব ও নামাজ ট্র্যাকিং চলবে।',
  "Prayer history, preferences, themes and location stay in this application's local profile. Nothing is uploaded or synchronised.":'নামাজের ইতিহাস, পছন্দ, থিম ও অবস্থান অ্যাপের স্থানীয় প্রোফাইলে থাকে। কোনো তথ্য আপলোড বা সিঙ্ক করা হয় না।',
  'Umm al-Qura estimate; local moon-sighting may differ.':'উম্মুল কুরা পদ্ধতির আনুমানিক তারিখ; স্থানীয় চাঁদ দেখার কারণে পার্থক্য হতে পারে।',
  'The dawn prayer, performed after true dawn begins and before sunrise.':'সুবহে সাদিক শুরু হওয়ার পর এবং সূর্যোদয়ের আগে আদায় করা হয়।',
  'The midday prayer, after the sun has passed its zenith and the prohibited solar-noon interval has ended.':'সূর্য মধ্যাকাশ অতিক্রম ও নিষিদ্ধ সময় শেষ হওয়ার পর আদায় করা হয়।',
  'The afternoon prayer. This application uses the Hanafi shadow-factor-two criterion.':'বিকেলের নামাজ। এই অ্যাপে হানাফি ছায়ার অনুপাত দুই অনুসরণ করা হয়।',
  'The sunset prayer, beginning after the sun has set.':'সূর্যাস্তের পর মাগরিবের সময় শুরু হয়।',
  "The night prayer, beginning when the selected calculation method's twilight criterion is reached.":'নির্বাচিত হিসাব পদ্ধতির গোধূলির মান পূর্ণ হলে ইশার সময় শুরু হয়।',
  'A morning voluntary prayer after sunrise, once the short prohibited interval after sunrise has passed, and before solar noon.':'সূর্যোদয়ের নিষিদ্ধ সময় পার হওয়ার পর থেকে সৌর মধ্যাহ্নের আগে আদায় করা সকালের নফল নামাজ।',
  "A voluntary prayer commonly performed after Maghrib and before Isha. Its classification and recommended rak'ahs vary among scholarly traditions.":'মাগরিবের পর ও ইশার আগে প্রচলিত নফল নামাজ। এর শ্রেণিবিন্যাস ও রাকাতসংখ্যা নিয়ে আলেমদের মতভেদ রয়েছে।',
  'Voluntary night prayer after Isha and before Fajr.':'ইশার পর থেকে ফজরের আগে পর্যন্ত নফল রাতের নামাজ।',
  'Night prayer performed after sleep; this application highlights the final third of the night as a practical time window.':'ঘুমিয়ে উঠে আদায় করা রাতের নামাজ; অ্যাপে রাতের শেষ এক-তৃতীয়াংশকে বিশেষ সময় হিসেবে দেখানো হয়।',
  "Night prayer associated with Ramadan, performed after Isha. It is shown only when the device's built-in Islamic date calculation indicates a Ramadan night.":'রমজানের রাতে ইশার পর আদায় করা রাতের নামাজ। ডিভাইসের হিজরি হিসাব রমজান দেখালেই এটি দেখানো হয়।',
  'The special congregational prayer on Eid al-Fitr and Eid al-Adha, within its morning time window.':'ঈদুল ফিতর ও ঈদুল আজহার বিশেষ জামাত; শুধু সকালের নির্ধারিত সময়ে আদায় করা হয়।',
  'The regular Sunnah prayers associated with the five obligatory prayers.':'পাঁচ ওয়াক্ত ফরজ নামাজের সঙ্গে সংশ্লিষ্ট নিয়মিত সুন্নাত নামাজ।',
  'Friday congregational prayer in place of Dhuhr for those upon whom it is obligatory.':'যাদের ওপর ফরজ, তাদের জন্য শুক্রবার যোহরের পরিবর্তে জামাতে আদায় করা নামাজ।'
});


Object.assign(BN_TEXT, {
  'PRAYER COUNTDOWN':'নামাজের কাউন্টডাউন','Sunrise':'সূর্যোদয়','Zawal exclusion':'জাওয়ালের নিষিদ্ধ সময়','Sunset':'সূর্যাস্ত',
  'Ishraq / Duha':'ইশরাক / দুহা','Awwabin':'আওয়াবিন','Qiyam al-Layl':'কিয়ামুল লাইল','Tahajjud':'তাহাজ্জুদ','Tarawih':'তারাবিহ','Eid prayer':'ঈদের নামাজ','Witr':'বিতর','Jumu’ah':'জুমুআ','Regular Sunnah prayers (Rawatib)':'নিয়মিত সুন্নাতে রাতিবাহ','Tahiyyat al-Masjid':'তাহিয়্যাতুল মসজিদ','Salat al-Istikhara':'সালাতুল ইস্তিখারা','Salat al-Tawbah':'নামাজুত তওবা',
  'No specific historical event is listed for today':'আজকের জন্য নির্দিষ্ট কোনো ঐতিহাসিক ঘটনা তালিকাভুক্ত নেই','Continue regular worship; no special prayer is assigned without reliable evidence.':'নিয়মিত ইবাদতই যথেষ্ট; নির্ভরযোগ্য দলিল ছাড়া বিশেষ নামাজ নির্ধারণ করা হয়নি।',
  'No additional voluntary prayer period is scheduled for this date.':'এই তারিখে অতিরিক্ত নফল নামাজের সময় নির্ধারিত নেই।','events':'ইভেন্ট','event':'ইভেন্ট',
  'Prayer marked complete':'নামাজ পড়া হলো, টিক পড়ল','This prayer event is not currently available.':'এই নামাজের সময় এখন উপলভ্য নয়।',
  'Could not save local data. Check available disk space.':'স্থানীয় তথ্য সংরক্ষণ করা যায়নি। ডিভাইসে পর্যাপ্ত জায়গা আছে কি না দেখুন।',
  'Paste a Google Maps share link first.':'প্রথমে Google Maps শেয়ার লিংক পেস্ট করুন।','Enter a valid Google Maps HTTPS link.':'সঠিক Google Maps HTTPS লিংক দিন অথবা সরাসরি স্থানাঙ্ক লিখুন।',
  'Short-link lookup is available in the installed desktop app. You can always enter coordinates manually.':'সংক্ষিপ্ত লিংক যাচাই শুধু ইনস্টল করা ডেস্কটপ অ্যাপে সম্ভব। চাইলে স্থানাঙ্ক সরাসরি লিখতে পারেন।',
  'Following the Google Maps redirect once. No account sign-in is used.':'Google Maps লিংকটি একবার যাচাই করা হচ্ছে। কোনো অ্যাকাউন্টে সাইন-ইন করা হবে না।',
  'Could not resolve this share link. Open it in Maps, copy the coordinates, or enter them manually.':'এই শেয়ার লিংক থেকে অবস্থান পাওয়া যায়নি। Maps-এ খুলে স্থানাঙ্ক কপি করুন অথবা হাতে লিখুন।',
  'The link did not contain valid coordinates.':'লিংকে বৈধ স্থানাঙ্ক পাওয়া যায়নি।','Location saved locally on this device.':'অবস্থান এই ডিভাইসে সংরক্ষিত হয়েছে।',
  'Enter valid coordinates: latitude −90 to 90, longitude −180 to 180.':'সঠিক স্থানাঙ্ক দিন: অক্ষাংশ −৯০ থেকে ৯০, দ্রাঘিমাংশ −১৮০ থেকে ১৮০।',
  'Location saved':'অবস্থান সংরক্ষিত','Prayer reminders disabled':'নামাজের স্মরণিকা বন্ধ','Prayer reminders enabled':'নামাজের স্মরণিকা চালু',
  'Windows startup disabled':'উইন্ডোজ চালুর সঙ্গে অ্যাপ চালু বন্ধ করা হয়েছে','Could not update Windows startup setting':'উইন্ডোজ স্টার্টআপ সেটিং পরিবর্তন করা যায়নি',
  'Windows notification permission was not granted':'উইন্ডোজ বিজ্ঞপ্তির অনুমতি দেওয়া হয়নি','Send test notification':'পরীক্ষামূলক বিজ্ঞপ্তি পাঠান','HOME PAGE':'হোম পেজ','Sections on the home page':'হোম পেজের বিভাগ','Show Prayer descriptions':'নামাজের বিবরণ দেখান','Show the Qur’an':'কুরআন দেখান','Show Sunnah and Seerah':'সুন্নাহ ও সীরাত দেখান','Show On this day in Islamic history':'ইসলামের ইতিহাসে আজকের দিন দেখান','Hidden sections are not drawn and do no work. All are shown by default; your choice is remembered on this device.':'লুকানো বিভাগ আঁকা হয় না এবং কোনো কাজ করে না। ডিফল্টে সবই দেখানো হয়; আপনার পছন্দ এই ডিভাইসে মনে রাখা হয়।',"Today's prohibited intervals":'আজকের নিষিদ্ধ সময়','Shows a real Windows notification now, with the reason if Windows refuses it.':'এখনই একটি আসল উইন্ডোজ বিজ্ঞপ্তি দেখায়; উইন্ডোজ না দেখালে কারণসহ জানায়।','Will start with Windows':'উইন্ডোজ চালুর সঙ্গে অ্যাপ চালু হবে',
  'Adjustment must be between −30 and +30 minutes':'সমন্বয় −৩০ থেকে +৩০ মিনিটের মধ্যে হতে হবে','Local data reset':'স্থানীয় তথ্য মুছে ফেলা হয়েছে',
  'Delete all locally stored settings and prayer history? The application will return to its default location.':'স্থানীয়ভাবে সংরক্ষিত সব সেটিংস ও নামাজের ইতিহাস মুছবেন? অ্যাপটি ডিফল্ট অবস্থানে ফিরে যাবে।',
  'Prayer times are unavailable':'নামাজের সময় পাওয়া যায়নি','Begins':'শুরু','Ends':'শেষ','Time remaining':'বাকি সময়','Begins in':'শুরু হতে বাকি','This prayer period has ended':'এই নামাজের সময় শেষ হয়েছে',
  'Hanafi':'হানাফি','Karachi':'করাচি','Device local time':'ডিভাইসের স্থানীয় সময়','Device':'ডিভাইস'
});


Object.assign(BN_TEXT, {
  "TODAY'S PROGRESS":'আজকের অগ্রগতি','METHOD':'হিসাবের পদ্ধতি','6 min':'৬ মিনিট',
  'Obsidian':'অবসিডিয়ান','Midnight':'মিডনাইট','Forest':'ফরেস্ট','Burgundy':'বারগান্ডি','Graphite':'গ্রাফাইট','Porcelain':'পর্সেলিন','Ivory':'আইভরি','Mist Blue':'মিস্ট ব্লু','Sage':'সেজ','Rose':'রোজ','dark':'গাঢ়','light':'হালকা',
  'Islamic New Year':'ইসলামি নববর্ষ','Start of Muharram':'মুহাররমের শুরু','Day before Ashura (Tasu’a)':'আশুরার আগের দিন (তাসুআ)','9 Muharram':'৯ মুহাররম','Day of Ashura':'আশুরার দিন','10 Muharram':'১০ মুহাররম','Mawlid an-Nabi':'মাওলিদুন্নবী','Observance varies among Muslim communities':'মুসলিম সম্প্রদায়ভেদে পালন ভিন্ন','Isra and Mi’raj':'ইসরা ও মিরাজ','27 Rajab':'২৭ রজব','Mid-Sha’ban':'মধ্য শাবান','15 Sha’ban':'১৫ শাবান','Start of Ramadan':'রমজানের শুরু','The month of fasting':'সিয়ামের মাস','Battle of Badr':'বদরের যুদ্ধ','17 Ramadan':'১৭ রমজান','Laylat al-Qadr (commonly observed)':'লাইলাতুল কদর (প্রচলিত তারিখ)','The Night of Decree; the exact night is not fixed':'শবে কদর; নির্দিষ্ট রাত নিশ্চিত নয়','Eid al-Fitr':'ঈদুল ফিতর','1 Shawwal':'১ শাওয়াল','Six days of Shawwal':'শাওয়ালের ছয় রোজা','Optional fasting; dates may vary by local practice':'নফল রোজা; স্থানীয় আমলভেদে তারিখ ভিন্ন হতে পারে','Day of Arafah':'আরাফার দিন','9 Dhul Hijjah':'৯ জিলহজ','Eid al-Adha':'ঈদুল আজহা','10 Dhul Hijjah':'১০ জিলহজ','Last ten nights of Ramadan':'রমজানের শেষ দশ রাত','Seek Laylat al-Qadr in the odd-numbered nights':'বিজোড় রাতে লাইলাতুল কদর অনুসন্ধান করুন','First ten days of Dhul Hijjah':'জিলহজের প্রথম দশ দিন','Among the most significant days of the Islamic year':'ইসলামি বছরের সর্বাধিক মর্যাদাপূর্ণ দিনগুলোর অন্তর্ভুক্ত',
  'Day before Ashura (Tasu’a) · 9 Muharram':'আশুরার আগের দিন (তাসুআ) · ৯ মুহাররম',
  'Time left':'বাকি সময়','Prayer countdown':'নামাজের কাউন্টডাউন'
});

Object.assign(BN_TEXT, {
  'Obligatory prayers':'ফরজ নামাজ','Daily voluntary prayers':'দৈনিক নফল নামাজ','Situational voluntary prayers':'পরিস্থিতিভিত্তিক নফল নামাজ','Seasonal prayer events':'মৌসুমি নামাজ','Sunnah and Seerah':'সুন্নাহ ও সীরাত','Sunnah & Seerah':'সুন্নাহ ও সীরাত',
  'On this day in Islamic history':'ইসলামের ইতিহাসে আজকের দিন','Islamic History':'ইসলামের ইতিহাস',
  'Dated events and historical context':'তারিখভিত্তিক ঘটনা ও ঐতিহাসিক প্রেক্ষাপট',
  'Prophetic guidance and daily life':'নববী নির্দেশনা ও দৈনন্দিন জীবন',
  'The beginning of Qur’anic revelation':'কুরআনের প্রথম ওহি',
  'The first revelation':'প্রথম ওহি','Exact historical date match':'নির্দিষ্ট ঐতিহাসিক তারিখের মিল',
  'Historical match by week of the month':'মাসের একই সপ্তাহের ঐতিহাসিক মিল',
  'Historical match by month':'মাসভিত্তিক ঐতিহাসিক মিল',
  'Closest documented historical period':'নিকটতম নথিভুক্ত ঐতিহাসিক সময়',
  'Matches today’s Hijri date.':'আজকের হিজরি তারিখের সঙ্গে মিলে গেছে।',
  'No event is documented for today’s exact date; this is the nearest verified historical anniversary, not a claim that it happened today.':'আজকের নির্দিষ্ট তারিখে কোনো ঘটনা নথিভুক্ত নেই; এটি নিকটতম যাচাইযোগ্য ঐতিহাসিক বার্ষিকী, আজ ঘটেছে এমন দাবি নয়।',
  'Recite in the name of your Lord who created.':'পড়ুন আপনার রবের নামে, যিনি সৃষ্টি করেছেন।',
  'Continue with Surah al-‘Alaq 96:2–5.':'এরপর সূরা আল-আলাক ৯৬:২–৫ পড়তে পারেন।',
  '© 2026–2027':'© ২০২৬–২০২৭','Salman Reza Amit':'সালমান রেজা অমিত','© 2026–2027 Salman Reza Amit':'© ২০২৬–২০২৭ সালমান রেজা অমিত',
  'Calculated on this device · Prayer records stay on this device':'এই ডিভাইসে হিসাব করা হয় · নামাজের রেকর্ড এই ডিভাইসেই থাকে',
  'Keyboard shortcuts':'কিবোর্ড শর্টকাট','Toggle fullscreen':'পূর্ণপর্দা চালু বা বন্ধ করুন',
  'Exit fullscreen or close this panel':'পূর্ণপর্দা থেকে বের হন অথবা এই প্যানেল বন্ধ করুন',
  'Return to the top of the home page':'মূল পাতার একদম ওপরে যান','Scroll up one screen':'এক পর্দা ওপরে যান',
  'Scroll down one screen':'এক পর্দা নিচে যান','Go to the bottom of the page':'পাতার একদম নিচে যান',
  'Show these shortcuts':'এই শর্টকাটগুলো দেখান',
  'Exit fullscreen, go back, or close this panel':'পূর্ণপর্দা থেকে বের হন, পেছনে যান অথবা এই প্যানেল বন্ধ করুন',
  'Show or hide these shortcuts':'এই শর্টকাটগুলো দেখান বা লুকান',
  'Previous or next item in a focused card':'নির্বাচিত কার্ডে আগের বা পরের বিষয়',
  'Activate the focused button or tick circle':'নির্বাচিত বোতাম বা টিক-বৃত্ত চালু করুন',
  'Move between controls':'নিয়ন্ত্রণগুলোর মধ্যে সরে যান',
  'Close shortcuts':'শর্টকাট বন্ধ করুন','Sunnah':'সুন্নাত','Clock format':'ঘড়ির ধরন','Font':'ফন্ট','24-hour (17:05)':'২৪ ঘণ্টা (১৭:০৫)','12-hour (5:05 PM)':'১২ ঘণ্টা (বিকাল ৫:০৫)','Calculation method':'হিসাব পদ্ধতি','School (Asr method)':'মাযহাব (আসর পদ্ধতি)','High-latitude rule':'উচ্চ অক্ষাংশ নিয়ম','Calculation profile updated':'হিসাব প্রোফাইল হালনাগাদ হয়েছে','Date-specific':'বিশেষ দিনের নামাজ','Tick sound':'টিক শব্দ','Wooden':'কাঠের','Soft':'নরম','Crystal':'স্ফটিক','Nafl':'নফল','Other voluntary':'অন্যান্য নফল ইবাদত','Sunnah marked complete':'সুন্নাত সম্পন্ন হিসেবে চিহ্নিত','Nafl marked complete':'নফল সম্পন্ন হিসেবে চিহ্নিত','All Sunnah prayers complete':'সব সুন্নাত সম্পন্ন','All prayer-linked Nafl complete':'নামাজ-সংশ্লিষ্ট সব নফল সম্পন্ন',
  'Remind me before a prayer begins':'নামাজের সময় শুরুর আগে মনে করিয়ে দিন',
  'Enter any whole number of minutes from 0 to 180 for each obligatory prayer. 0 turns that reminder off.':'প্রতিটি ফরজ নামাজের জন্য ০ থেকে ১৮০-এর মধ্যে যেকোনো পূর্ণ সংখ্যায় মিনিট লিখুন। ০ দিলে সেই স্মরণিকা বন্ধ থাকবে।',
  'Enter whole minutes from 0 to 180':'০ থেকে ১৮০-এর মধ্যে পূর্ণ সংখ্যায় মিনিট লিখুন','Previous item':'আগেরটি','Next item':'পরেরটি',
  'Fullscreen mode is unavailable':'পূর্ণপর্দা মোড উপলভ্য নয়',
  'Play a short tick sound when a prayer is marked complete':'নামাজ সম্পন্ন চিহ্নিত করলে ছোট টিক শব্দ বাজান',
  'Prayer completion progress':'নামাজ সম্পন্নের অগ্রগতি',
  'Date-specific prayers':'তারিখভিত্তিক নামাজ',
  'Islamic history items':'ইসলামের ইতিহাসের বিষয়সমূহ','Qur’anic verses':'কুরআনের আয়াতসমূহ',
  'Sunnah observances':'সুন্নাহ আমলসমূহ','Seerah glimpses':'সীরাতের ঝলক','Seasonal prayer descriptions':'মৌসুমি নামাজের বিবরণ',
  'Set your location with a Google Maps link or coordinates first.':'প্রথমে Google Maps লিংক বা স্থানাঙ্ক দিয়ে আপনার অবস্থান নির্ধারণ করুন।'
});

Object.assign(BN_TEXT, {
  'Remind me before a prayer period ends':'নামাজের সময় শেষ হওয়ার আগে স্মরণ করান',
  'Choose a separate lead time for each event. Select Off to disable an individual reminder.':'প্রতিটি নামাজের জন্য আলাদা সময় নির্ধারণ করুন। বন্ধ করলে সেই স্মরণিকা নিষ্ক্রিয় থাকবে।',
  'Off':'বন্ধ','min before':'মিনিট আগে','Qur’anic revelation on this date':'এই তারিখে নাজিল হওয়া কুরআনের আয়াত',
  'Only exact, historically documented revelation dates are shown.':'শুধু নির্দিষ্ট ও ঐতিহাসিকভাবে নথিভুক্ত অবতরণের তারিখ দেখানো হয়।',
  'No exact revelation date is reliably documented for this date':'এই তারিখে ওহি নাজিলের নির্দিষ্ট ও নির্ভরযোগ্য তারিখ নথিভুক্ত নেই',
  'A surah’s general chronology or its association with an event is not treated as proof of the exact day of revelation.':'কোনো সূরার সাধারণ অবতরণ-ক্রম বা ঘটনার সঙ্গে সম্পর্ককে নির্দিষ্ট দিনের প্রমাণ হিসেবে ধরা হয় না।'
});

function translateRenderedText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const lastTranslated = LAST_TRANSLATED_TEXT.get(node);
    if (!ORIGINAL_TEXT.has(node) || (lastTranslated !== undefined && raw !== lastTranslated)) ORIGINAL_TEXT.set(node, raw);
    const original = ORIGINAL_TEXT.get(node);
    const trimmed = original.trim();
    if (!trimmed) continue;
    if (lang() !== 'bn') { node.nodeValue = original; LAST_TRANSLATED_TEXT.set(node, original); continue; }
    let translated = BN_TEXT[trimmed];
    if (!translated) {
      translated = trimmed
        .replace(/([0-9]+) of 5 obligatory prayers/g, '$1/৫টি ফরজ নামাজ')
        .replace(/([0-9]+) of ([0-9]+) voluntary events completed/g, '$1/$2টি নফল নামাজ পড়া হয়েছে')
        .replace(/All five obligatory prayers completed/g, 'পাঁচ ওয়াক্ত ফরজ নামাজ সম্পন্ন')
        .replace(/voluntary events completed/g, 'টি নফল নামাজ পড়া হয়েছে')
        .replace(/prayers/g, 'ওয়াক্ত নামাজ')
        .replace(/Prayer marked complete/g, 'নামাজ পড়া হলো, টিক পড়ল')
        .replace(/Begins at/g, 'শুরু')
        .replace(/Ends at/g, 'শেষ')
        .replace(/begins at/g, 'শুরু')
        .replace(/Saved location/g, 'সংরক্ষিত অবস্থান')
        .replace(/Hanafi/g, 'হানাফি').replace(/Shafi‘i/g, 'শাফেয়ি').replace(/Maliki/g, 'মালেকি').replace(/Hanbali/g, 'হাম্বলি').replace(/Ja‘fari/g, 'জাফরি')
        .replace(/Obsidian/g, 'অবসিডিয়ান').replace(/Midnight/g, 'মিডনাইট').replace(/Forest/g, 'ফরেস্ট').replace(/Burgundy/g, 'বারগান্ডি').replace(/Graphite/g, 'গ্রাফাইট').replace(/Porcelain/g, 'পর্সেলিন').replace(/Ivory/g, 'আইভরি').replace(/Mist Blue/g, 'মিস্ট ব্লু').replace(/Sage/g, 'সেজ').replace(/Rose/g, 'রোজ')
        .replace(/\(dark\)/g, '(গাঢ়)').replace(/\(light\)/g, '(হালকা)')
        .replace(/Current:/g, 'বর্তমান:')
        .replace(/Coordinates found:/g, 'স্থানাঙ্ক পাওয়া গেছে:')
        .replace(/Select Save location to store them on this device\./g, 'এই ডিভাইসে সংরক্ষণ করতে অবস্থান সংরক্ষণ করুন।')
        .replace(/Begins/g, 'শুরু')
        .replace(/No obligatory prayer window is active/g, 'এখন কোনো ফরজ নামাজের ওয়াক্ত চলছে না')
        .replace(/Begins at/g, 'শুরু')
        .replace(/Ends/g, 'শেষ')
        .replace(/prayer countdown/g, 'নামাজের কাউন্টডাউন')
        .replace(/ prayers/g, ' ওয়াক্ত নামাজ')
        .replace(/([0-9]) events/g, '$1টি সময়')
        .replace(/Sahih al-Bukhari/g, 'সহিহ বুখারি').replace(/Sahih Muslim/g, 'সহিহ মুসলিম').replace(/Jami‘ at-Tirmidhi/g, 'জামে তিরমিজি').replace(/Sunan Abi Dawud/g, 'সুনানে আবু দাউদ').replace(/Qur’an/g, 'কুরআন')
        .replace(/Surah al-Baqarah/g, 'সূরা বাকারা').replace(/ \(excerpt\)/g, ' (অংশ)').replace(/ \(opening\)/g, ' (শুরুর অংশ)')
        .replace(/The month \(Rajab or Sha‘ban 2 AH\) is disputed\./g, 'মাসটি (রজব বা শাবান, ২ হিজরি) নিয়ে মতভেদ আছে।').replace(/([0-9]+) and ([0-9]+)/g, '$1 ও $2')
        .replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);
    }
    node.nodeValue = original.replace(trimmed, translated);
    LAST_TRANSLATED_TEXT.set(node, node.nodeValue);
  }
  for (const element of document.querySelectorAll('[title], [placeholder]')) {
    for (const attr of ['title','placeholder']) {
      if (!element.hasAttribute(attr)) continue;
      const store = `original${attr[0].toUpperCase()}${attr.slice(1)}`;
      if (!element.dataset[store]) element.dataset[store] = element.getAttribute(attr) || '';
      const original = element.dataset[store];
      element.setAttribute(attr, lang() === 'bn' ? (BN_TEXT[original] || original.replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])) : original);
    }
  }
  for (const element of document.querySelectorAll('[aria-label]')) {
    if (!element.dataset.originalAriaLabel) element.dataset.originalAriaLabel = element.getAttribute('aria-label') || '';
    const label = element.dataset.originalAriaLabel;
    if (lang() === 'bn') {
      const adjustment = /^(Fajr|Sunrise|Dhuhr|Asr|Maghrib|Isha) adjustment in minutes$/.exec(label);
      element.setAttribute('aria-label', adjustment ? `${BN_TEXT[adjustment[1]] || adjustment[1]} মিনিটে সমন্বয়` : (BN_TEXT[label] || label.replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])));
    }
    else element.setAttribute('aria-label', label);
  }
}

/* Carousels: every matching item for the date, paged with ‹ › buttons or the
   Left/Right arrow keys while the card is focused. Controls hide for one item. */
const carouselState = new Map();

function renderCarousel(box, id, slides, label) {
  if (!box) return;
  const signature = slides.map(slide => slide.key).join('|');
  const index = reconcileIndex(carouselState.get(id), signature, slides.length);
  carouselState.set(id, { signature, index });
  const controls = showsControls(slides.length);
  box.dataset.carousel = id;
  box.classList.add('carousel-host');
  box.classList.toggle('has-carousel', controls);
  if (controls) {
    box.tabIndex = 0;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-roledescription', lang() === 'bn' ? 'ক্যারোসেল' : 'carousel');
    box.setAttribute('aria-label', label);
    delete box.dataset.originalAriaLabel;
  } else {
    box.removeAttribute('tabindex');
    box.removeAttribute('role');
    box.removeAttribute('aria-roledescription');
    box.removeAttribute('aria-label');
    delete box.dataset.originalAriaLabel;
  }
  const nav = controls ? `<div class="carousel-nav"><button class="carousel-button" type="button" data-carousel-step="-1" aria-label="Previous item">‹</button><span class="carousel-counter" aria-live="polite">${counterLabel(index, slides.length, lang())}</span><button class="carousel-button" type="button" data-carousel-step="1" aria-label="Next item">›</button></div>` : '';
  box.innerHTML = nav + slides.map((slide, n) => `<div class="carousel-slide"${n === index ? '' : ' hidden'} data-slide-index="${n}">${slide.html}</div>`).join('');
}

function showCarouselSlide(host, index) {
  if (!host) return;
  const id = host.dataset.carousel;
  const slides = [...host.querySelectorAll(':scope > .carousel-slide')];
  if (!slides.length) return;
  const target = wrapIndex(index, slides.length);
  slides.forEach((slide, n) => { slide.hidden = n !== target; });
  const entry = carouselState.get(id);
  if (entry) entry.index = target;
  const counter = host.querySelector(':scope > .carousel-nav .carousel-counter');
  if (counter) counter.textContent = counterLabel(target, slides.length, lang());
}

function stepCarousel(host, delta) {
  if (!host) return;
  const id = host.dataset.carousel;
  const count = host.querySelectorAll(':scope > .carousel-slide').length;
  if (!showsControls(count)) return;
  showCarouselSlide(host, stepIndex(carouselState.get(id)?.index || 0, delta, count));
}

function render() {
  setLanguage();
  sealLocks();
  currentTimes = getTimes(selectedDate);
  liveTimes = getTimes(startOfDay(new Date()));
  const today = startOfDay(new Date());
  const occasion = occasionFor(today);
  const notice = $('occasionBanner');
  notice.hidden = !occasion;
  notice.innerHTML = occasion ? `<strong>${escapeHtml(occasion[0])}</strong><span>${escapeHtml(occasion[1])} · Umm al-Qura estimate; local moon-sighting may differ.</span>` : '';
  renderProgress();
  renderLiveEvents();
  renderCompletedToday();
  renderEclipse();
  renderFard(currentTimes);
  renderVoluntary(selectedDate, currentTimes);
  renderSituational();
  applySectionVisibility();
  const dailyNote = $('dailyNote');
  if (dailyNote) {
    const reflection = reflectionFor(progressDate(new Date()), lang());
    dailyNote.textContent = reflection?.text ? `${lang() === 'bn' ? 'আজকের ভাবনা' : 'Daily reflection'} — ${reflection.text}` : '';
  }
  renderWeeklyReview();
  renderNextPrayer();
  renderSettingsSummary();
  translateRenderedText();
  if (currentPage === 'countdown') renderCountdownView();
  if (currentPage === 'time') renderTimeView();
  updateTrayTooltip();
  armBoundary();
}

/* Forbidden-time card (v1.3.3). Shown ONLY while a prohibited interval is in progress: there is no
   advance notice and an interval is never a "Next event" target (see src/forbidden-times.js). */
function forbiddenCardHtml(item) {
  const bn = lang() === 'bn';
  const school = state.profile.school;
  const label = PROHIBITED_LABELS[item.key][bn ? 'bn' : 'en'];
  const nb = value => String(value).replace(/ /g, '\u00a0');
  const until = nb(fmt(new Date(item.end)));
  const range = `${nb(fmt(new Date(item.start)))} – ${until}`;
  const kind = school === 'jafari' ? (bn ? 'মাকরুহ সময়' : 'DISLIKED TIME') : (bn ? 'নিষিদ্ধ সময়' : 'FORBIDDEN TIME');
  let main, detail = '';
  if (school === 'jafari') {
    main = bn ? `${until} পর্যন্ত নফল নামাজ শুরু করা মাকরুহ` : `Starting voluntary prayers is disliked until ${until}`;
    detail = bn ? 'ফরজ নামাজ আদায় করা যায়।' : 'An obligatory prayer may be offered.';
  } else if (school !== 'hanafi') {
    main = bn ? `${until} পর্যন্ত নফল নামাজ পড়া নিষেধ` : `Voluntary prayers are not allowed until ${until}`;
    detail = bn ? 'ফরজ নামাজের নিজস্ব ওয়াক্ত হলে সেটি আদায় করা যায়।' : 'An obligatory prayer may be offered in its own time.';
  } else {
    main = bn ? `${until} পর্যন্ত নামাজ পড়া নিষেধ` : `Praying is not allowed until ${until}`;
    if (item.key === 'sunset') detail = bn ? 'শুধু আজকের অনাদায়ী আসর এখন আদায় করা যায়।' : "Only today's Asr, if not yet prayed, may be offered now.";
  }
  const lead = `${bn ? kind : kind} · ${bn ? label : label.toUpperCase()}`;
  return `<div class="forbidden-card" role="status" data-prohibited="${item.key}"><div class="forbidden-main"><div class="forbidden-type">${escapeHtml(lead)}</div><strong class="forbidden-line">${escapeHtml(main)}</strong><small class="forbidden-range">${escapeHtml(range)}</small>${detail ? `<small class="forbidden-detail">${escapeHtml(detail)}</small>` : ''}</div><div class="forbidden-left-box"><span>${bn ? 'শেষ হতে বাকি' : 'ENDS IN'}</span><b class="forbidden-left" data-live-countdown="true" data-until="${item.end}">${countdown(item.end - Date.now())}</b></div></div>`;
}

/** Prohibited intervals in progress at `now` (from the neighbouring days too, so midnight-spanning edges stay right). */
function activeProhibited(now) {
  const today = startOfDay(now);
  return activeIntervals([-1, 0, 1].flatMap(offset => prohibitedIntervals(getTimes(addDays(today, offset)))), now);
}

function liveHeadingText(active) {
  const bn = lang() === 'bn';
  if (!active.length) return bn ? 'এখনকার নামাজ' : 'Prayer events';
  return state.profile.school === 'jafari' ? (bn ? 'মাকরুহ সময়' : 'Disliked time') : (bn ? 'নিষিদ্ধ সময়' : 'Forbidden time');
}

function renderLiveEvents() {
  const box = $('liveEvents');
  box.innerHTML = '';
  const events = getActiveEvents(new Date()).filter(event => !eventComplete(event));
  const forbidden = activeProhibited(new Date());
  const heading = $('liveHeading');
  if (heading) heading.textContent = liveHeadingText(forbidden);
  box.classList.toggle('is-forbidden', forbidden.length > 0);
  box.dataset.count = String(Math.max(1, events.length + forbidden.length));
  const intervalRows = forbidden.map(forbiddenCardHtml).join('');
  if (!events.length) {
    // The calm empty state only appears when nothing else is shown; the next event lives in the hero card below, so it is not repeated here.
    const bnEmpty = lang() === 'bn';
    box.innerHTML = intervalRows || `<div class="live-empty"><span class="empty-mark">✦</span><div><strong>${bnEmpty ? 'এখন কোনো নামাজের সময় চলছে না।' : 'No prayer event is currently in its time window.'}</strong><small>${bnEmpty ? 'এরপরেরটা নিচের কার্ডে দেখা যাচ্ছে।' : 'The next event is shown just below.'}</small></div></div>`;
    translateRenderedText();
    return;
  }
  for (const event of events) {
    const record = dayRecord(event.date, false);
    const done = !!record[event.kind]?.[event.key];
    const lockText = done ? lockTipFor(event.kind, event.key, event.date) : '';
    const item = document.createElement('article');
    item.className = `live-event ${event.kind === 'voluntary' ? 'voluntary' : 'obligatory'}${done ? ' is-done' : ''}`;
    const kindLabel = event.kind === 'fard' ? 'OBLIGATORY' : 'VOLUNTARY';
    const displayName = slotName(event.key, event.date);
    const eventGuidance = event.key === 'dhuhr' && event.date.getDay() === 5 ? PRAYER_GUIDANCE.jumuah : PRAYER_GUIDANCE[event.key];
    item.innerHTML = `
      <div class="live-event-main">
        <div class="live-event-type">${kindLabel}</div>
        <button class="live-name" type="button" data-live-description="${event.kind}:${event.key}">${escapeHtml(displayName)}</button>
        <small>${escapeHtml(fmt(event.start))} – ${escapeHtml(fmt(event.end))}</small>
        <small class="live-rakah">${escapeHtml(eventGuidance && !shiaMode() ? (lang()==='bn'?eventGuidance.bn:eventGuidance.rakahs) : '')}</small>
      ${event.kind === 'fard' ? partsHtml(event.key, event.date, true, { includeFard: false }) : ''}</div>
      <div class="live-event-actions">
        <button class="event-countdown" type="button" data-event-countdown="true" data-kind="${event.kind}" data-key="${event.key}" data-date="${dateKey(event.date)}" data-start="${event.start.getTime()}" data-end="${event.end.getTime()}"><span>TIME LEFT</span><strong data-live-countdown="true" data-until="${event.end.getTime()}">${countdown(event.end.getTime() - Date.now())}</strong></button>
        <button class="round-check layer-${layerOf(event.kind, event.key)}${lockText ? ' is-locked' : ''}" type="button" data-live-kind="${event.kind}" data-live-key="${event.key}" data-live-date="${dateKey(event.date)}" aria-label="${lang()==='bn' ? `${escapeHtml(prayerName(event.key))} সম্পন্ন হিসেবে চিহ্নিত করুন` : `Mark ${escapeHtml(prayerName(event.key))} complete`}" aria-pressed="${done}"${lockText ? ` aria-disabled="true" title="${escapeHtml(lockText)}"` : ''}>${done ? '✓' : ''}${lockText ? lockMarkHtml(lockText, true) : ''}</button>
      </div>${eventActionHtml(event, record)}`;
    box.append(item);
  }
  if (intervalRows) box.insertAdjacentHTML('afterbegin', intervalRows);
  box.querySelectorAll('[data-live-kind]').forEach(button => button.addEventListener('click', () => {
    togglePrayer(button.dataset.liveKind, button.dataset.liveKey, button.dataset.liveDate);
  }));
  box.querySelectorAll('[data-live-description]').forEach(button => button.addEventListener('click', () => {
    navigateToPrayerDescription(button.dataset.liveDescription.split(':')[1]);
  }));
  box.querySelectorAll('[data-event-countdown]').forEach(button => button.addEventListener('click', () => openEventCountdown(button.dataset)));
  bindEventRecordActions(box);
  translateRenderedText();
}


function bindEventRecordActions(root = document) {
  root.querySelectorAll('[data-mark-event]').forEach(button => button.addEventListener('click', () => {
    const [kind, key] = button.dataset.markEvent.split(':');
    markPrayerEventComplete(kind, key, button.dataset.markDate);
  }));
  root.querySelectorAll('[data-undo-event]').forEach(button => button.addEventListener('click', () => {
    const [kind, key] = button.dataset.undoEvent.split(':');
    undoPrayerEventRecord(kind, key, button.dataset.undoDate);
  }));
}

function renderFard(times) {
  const grid = $('prayerGrid');
  grid.innerHTML = '';
  if (!times) return;
  const record = dayRecord(selectedDate, false);
  const today = dateKey(selectedDate) === dateKey(new Date());
  const active = today ? getActiveEvents().find(event => event.kind === 'fard' && dateKey(event.date) === dateKey(selectedDate))?.key : null;
  for (const prayer of FARD) {
    const card = document.createElement('article');
    const done = !!record.fard?.[prayer.key];
    const guidance = prayer.key === 'dhuhr' && selectedDate.getDay() === 5 ? PRAYER_GUIDANCE.jumuah : PRAYER_GUIDANCE[prayer.key];
    card.className = `prayer-card card-obligatory${done ? ' done' : ''}${active === prayer.key ? ' active' : ''}`;
    const recordEvent = findRecordableEvent('fard', prayer.key, selectedDate);
    const recordLock = recordEvent ? lockInstant({ kind: 'fard', key: prayer.key }, lockContext(selectedDate).events, lockContext(selectedDate).nextFajr) : null;
    const now = new Date();
    const canRecord = !!recordEvent && recordingOpen(recordEvent.start, recordEvent.end, recordLock && recordLock.at, now);
    const inWindow = !!recordEvent && now >= recordEvent.start && now < recordEvent.end;
    const recordNote = canRecord && !inWindow ? (lang() === 'bn' ? 'শুধু রেকর্ড। নামাজের সময় শেষ।' : 'Recording only. The prayer time has ended.') : '';
    card.innerHTML = `<div class="prayer-card-head"><button class="prayer-name-button" type="button" data-card-info="${prayer.key}">${escapeHtml(isFridayDhuhr(prayer.key, selectedDate) ? slotName(prayer.key, selectedDate) : text(prayer))}</button><span class="prayer-index">${String(FARD.indexOf(prayer) + 1).padStart(2, '0')}</span></div><div class="prayer-time">${escapeHtml(fmt(times[prayer.key]))}</div><div class="prayer-status">${done ? (lang()==='bn'?'সম্পন্ন':'Completed') : (lang()==='bn'?'ফরজ নামাজ':'Obligatory prayer')}${done && lockTipFor('fard', prayer.key, selectedDate) ? lockMarkHtml(lockTipFor('fard', prayer.key, selectedDate)) : ''}</div>${shiaMode() ? '' : `<div class="rakah-line">${escapeHtml(lang()==='bn'?guidance.bn:guidance.rakahs)}</div>`}${prayerNoteHtml(prayer.key)}<div class="prayer-eta" data-eta="${prayer.key}" hidden></div>${recordNote ? `<p class="record-note">${escapeHtml(recordNote)}</p>` : ''}${!done && canRecord ? `<button class="secondary-button record-button" type="button" data-day-fard="${prayer.key}" data-day-date="${dateKey(selectedDate)}">${lang()==='bn'?'রেকর্ড করুন':'Record completion'}</button>` : ''}${eventActionHtml({ kind: 'fard', key: prayer.key, date: selectedDate }, record)}`;
    grid.append(card);
  }
  grid.querySelectorAll('[data-card-info]').forEach(button => button.addEventListener('click', () => toggleCardInfo(button)));
  grid.querySelectorAll('[data-day-fard]').forEach(button => button.addEventListener('click', () => togglePrayer('fard', button.dataset.dayFard, button.dataset.dayDate)));
  bindEventRecordActions(grid);
  grid.querySelectorAll('.prayer-eta').forEach(el => el.addEventListener('click', () => { if (el.dataset.start) openEventCountdown(el.dataset); }));
  updateCardCountdowns();
}

/* Daily prayers cards: "in 3h 54m" / "ends in 25m" / nothing once passed. Hours and minutes only;
   called from render() and the 15 s interval, so the text refreshes every minute without re-rendering the card. */
function updateCardCountdowns(now = new Date()) {
  const today = startOfDay(now);
  const events = dateKey(selectedDate) === dateKey(today) ? getFardEvents(today) : [];
  document.querySelectorAll('.prayer-eta[data-eta]').forEach(el => {
    const event = events.find(item => item.key === el.dataset.eta);
    const result = event ? cardCountdown({ now, start: event.start, end: event.end, lang: lang() }) : { kind: 'passed', text: '' };
    if (event) { el.dataset.start = String(event.start.getTime()); el.dataset.end = String(event.end.getTime()); el.dataset.key = event.key; el.dataset.kind = 'fard'; el.dataset.date = dateKey(event.date); }
    if (el.dataset.etaText !== result.text) { el.dataset.etaText = result.text; el.textContent = result.text; }
    el.hidden = !result.text;
    el.classList.toggle('is-current', result.kind === 'current');
    const pref = event ? preferredWindow(event.key, event.start, event.end, state.profile.school, { friday: event.key === 'dhuhr' && event.date.getDay() === 5 }) : null;
    el.classList.toggle('is-best', !!(pref && now >= pref.start && now < pref.end));
  });
}

function renderVoluntary(date, times) {
  const list = $('voluntaryList');
  list.innerHTML = '';
  if (!times) return;
  let events = getVoluntaryEvents(date, times, getTimes(addDays(date, 1)));
  if (dateKey(date) === dateKey(new Date())) {
    const now = new Date();
    events = events.filter(event => !['eid_prayer','tarawih'].includes(event.key) || (now >= event.start && now < event.end));
  }
  $('voluntaryCount').textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  if (!events.length) {
    list.innerHTML = '<div class="voluntary-empty">No additional voluntary prayer period is scheduled for this date.</div>';
    return;
  }
  const record = dayRecord(date, false);
  const rowHtml = (event, done) => {
    const kind = DATE_SPECIFIC_VOLUNTARY.includes(event.key) ? 'card-special' : 'card-daily';
    const eid = event.eid ? ` data-eid="${event.eid}"` : '';
    const record = dayRecord(event.date, false);
    const actionHtml = eventActionHtml(event, record);
    const mainLock = lockState('voluntary', event.key, date);
    const recordCtx = lockContext(date);
    const recordLock = lockInstant({ kind: 'voluntary', key: event.key }, recordCtx.events, recordCtx.nextFajr);
    const canRecord = recordingOpen(event.start, event.end, recordLock?.at, new Date());
    return `<div class="voluntary-summary-main"><button class="prayer-name-button" type="button" data-card-info="${event.key}">${escapeHtml(prayerName(event.key))}</button><small>${escapeHtml(fmt(event.start))} – ${escapeHtml(fmt(event.end))}${done ? (lang() === 'bn' ? ' · সম্পন্ন' : ' · Completed') : ''}${done && lockTipFor('voluntary', event.key, date) ? lockMarkHtml(lockTipFor('voluntary', event.key, date)) : ''}</small></div><button class="event-countdown" type="button" data-event-countdown="true" data-kind="voluntary" data-key="${event.key}" data-date="${dateKey(date)}" data-start="${event.start.getTime()}" data-end="${event.end.getTime()}"${eid}><span>TIME LEFT</span><strong data-live-countdown="true" data-until="${event.end.getTime()}">${countdown(event.end.getTime() - Date.now())}</strong></button><button class="round-check layer-voluntary${done ? ' done' : ''}" type="button" data-live-kind="voluntary" data-live-key="${event.key}" data-live-date="${dateKey(date)}" aria-pressed="${done}"${mainLock.locked || !canRecord ? ' disabled title="This prayer event is not currently recordable"' : ''}>${done ? '✓' : ''}</button>${actionHtml}`;
  };
  // Date-specific prayers (Eid, Tarawih) share one carousel card so every one
  // that applies can be paged through; daily voluntary prayers stay as before.
  const dateSpecific = events.filter(event => DATE_SPECIFIC_VOLUNTARY.includes(event.key));
  if (dateSpecific.length) {
    const holder = document.createElement('div');
    holder.className = 'voluntary-carousel';
    list.append(holder);
    renderCarousel(holder, `voluntary-date-specific:${dateKey(date)}`, dateSpecific.map(event => {
      const done = !!record.voluntary?.[event.key];
      return { key: event.key, html: `<article class="voluntary-item card-special${done ? ' done' : ''}">${rowHtml(event, done)}</article>` };
    }), 'Date-specific prayers');
  }
  for (const event of events.filter(item => !DATE_SPECIFIC_VOLUNTARY.includes(item.key))) {
    const done = !!record.voluntary?.[event.key];
    const row = document.createElement('article');
    row.className = `voluntary-item card-daily${done ? ' done' : ''}`;
    row.innerHTML = rowHtml(event, done);
    list.append(row);
  }
  list.querySelectorAll('[data-card-info]').forEach(button => button.addEventListener('click', () => toggleCardInfo(button)));
  list.querySelectorAll('[data-event-countdown]').forEach(button => button.addEventListener('click', () => openEventCountdown(button.dataset)));
  list.querySelectorAll('[data-live-kind]').forEach(button => button.addEventListener('click', () => togglePrayer(button.dataset.liveKind, button.dataset.liveKey, button.dataset.liveDate)));
  bindEventRecordActions(list);
}

function renderSituational() {
  const list = $('situationalList');
  if (!list) return;
  const hidden = shiaMode() ? [] : [];
  const keys = ['tahiyyatul_masjid', 'istikhara', 'tawbah'].filter(key => !hidden.includes(key));
  const record = dayRecord(selectedDate, false);
  list.innerHTML = keys.map(key => { const done = !!record.situational?.[key]; const complete = !!record.completedEvents?.[`situational:${key}`]; return `<article class="situational-card card-situational${done ? ' done' : ''}"><button class="prayer-name-button" type="button" data-card-info="${key}">${escapeHtml(prayerName(key))}</button><p class="muted">${escapeHtml(lang()==='bn' ? 'কোনো নির্দিষ্ট সময়সীমা নেই। শিরোনামে চাপলে বিবরণ, দলিল ও রাকাত খোলে।' : 'No fixed time window. The title opens the description, the evidence and the rak‘ahs.')}</p><label class="situational-tick"><input type="checkbox" data-situational-tick="${key}" data-situational-date="${dateKey(selectedDate)}"${done ? ' checked' : ''}><span>${lang()==='bn'?'নামাজ আদায় করেছি':'Prayer performed'}</span></label>${done && !complete ? `<button class="mark-event-complete" type="button" data-mark-event="situational:${key}" data-mark-date="${dateKey(selectedDate)}">${lang()==='bn'?'নামাজের ইভেন্ট সম্পন্ন':'Mark prayer event complete'}</button>` : ''}${done ? `<button class="undo-event-record" type="button" data-undo-event="situational:${key}" data-undo-date="${dateKey(selectedDate)}">${lang()==='bn'?'রেকর্ড বাতিল':'Undo record'}</button>` : ''}</article>`; }).join('');
  list.querySelectorAll('[data-card-info]').forEach(button => button.addEventListener('click', () => toggleCardInfo(button)));
  list.querySelectorAll('[data-situational-tick]').forEach(input => input.addEventListener('change', () => toggleSituationalPrayer(input.dataset.situationalTick, input.dataset.situationalDate, input.checked)));
  bindEventRecordActions(list);
}

function toggleSituationalPrayer(key, dateText, checked) {
  const date = parseDateKey(dateText); if (!date) return;
  const record = dayRecord(date); record.situational ||= {};
  if (checked) record.situational[key] = true; else { delete record.situational[key]; delete record.completedEvents?.[`situational:${key}`]; }
  save(); render();
}

function toggleCardInfo(button) {
  const key = button?.dataset?.cardInfo;
  if (key) navigateToPrayerDescription(key);
}

const DATE_SPECIFIC_VOLUNTARY = ['eid_prayer', 'tarawih'];

/* Before Fajr, the active prayer day is still the previous civil date
   (Isha, Witr, Qiyam and Tahajjud belong to it), so Today's progress follows it. */
function progressDate(now = new Date()) {
  const today = startOfDay(now);
  const times = getTimes(today);
  return times?.fajr && now < times.fajr ? addDays(today, -1) : today;
}

/* Layered state for one prayer day, in prayer-time order on every ring:
   white Fard, green Sunnah, black Nafl, striped standalone voluntary and
   (on days that have them) saffron date-specific prayers. */
function dayLayers(day) {
  const record = dayRecord(day, false);
  const fardFlags = FARD.map(prayer => !!record.fard?.[prayer.key]);
  const fardDone = fardFlags.filter(Boolean).length;
  const events = getVoluntaryEvents(day);
  const { standalone, seasonal } = splitVoluntary(events);
  const voluntaryFlags = standalone.map(event => !!record.voluntary?.[event.key]);
  const seasonalFlags = seasonal.map(event => !!record.voluntary?.[event.key]);
  const doneFlags = events.map(event => !!record.voluntary?.[event.key]);
  const voluntaryDone = doneFlags.filter(Boolean).length;
  // The green/black rings follow the Hanafi rawatib; in Ja'fari mode they are not drawn or required.
  const empty = { flags: [], done: 0, total: 0, complete: false };
  const sunnah = shiaMode() ? empty : layerState(record, 'sunnah');
  const nafl = shiaMode() ? empty : layerState(record, 'nafl');
  const flags = { fard: fardFlags, sunnah: sunnah.flags, nafl: nafl.flags, voluntary: voluntaryFlags, seasonal: seasonalFlags };
  const count = list => ({ done: list.filter(Boolean).length, total: list.length });
  const summary = progressSummary({ fard: count(fardFlags), sunnah: count(sunnah.flags), nafl: count(nafl.flags), voluntary: count(voluntaryFlags), seasonal: count(seasonalFlags) });
  return { record, fardDone, events, standalone, seasonal, doneFlags, voluntaryDone, totalVoluntary: events.length, sunnah, nafl, flags, summary };
}

/** Which progress layer a tick belongs to (for colours and sounds). */
function layerOf(kind, key) {
  if (kind === 'fard') return 'fard';
  if (kind === 'voluntary') return isSeasonal(key) ? 'seasonal' : 'voluntary';
  return kind === 'sunnah' || kind === 'nafl' ? kind : 'voluntary';
}

// Last rendered figure state, so only a newly ticked segment sweeps and only
// a ring that has just closed glows in.
let lastFigure = { day: '', flags: null, reward: false };

/* Calculation profile selects (method, school, high-latitude rule), bilingual. */
function renderProfileSettings() {
  const bn = lang() === 'bn';
  const fill = (id, table, value) => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = Object.entries(table).map(([key, item]) => `<option value="${key}">${escapeHtml(bn ? item.bn : item.en)}</option>`).join('');
    select.value = value;
  };
  fill('methodSelect', CALCULATION_METHODS, state.profile.method);
  fill('schoolSelect', SCHOOLS, state.profile.school);
  fill('highLatSelect', HIGH_LATITUDE_RULES, state.profile.highLatitude);
  const method = CALCULATION_METHODS[state.profile.method];
  const summary = $('profileSummary');
  if (summary) summary.textContent = `${state.profile.method === 'karachi' ? 'Karachi' : method.en.split(' (')[0]} · ${SCHOOL_SHORT[state.profile.school]}`;
  const note = $('profileNote');
  if (note) {
    note.textContent = shiaMode()
      ? (bn ? 'জাফরি মোড: মাগরিব পূর্ব আকাশের লালিমা মিলিয়ে যাওয়ার পর (কোণভিত্তিক), আসর এক গুণ ছায়ায়, এশার শেষ মধ্যরাতে (সূর্যাস্ত ও ফজরের মাঝামাঝি)। যোহর-আসর এবং মাগরিব-এশা একসাথে আদায় করা যায়। হানাফি সুন্নাত/বিতর নির্দেশনা এ মোডে লুকানো থাকে।'
        : 'Ja‘fari mode: Maghrib after the eastern redness disappears (angle-based), Asr at shadow factor 1, Isha ends at midnight (halfway between sunset and Fajr). Dhuhr with Asr and Maghrib with Isha may be combined. Hanafi Sunnah/Witr guidance is hidden in this mode.')
      : (bn ? 'ম্যানুয়াল মিনিট সমন্বয় নির্বাচিত পদ্ধতির ওপর প্রয়োগ হয়। পরিবর্তন সঙ্গে সঙ্গে হিসাব হয় এবং এই ডিভাইসে সংরক্ষিত থাকে; ইতিহাস অপরিবর্তিত থাকে।'
        : 'Manual minute adjustments apply on top of the selected method. Changes recompute immediately and are saved on this device; history is not affected.');
  }
}

/* Day-aware status line under Today's Progress (see src/day-status.js). */
function progressStatus(day, fardDone, now = new Date()) {
  const times = getTimes(day);
  return dayStatus({
    lang: lang(),
    shia: shiaMode(),
    weekday: day.getDay(),
    dayHijri: hijriParts(day),
    nightHijri: currentHijriDate(now),
    fardDone,
    maghribTime: times?.maghrib ? fmt(times.maghrib) : null,
    ishaTime: times?.isha ? fmt(times.isha) : null,
    afterMaghrib: !!(times?.maghrib && now >= times.maghrib),
    hasTimes: !!times
  });
}

/* Conversational line for the card (src/progress-lines.js), kept stable between
   events: the chosen line is remembered per situation, and recent lines are
   remembered (capped) so wording stays fresh for weeks. */
const LINE_MEMORY_KEY = 'prayer-times-line-memory';
/* Today's Progress line on reopen (v1.3.3). While the window stays visible the line changes only on events.
   Each time it is shown again after being hidden to the tray, ONE new line is chosen (never the one on screen).
   Tauri 2 signals this two ways, and both are handled: the Rust side emits `main-window-shown` / `main-window-hidden`
   (window.hide() on close-to-tray does not reliably raise visibilitychange in WebView2), and the page's own
   visibilitychange / focus events cover minimise and restore. A reopen raises several signals; one wins. */
let pendingLineRefresh = 0;
let lineRefreshCount = 0;
let windowWasHidden = false;
let lastReopenAt = 0;
function onWindowReopened(source) {
  if (source !== 'rust' && !windowWasHidden) return; // plain focus changes while visible never change the line
  const now = Date.now();
  windowWasHidden = false;
  if (now - lastReopenAt < 2000) return;
  lastReopenAt = now;
  pendingLineRefresh = ++lineRefreshCount;
  renderProgress();
  pendingLineRefresh = 0;
}

function readLineMemory() {
  try { const m = JSON.parse(localStorage.getItem(LINE_MEMORY_KEY) || '{}'); return { recent: Array.isArray(m.recent) ? m.recent.slice(-400) : [], current: m.current || null, sugg: m.sugg || {} }; }
  catch { return { recent: [], current: null, sugg: {} }; }
}
function writeLineMemory(memory) {
  try { localStorage.setItem(LINE_MEMORY_KEY, JSON.stringify({ ...memory, recent: memory.recent.slice(-400) })); } catch { /* storage full: keep working without memory */ }
}
function conversationalLine(day, now = new Date()) {
  const times = getTimes(day);
  if (!times) return null;
  const record = dayRecord(day, false);
  const fard = getAllFardForDate(day).map(e => {
    const partsAll = prayerParts(e.key).filter(part => !shiaMode() || part.layer === 'fard');
    const ticked = part => (part.layer === 'fard' ? !!record.fard?.[e.key] : !!record[part.layer]?.[part.slot.key]);
    const rak = part => (part.layer === 'fard' ? FARD_RAKAHS[e.key] : parseInt(part.slot.en, 10) || 0);
    const at = record.at?.[`fard:${e.key}`];
    return {
      key: e.key, start: e.start.getTime(), end: e.end.getTime(), done: !!record.fard?.[e.key],
      tickedAt: Array.isArray(at) && Number.isFinite(at[0]) ? e.start.getTime() + at[0] * 60000 : null,
      parts: partsAll.filter(ticked).map(rak).filter(Boolean),
      full: partsAll.length > 0 && partsAll.every(ticked)
    };
  });
  const today = dateKey(day);
  const habits = analyzeHabits(state.history, today);
  const memory = readLineMemory();
  // a Sunnah/Nafl suggestion: rare, with a short heads-up shortly before it opens and again while it is open (see src/habits.js)
  const candidates = shiaMode() ? [] : getVoluntaryEvents(day)
    .filter(e => ['duha', 'awwabin'].includes(e.key) && now.getTime() >= e.start.getTime() - VOLUNTARY_HEADS_UP_MINUTES * 60000 && now < e.end)
    .map(e => ({ kind: 'voluntary', key: e.key, phase: now >= e.start ? 'open' : 'soon', name: { en: e.key === 'duha' ? 'Duha' : 'Awwabin', bn: e.key === 'duha' ? 'দুহা' : 'আওয়াবিন' } }));
  const picked = shiaMode() ? null : pickSuggestion({ candidates, history: state.history, todayKey: today, memory: memory.sugg, shia: false });
  const result = progressLine({
    lang: lang(), dateKey: today, now: now.getTime(), friday: day.getDay() === 5,
    fmt: ms => fmt(new Date(ms)), fard, habits, memory: { ...memory, recent: recentIdsWithin(memory.recent, now.getTime()) }, refresh: pendingLineRefresh, suggestion: picked ? { name: picked.name, phase: picked.phase } : null,
    banIds: recentIdsWithin(memory.recent, now.getTime())
  });
  pendingLineRefresh = 0;
  if (!result) return null;
  if (!memory.current || memory.current.sig !== result.sig || memory.current.id !== result.id) {
    memory.recent.push({ id: result.id, at: now.getTime() });
    memory.current = { sig: result.sig, id: result.id };
  }
  if (picked && result.suggested && memory.sugg.day !== today) memory.sugg = { day: today, key: picked.key };
  writeLineMemory(memory);
  return result;
}

let recognitionShow = null;
function noteRecognition(before, after) {
  const summary = after?.summary;
  if (!summary) return;
  const was = before?.summary?.layers?.fard?.done || 0;
  const fardDone = summary.layers?.fard?.done || 0;
  const key = recognitionKey({
    fardDone,
    firstJustNow: fardDone === 1 && was === 0,
    sunnahComplete: !!summary.complete?.sunnah,
    ghairComplete: !!summary.complete?.nafl,
    voluntaryDone: !!summary.complete?.voluntary,
    allStructured: !!summary.great,
    flexible: !!summary.complete?.seasonal
  });
  if (!key) return;
  const seconds = recognitionSeconds(key, {
    fardDone,
    sunnahCount: summary.layers?.sunnah?.done || 0,
    naflCount: summary.layers?.nafl?.done || 0,
    pace: state.recognitionPace
  });
  recognitionShow = { key, until: Date.now() + seconds * 1000 };
}
function activeRecognition() {
  if (!recognitionShow || Date.now() > recognitionShow.until) return null;
  return phraseLines(recognitionShow.key, lang());
}

function renderProgress() {
  const day = progressDate(new Date());
  const { fardDone, standalone, seasonal, sunnah, nafl, flags, summary } = dayLayers(day);
  const key = dateKey(day);
  const previous = lastFigure.day === key ? lastFigure.flags : null;
  const changes = previous ? figureChanges(previous, flags) : { sweep: new Set(), closing: new Set() };
  const rewardFade = summary.reward && !!previous && !lastFigure.reward;
  const figure = $('progressFigure');
  figure.innerHTML = figureSvg(flags, { sweep: changes.sweep, closing: changes.closing, rewardFade });
  lastFigure = { day: key, flags, reward: summary.reward };
  const core = $('progressCore');
  const recognition = activeRecognition();
  if (recognition) {
    core.replaceChildren();
    const ar = document.createElement('b');
    ar.className = 'recog-ar';
    ar.textContent = recognition.ar;
    const tr = document.createElement('small');
    tr.className = 'recog-tr';
    tr.textContent = recognition.tr;
    const meaning = document.createElement('small');
    meaning.className = 'recog-mean';
    meaning.textContent = recognition.meaning;
    core.append(ar, tr, meaning);
    core.classList.add('is-recognition');
    core.hidden = false;
  } else {
    core.textContent = `${fardDone}/5`;
    core.classList.remove('is-recognition');
    core.hidden = summary.reward;
  }
  const visual = $('progressVisual');
  visual.classList.toggle('all-done', summary.good);
  visual.classList.toggle('great-done', summary.great);
  visual.classList.toggle('disc-done', summary.fardDisc);
  visual.classList.toggle('has-seasonal', summary.hasSeasonal);
  $('legendSeasonal').hidden = !summary.hasSeasonal;
  const status = progressStatus(day, fardDone);
  const line = status ? null : conversationalLine(day);
  const plainTitle = lang() === 'bn' ? 'আজ' : 'Today';
  $('progressTitle').textContent = summary.great ? 'Great Job!' : summary.good ? 'Good Job!' : status ? status.title : plainTitle;
  const statusEl = $('progressStatus');
  // Once Good/Great Job takes the title, a date headline moves into the line.
  statusEl.textContent = status ? (summary.good && status.key !== 'all-done' ? `${status.title} · ${status.detail}` : status.detail) : (line?.text || '');
  statusEl.dataset.tier = status ? String(status.tier) : 'line';
  statusEl.dataset.key = status ? status.key : (line?.state || 'none');
  statusEl.hidden = !statusEl.textContent;
  const bn = lang() === 'bn';
  const n = value => bn ? localizeDigits(value) : value;
  const L = summary.layers;
  const seasonalText = summary.hasSeasonal
    ? (bn ? ` · বিশেষ দিনের নামাজ ${n(L.seasonal.done)}/${n(L.seasonal.total)}` : ` · date-specific ${L.seasonal.done}/${L.seasonal.total}`)
    : '';
  const caption = summary.great
    ? (bn ? 'আজকের ফরজ, সুন্নাত, নফল ও সব নফল ইবাদত সম্পন্ন হয়েছে।' : 'All Fard, Sunnah, Nafl and every voluntary prayer for today are complete.')
    : bn
      ? `ফরজ ${n(fardDone)}/৫ · সুন্নাত ${n(sunnah.done)}/${n(sunnah.total)} · নফল ${n(nafl.done)}/${n(nafl.total)} · অন্যান্য নফল ${n(L.voluntary.done)}/${n(L.voluntary.total)}${seasonalText}`
      : `Fard ${fardDone}/5 · Sunnah ${sunnah.done}/${sunnah.total} · Nafl ${nafl.done}/${nafl.total} · other voluntary ${L.voluntary.done}/${L.voluntary.total}${seasonalText}`;
  const captionEl = $('progressCaption');
  captionEl.textContent = caption;
  const aria = bn
    ? `${caption}${summary.reward ? ' · আলহামদুলিল্লাহ' : ''}`
    : `${caption}${summary.reward ? ' · Alhamdulillah' : ''}`;
  visual.dataset.originalAriaLabel = aria;
  visual.setAttribute('aria-label', aria);
  void standalone; void seasonal;
  translateRenderedText();
}

/* A prayer's parts in performance order (e.g. Dhuhr: 4 Sunnah before, Fard,
   2 Sunnah after, 2 Nafl): large white Fard circle, smaller green Sunnah and
   black Nafl circles, joined by short connectors. Clickable only while that
   prayer's window is open, like the main tick; correctable by unticking. */
function partsHtml(prayerKey, date, enabled, { includeFard = true } = {}) {
  const record = dayRecord(date, false);
  const bn = lang() === 'bn';
  const L = bn ? 'bn' : 'en';
  // Ja'fari mode shows only the Fard (the Sunnah/Nafl here follow Hanafi rawatib).
  const parts = prayerParts(prayerKey).filter(part => (includeFard || part.layer !== 'fard') && (!shiaMode() || part.layer === 'fard'));
  const items = parts.map(part => {
    if (part.layer === 'fard') {
      const done = !!record.fard?.[prayerKey];
      const lk = done ? lockTipFor('fard', prayerKey, date) : '';
      const label = fardPartLabel(prayerKey, date, L);
      const aria = bn ? `${slotName(prayerKey, date)} ফরজ সম্পন্ন হিসেবে চিহ্নিত করুন` : `Mark ${slotName(prayerKey, date)} Fard complete`;
      return `<button type="button" class="part-tick fard${done ? ' done' : ''}${lk ? ' is-locked' : ''}" data-sub-layer="fard" data-sub-key="${prayerKey}" data-sub-prayer="${prayerKey}" data-sub-date="${dateKey(date)}" aria-pressed="${done}"${lk ? ` aria-disabled="true" data-locked="true"` : ''} aria-label="${escapeHtml(aria)}" title="${escapeHtml(label)}"${enabled ? '' : ' disabled'}><i aria-hidden="true">${done ? '✓' : ''}</i><span>${escapeHtml(label)}</span>${lk ? lockMarkHtml(lk, true) : ''}</button>`;
    }
    const { layer, slot } = part;
    const done = !!record[layer]?.[slot.key];
    const lk = done ? lockTipFor(layer, slot.key, date) : '';
    const label = slotShortLabel(slot, date, L);
    const full = slotLabel(slot, date, L);
    const kind = layer === 'sunnah' ? (bn ? 'সুন্নাত' : 'Sunnah') : (bn ? 'নফল' : 'Nafl');
    return `<button type="button" class="part-tick ${layer}${done ? ' done' : ''}${lk ? ' is-locked' : ''}" data-sub-layer="${layer}" data-sub-key="${slot.key}" data-sub-prayer="${prayerKey}" data-sub-date="${dateKey(date)}" aria-pressed="${done}"${lk ? ` aria-disabled="true" data-locked="true"` : ''} aria-label="${escapeHtml(`${slotName(prayerKey, date)} · ${kind}: ${full}`)}" title="${escapeHtml(`${kind}: ${full}`)}"${enabled ? '' : ' disabled'}><i aria-hidden="true">${done ? '✓' : ''}</i><span>${escapeHtml(label)}</span>${lk ? lockMarkHtml(lk, true) : ''}</button>`;
  });
  if (!items.length) return '';
  return `<div class="prayer-parts${enabled ? '' : ' is-closed'}" role="group" aria-label="${bn ? 'সুন্নাত, ফরজ ও নফল' : 'Sunnah, Fard and Nafl'}">${items.join('<span class="part-link" aria-hidden="true"></span>')}</div>`;
}

/* Note on a Daily prayers card, by school (src/prayer-card-notes.js). The Sunnah/Nafl
   sub-ticks stay available on the "available right now" card of the open prayer,
   which is the only time they can be ticked anyway. */
function prayerNoteHtml(prayerKey) {
  const note = cardNote(prayerKey, lang(), shiaMode() ? 'jafari' : state.profile.school);
  if (!note) return '';
  return `<p class="prayer-note">${escapeHtml(note.text)} <span class="prayer-note-ref">${escapeHtml(note.ref)}</span></p>`;
}

/** Sound cues for a tick/untick on one layer of a prayer day. */
function playLayerSound(layer, ticked, before, after) {
  if (!state.sound) return;
  const step = Math.max(1, after.summary.layers[layer]?.done || 1);
  const cues = soundCues({
    layer,
    ticked,
    step,
    ringClosed: ticked && !!after.summary.complete[layer] && !before.summary.complete[layer],
    dayComplete: ticked && after.summary.reward && !before.summary.reward
  });
  playCues(cues, state.tickStyle, window);
}

function toggleSubPrayer(layer, key, prayerKey, dateText) {
  if (layer === 'fard') return togglePrayer('fard', prayerKey, dateText);
  const slot = findSlot(layer, key);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || '');
  if (!slot || slot.prayer !== prayerKey || !match) return;
  const eventDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (dayRecord(eventDate, false)[layer]?.[key] && lockState(layer, key, eventDate).locked) return;
  const parent = findRecordableEvent('fard', prayerKey, eventDate);
  const fardDone = !!dayRecord(eventDate, false).fard?.[prayerKey];
  const partLock = parent ? lockInstant(lockItem(layer, key), lockContext(eventDate).events, lockContext(eventDate).nextFajr) : null;
  if (!parent || !partRecordable({ position: slot.position, fardDone, start: parent.start, end: parent.end, now: new Date(), lockAt: partLock && partLock.at })) {
    showToast('This prayer event is not currently available.');
    render();
    return;
  }
  const before = dayLayers(eventDate);
  const record = dayRecord(eventDate);
  const target = record[layer] || (record[layer] = {});
  if (target[key]) {
    delete target[key];
    if (record.at) delete record.at[`${layer}:${key}`];
    save();
    playLayerSound(layer, false, before, dayLayers(eventDate));
    render();
    return;
  }
  target[key] = true;
  save();
  const after = dayLayers(eventDate);
  playLayerSound(layer, true, before, after);
  noteRecognition(before, after);
  render();
  const { summary, sunnah, nafl } = after;
  if (summary.great) showToast('Great Job!');
  else if (layer === 'sunnah') showToast(sunnah.complete ? 'All Sunnah prayers complete' : 'Sunnah marked complete');
  else showToast(nafl.complete ? 'All prayer-linked Nafl complete' : 'Nafl marked complete');
}

function completionCount(record) {
  return ['fard', 'voluntary', 'sunnah', 'nafl'].reduce((sum, layer) => sum + Object.keys(record[layer] || {}).length, 0);
}

function seasonalDescriptionWindows(now = new Date()) {
  if (!hasLocation()) return [];
  const windows = [];
  // Find the Ramadan-night cluster around now and the next cycle. The scan
  // uses the following daytime Hijri date, not the civil date at Isha.
  const clusters = [];
  let cluster = null;
  let previousDate = null;
  for (let offset = -35; offset <= 380; offset++) {
    const date = addDays(now, offset);
    const times = getTimes(date);
    if (!times) continue;
    if (isRamadanNight(times.isha)) {
      if (!cluster || (date.getTime() - previousDate.getTime()) > 36 * 60 * 60 * 1000) {
        if (cluster) clusters.push(cluster);
        cluster = { first: { date, times }, last: { date, times } };
      } else cluster.last = { date, times };
      previousDate = date;
    } else if (cluster) {
      clusters.push(cluster); cluster = null; previousDate = null;
    }
  }
  if (cluster) clusters.push(cluster);
  const nowMs = now.getTime();
  const ramadan = clusters.find(item => {
    const start = item.first.times.isha.getTime() - 24 * 60 * 60 * 1000;
    const nextTimes = getTimes(addDays(item.last.date, 1));
    const end = nextTimes?.fajr?.getTime() || item.last.times.isha.getTime() + 12 * 60 * 60 * 1000;
    return nowMs >= start && nowMs <= end;
  });
  if (ramadan) {
    const nextTimes = getTimes(addDays(ramadan.last.date, 1));
    windows.push({ key: 'tarawih', start: new Date(ramadan.first.times.isha.getTime() - 24 * 60 * 60 * 1000), end: nextTimes?.fajr || addMinutes(ramadan.last.times.isha, 12 * 60) });
  }
  // Eid descriptions are shown only from 24 hours before the calculated local
  // Eid prayer window until the start of Zawal.
  for (let offset = -1; offset <= 370; offset++) {
    const date = addDays(now, offset);
    const hijri = hijriParts(date);
    if (!hijri || !((hijri.month === 10 && hijri.day === 1) || (hijri.month === 12 && hijri.day === 10))) continue;
    const times = getTimes(date);
    if (!times) continue;
    const start = addMinutes(times.sunrise, 20);
    const end = times.zawalStart;
    const visibleFrom = start.getTime() - 24 * 60 * 60 * 1000;
    if (nowMs >= visibleFrom && nowMs <= end.getTime()) windows.push({ key: 'eid_prayer', start: new Date(visibleFrom), end });
  }
  return windows;
}

/* Reference card for one prayer: the Qur'an verse or hadith is the focus (quote
   treatment with its reference line); rak'ahs and guidance sit below, quieter.
   The evidence set follows the school (src/prayer-evidence.js). */
function referenceCardHtml(key, titleText) {
  const bn = lang() === 'bn';
  const school = shiaMode() ? 'jafari' : state.profile.school;
  const jumuah = key === 'dhuhr' && selectedDate.getDay() === 5;
  const guidance = jumuah ? PRAYER_GUIDANCE.jumuah : PRAYER_GUIDANCE[key];
  if (!guidance) return '';
  const evidence = evidenceFor(jumuah ? 'jumuah' : key, school, bn ? 'bn' : 'en');
  const quotes = (evidence?.items || []).map((item, n) => `<figure class="ref-quote${n ? ' ref-quote-minor' : ''}" data-kind="${item.kind}"><blockquote>${escapeHtml(item.text)}</blockquote><figcaption>${escapeHtml(item.ref)}</figcaption></figure>`).join('');
  const note = evidence?.note ? `<p class="ref-note">${escapeHtml(evidence.note)}</p>` : '';
  const guideText = bn ? guidance.guideBn : guidance.guide;
  const showGuide = !shiaMode() || !/Hanafi|mu’akkadah|হানাফি|মুয়াক্কাদা/.test(`${guidance.guide} ${guidance.rakahs}`);
  const rakahLine = shiaMode() && !showGuide ? '' : `<p class="ref-rakahs"><strong>${bn ? 'রাকাত' : 'Rak‘ahs'}:</strong> ${escapeHtml(bn ? guidance.bn : guidance.rakahs)}</p>`;
  const guide = showGuide ? `<p class="ref-guide">${escapeHtml(guideText)}</p>` : '';
  const below = rakahLine || guide ? `<div class="ref-practical">${rakahLine}${guide}</div>` : '';
  return `<article class="ref-card" id="description-${key}"><h4 class="ref-title">${escapeHtml(titleText)}</h4>${quotes}${note}${below}</article>`;
}

/* Settings > Home page sections: a hidden section is `hidden` and is not rendered at all (no DOM, no work). */
function applySectionVisibility() {
  for (const id of ['prayerDetails', 'quranSection', 'quranReader', 'onThisDaySection', 'sunnahSection', 'descriptionList']) {
    const el = $(id);
    if (!el) continue;
    el.hidden = true;
    if (id !== 'prayerDetails') el.textContent = '';
  }
}

function renderPrayerGuidance() {
  const root = $('descriptionList');
  if (!root) return;
  const bn = lang() === 'bn';
  const groups = [
    { title: 'Obligatory prayers', keys: ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] },
    { title: 'Daily voluntary prayers', keys: ['duha', 'awwabin', 'qiyam', 'tahajjud', 'witr', 'rawatib'] },
    { title: 'Situational voluntary prayers', keys: ['tahiyyatul_masjid', 'istikhara', 'tawbah'] }
  ];
  const hidden = shiaMode() ? JAFARI_HIDDEN : [];
  const seasonal = seasonalDescriptionWindows(new Date()).filter(item => !hidden.includes(item.key));
  if (seasonal.length) groups.push({ title: 'Seasonal prayer events', keys: seasonal.map(item => item.key) });
  const seasonalTitle = 'Seasonal prayer events';
  const groupCard = { 'Obligatory prayers': 'obligatory', 'Daily voluntary prayers': 'daily', 'Situational voluntary prayers': 'situational', 'Seasonal prayer events': 'seasonal' };
  const rendered = groups.filter(group => state.cards[groupCard[group.title]] !== false).map(group => {
    const cards = group.keys.filter(key => !hidden.includes(key)).map(key => referenceCardHtml(key, slotName(key, selectedDate))).join('');
    const heading = escapeHtml(bn ? ({'Obligatory prayers':'ফরজ নামাজ','Daily voluntary prayers':'দৈনিক নফল নামাজ','Situational voluntary prayers':'পরিস্থিতিভিত্তিক নফল নামাজ','Seasonal prayer events':'মৌসুমি নামাজ'}[group.title]) : group.title);
    const tone = { obligatory: 'card-obligatory', daily: 'card-daily', situational: 'card-situational', seasonal: 'card-special' }[groupCard[group.title]] || '';
    if (group.title === seasonalTitle) return cards ? `<section class="description-group ${tone}"><h3>${heading}</h3><div id="seasonalDescriptionCarousel" class="seasonal-carousel"></div></section>` : '';
    return cards ? `<section class="description-group"><h3>${heading}</h3><div class="ref-grid">${cards}</div></section>`.replace('description-group"', `description-group ${tone}"`) : '';
  }).join('');
  root.innerHTML = rendered;
  // Seasonal events that overlap (for example the last Tarawih and the coming
  // Eid prayer) are paged in one carousel instead of being stacked.
  const seasonalHost = $('seasonalDescriptionCarousel');
  if (seasonalHost) {
    renderCarousel(seasonalHost, 'seasonal-descriptions', seasonal.map(item => {
      const html = referenceCardHtml(item.key, prayerName(item.key));
      return html ? { key: item.key, html } : null;
    }).filter(Boolean), 'Seasonal prayer descriptions');
  }
}

function weeklyAnchor(now = new Date()) {
  return weekStart(now);
}

/* Weekly Prayer Progress: Saturday to Friday, full days, 5 Fard cells per day
   (35 per week) and a Nafl ring per day. Friday is highlighted and its
   midday cell reads Dhuhr/Jumu’ah. */
function renderWeeklyReview() {
  const root = $('weeklyReview');
  if (!root) return;
  const now = new Date();
  const anchor = weeklyAnchor(now);
  const bn = lang() === 'bn';
  const L = bn ? 'bn' : 'en';
  const num = value => bn ? localizeDigits(value) : String(value);
  const dates = sevenCycleDates(anchor);
  const fard = weeklyFardTally(dates, date => dayRecord(date, false));
  let naflTotal = 0, naflPossible = 0, sunnahTotal = 0, sunnahPossible = 0, linkedTotal = 0, linkedPossible = 0;
  const today = startOfDay(now);
  const days = fard.days.map(({ date, cells, count }, i) => {
    const record = dayRecord(date, false);
    const events = getVoluntaryEvents(date);
    const naflCount = events.filter(event => record.voluntary?.[event.key]).length;
    naflTotal += naflCount; naflPossible += events.length;
    const layers = dayLayers(date);
    const sunnah = layers.sunnah;
    const linked = layers.nafl;
    sunnahTotal += sunnah.done; sunnahPossible += sunnah.total;
    linkedTotal += linked.done; linkedPossible += linked.total;
    const isToday = dateKey(date) === dateKey(now);
    const future = date > today;
    const friday = date.getDay() === FRIDAY;
    // Per-cell Fard states (Friday's Dhuhr/Jumu’ah slot included) for the day's tooltip.
    const fardStates = cells.map(cell => `${slotName(cell.key, date)}: ${cell.done ? (bn ? 'সম্পন্ন' : 'done') : (bn ? 'বাকি' : 'not marked')}`).join(' · ');
    const fardLabel = bn ? `${num(count)}/৫ ফরজ` : `${count}/5 Fard`;
    const naflLabel = bn ? `সুন্নাত ${num(sunnah.done)}/${num(sunnah.total)}, নফল ${num(linked.done)}/${num(linked.total)}, নফল ইভেন্ট ${num(naflCount)}/${num(events.length)}` : `Sunnah ${sunnah.done}/${sunnah.total}, Nafl ${linked.done}/${linked.total}, voluntary ${naflCount}/${events.length}`;
    const dayLocked = dayIsLocked(dateKey(date), dateKey(progressDate(now)), state.lockWatermark);
    const dayTitle = `${dayName(date)}${friday ? ` · ${FRIDAY_DHUHR_LABEL[L]}` : ''}\n${fardStates}${dayLocked && count ? `\n${lockTip(null, L)}` : ''}`;
    return `<div class="week-day${dayLocked ? ' is-locked' : ''}${isToday ? ' today' : ''}${friday ? ' friday' : ''}${future ? ' future' : ''}${count === 5 ? ' day-complete' : ''}" title="${escapeHtml(dayTitle)}" role="group" aria-label="${escapeHtml(`${dayName(date)}: ${fardLabel}, ${naflLabel}`)}">`
      + `<strong>${WEEK_DAY_LABELS[L][i]}</strong><span class="week-date">${escapeHtml(new Intl.DateTimeFormat(bn ? 'bn-BD' : 'en-GB', { day: 'numeric' }).format(date))}</span>`
      + `<span class="week-figure" aria-hidden="true" title="${escapeHtml(naflLabel)}">${figureSvg(layers.flags, { mini: true })}</span>`
      + `<small>${future ? '—' : `${num(count)}/${num(5)} · ${num(naflCount)}/${num(events.length)}`}</small>`
      + `${friday ? `<em class="week-jumuah">${escapeHtml(FRIDAY_DHUHR_LABEL[L])}</em>` : ''}</div>`;
  });
  const fardPct = fard.possible ? Math.round(fard.done / fard.possible * 100) : 0;
  const naflPct = naflPossible ? Math.round(naflTotal / naflPossible * 100) : 0;
  const range = `${new Intl.DateTimeFormat(bn ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short' }).format(dates[0])} – ${new Intl.DateTimeFormat(bn ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short' }).format(dates[6])}`;
  const foot = bn
    ? `সপ্তাহ শনিবার থেকে শুক্রবার · প্রতিদিন ৫ ওয়াক্ত ফরজ (সপ্তাহে ৩৫) · শুক্রবারের যোহর/জুমা—যেকোনোটি আদায় করলেই সম্পন্ন`
    : `Week runs Saturday to Friday · 5 Fard every day (35 a week) · Friday’s Dhuhr/Jumu’ah slot is complete with either prayer`;
  root.innerHTML = `<div class="week-summary"><div><span>${bn ? 'সাপ্তাহিক ফরজ' : 'WEEKLY FARD'}</span><strong>${num(fard.done)}/${num(fard.possible)} <small>· ${num(fardPct)}%</small></strong></div><div><span>${bn ? 'সাপ্তাহিক সুন্নাত' : 'WEEKLY SUNNAH'}</span><strong>${num(sunnahTotal)}/${num(sunnahPossible)}</strong></div><div><span>${bn ? 'সাপ্তাহিক নফল' : 'WEEKLY NAFL'}</span><strong>${num(linkedTotal)}/${num(linkedPossible)}</strong></div><div><span>${bn ? 'নফল ইভেন্ট' : 'VOLUNTARY EVENTS'}</span><strong>${num(naflTotal)}/${num(naflPossible)} <small>· ${num(naflPct)}%</small></strong></div><div class="week-range"><span>${bn ? 'এই সপ্তাহ' : 'THIS WEEK'}</span><strong>${escapeHtml(range)}</strong></div></div><div class="week-constellation">${days.join('')}</div><p class="week-foot">${escapeHtml(foot)}</p>`;
}

/* Settings > Calculation profile keeps today's prohibited intervals (moved from the old home-page timetable). */
function renderSettingsIntervals() {
  const box = $('settingsIntervals');
  if (!box) return;
  const times = hasLocation() ? getTimes(startOfDay(new Date())) : null;
  if (!times) { box.textContent = '—'; return; }
  const bn = lang() === 'bn';
  const names = shiaMode() ? { sunrise: bn ? 'সূর্যোদয় (মাকরুহ)' : 'Sunrise (disliked)', zawal: bn ? 'জাওয়াল (মাকরুহ)' : 'Zawal (disliked)', sunset: bn ? 'সূর্যাস্তের আগে (মাকরুহ)' : 'Before sunset (disliked)' }
    : { sunrise: bn ? 'সূর্যোদয়' : 'Sunrise', zawal: bn ? 'জাওয়াল' : 'Zawal', sunset: bn ? 'সূর্যাস্তের আগে' : 'Before sunset' };
  const lines = prohibitedIntervals(times).map(item => `${names[item.key]}: ${fmt(item.start)} – ${fmt(item.end)}`);
  if (shiaMode() && times.midnight) lines.push(`${bn ? 'মধ্যরাত (ইশার শেষ)' : 'Midnight (end of Isha)'}: ${fmt(times.midnight)}`);
  box.textContent = lines.join('\n');
}

/* The hero counts down to the next EVENT of any kind: an obligatory or voluntary
   prayer, the start or end of a prohibited (Ja'fari: disliked) interval, or the
   Ja'fari midnight, from one ordered timeline (src/day-timeline.js). */
function dayTimelineFor(now) {
  const today = startOfDay(now);
  const days = [];
  for (const offset of [-1, 0, 1]) {
    const date = addDays(today, offset);
    const times = getTimes(date);
    const nextTimes = getTimes(addDays(date, 1));
    if (!times || !nextTimes) continue;
    days.push({
      fard: getFardEvents(date, times, nextTimes),
      voluntary: getVoluntaryEvents(date, times, nextTimes),
      prohibited: prohibitedIntervals(times),
      midnight: shiaMode() ? times.midnight : null
    });
  }
  return buildTimeline(days);
}

function getNextEvent(now = new Date()) {
  // Next event = the soonest PRAYER event (obligatory or voluntary). Prohibited intervals and midnight are never targets.
  const timeline = dayTimelineFor(now);
  const next = nextPrayerEventAfter(timeline, now);
  if (!next) return null;
  const following = nextPrayerEventAfter(timeline, next.at);
  const start = new Date(next.at);
  const date = next.date || startOfDay(start);
  return { ...next, start, end: new Date(following ? following.at : next.at + 60000), date };
}

function renderNextPrayer() {
  const next = getNextEvent(new Date());
  nextPrayer = next;
  const card = document.querySelector('.next-card');
  if (!next) {
    $('nextName').textContent = '—';
    $('nextCountdownOpen').textContent = '—';
    $('nextMeta').textContent = 'Prayer times are unavailable';
    card?.classList.remove('is-interval');
    return;
  }
  const label = eventLabel(next, { lang: lang(), shia: shiaMode(), prayerName: key => slotName(key, next.date) });
  next.title = label.name;
  card?.classList.remove('is-interval');
  $('nextEyebrow').textContent = 'NEXT EVENT';
  $('nextName').textContent = label.name;
  $('nextName').dataset.kind = next.kind;
  $('nextMeta').textContent = `${label.verb} ${fmt(next.start)} · ${state.place || 'Saved location'}`;
  const activeFard = getActiveEvents().find(event => event.kind === 'fard');
  const school = SCHOOL_SHORT[state.profile.school];
  $('currentMeta').textContent = activeFard ? `Current: ${prayerName(activeFard.key)} · ${school}` : `No obligatory prayer window is active · ${school}`;
  updateTopCountdown();
}

function updateTopCountdown() {
  if (!nextPrayer) return;
  $('nextCountdownOpen').textContent = countdown(nextPrayer.start.getTime() - Date.now());
}

function openNextCountdown() {
  if (!nextPrayer) return;
  const real = findRecordableEvent(nextPrayer.kind, nextPrayer.key, nextPrayer.date);
  countdownState = {
    key: nextPrayer.key,
    kind: nextPrayer.kind,
    title: nextPrayer.title,
    start: real?.start || nextPrayer.start,
    end: real?.end || nextPrayer.end,
    date: dateKey(nextPrayer.date),
    eid: nextPrayer.eid || '',
    friday: nextPrayer.key === 'dhuhr' && nextPrayer.date?.getDay?.() === 5,
    description: 'The countdown to the next event begins at the displayed local time.'
  };
  openCountdownView();
}

function openEventCountdown(dataset) {
  const start = Number(dataset.start);
  const end = Number(dataset.end);
  const key = dataset.key || dataset.eta;
  if (!key || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const kind = dataset.kind || (FARD.some(item => item.key === key) ? 'fard' : 'voluntary');
  countdownState = {
    key,
    kind,
    title: slotName(key, new Date(start)),
    start: new Date(start),
    end: new Date(end),
    date: dataset.date || dateKey(new Date(start)),
    eid: dataset.eid || '',
    friday: key === 'dhuhr' && new Date(start).getDay() === 5,
    description: 'Time remaining in this available prayer period.'
  };
  openCountdownView();
}

function openCountdownView() {
  if (!countdownState) return;
  homeScrollTop = window.scrollY || 0;
  currentPage = 'countdown';
  $('homeView').hidden = true;
  $('settingsView').hidden = true;
  $('timeView').hidden = true;
  $('countdownView').hidden = false;
  $('settingsToggle').hidden = true;
  $('countdownTitle').textContent = countdownState.title;
  $('countdownEyebrow').textContent = 'PRAYER COUNTDOWN';
  $('countdownDescription').textContent = countdownState.description;
  renderCountdownView();
  window.scrollTo(0, 0);
}

function countdownEventDate() {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(countdownState?.date || '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : startOfDay(countdownState.start);
}

function renderCountdownDetails() {
  const rootR = $('eventRakahCard');
  const rootC = $('eventCompletionCard');
  const rootT = $('eventTimingCard');
  if (!rootR || !rootC || !rootT || !countdownState) return;
  const bn = lang() === 'bn';
  const key = countdownState.key;
  const date = countdownEventDate();
  const guide = key === 'dhuhr' && date.getDay() === 5 ? PRAYER_GUIDANCE.jumuah : PRAYER_GUIDANCE[key];
  const school = shiaMode() ? 'jafari' : state.profile.school;
  const rakah = guide && (!shiaMode() || !/Hanafi|mu’akkadah|হানাফি|মুয়াক্কাদা/.test(`${guide.guide || ''} ${guide.rakahs || ''}`)) ? (bn ? guide.bn : guide.rakahs) : '';
  rootR.innerHTML = `<div class="eyebrow">${bn ? 'রাকাত' : "RAK'AH"}</div><h2>${escapeHtml(countdownState.title)}</h2><p>${escapeHtml(rakah || (bn ? 'এই ইভেন্টের জন্য আলাদা রাকাত ধরা হয়নি।' : 'No separate rak‘ah count is fixed for this event.'))}</p><p class="muted">${escapeHtml(bn ? `মাজহাব: ${SCHOOL_SHORT[school] || school}` : `School: ${SCHOOL_SHORT[school] || school}`)}</p>`;
  const recordEvent = findRecordableEvent(countdownState.kind, key, date);
  const lock = recordEvent ? lockInstant(lockItem(countdownState.kind === 'fard' ? 'fard' : countdownState.kind, key), lockContext(date).events, lockContext(date).nextFajr) : null;
  const open = !!recordEvent && recordingOpen(recordEvent.start, recordEvent.end, lock && lock.at, new Date());
  const parts = countdownState.kind === 'fard' ? partsHtml(key, date, open, { includeFard: true }) : '';
  const record = dayRecord(date, false);
  const done = !!record[countdownState.kind]?.[key];
  const voluntaryControl = countdownState.kind !== 'fard' ? `<button class="secondary-button" type="button" data-record-kind="${countdownState.kind}" data-record-key="${key}" data-record-date="${dateKey(date)}"${open ? '' : ' disabled'}>${done ? (bn ? 'রেকর্ড খুলুন' : 'Undo record') : (bn ? 'সম্পন্ন রেকর্ড করুন' : 'Record completion')}</button>` : '';
  const lines = summaryLines({ ...countdownState, date, kind: countdownState.kind });
  rootC.innerHTML = `<div class="eyebrow">${bn ? 'রেকর্ড' : 'COMPLETION'}</div><h2>${bn ? 'যা রেকর্ড হয়েছে' : 'Recorded completion'}</h2>${parts || voluntaryControl || `<p class="muted">${bn ? 'এই মুহূর্তে রেকর্ড করা যাচ্ছে না।' : 'Recording is not open for this event right now.'}</p>`}${eventActionHtml({ ...countdownState, date }, record)}${lines.length ? `<ul class="summary-lines">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : `<p class="muted">${bn ? 'এখনো কোনো অংশ রেকর্ড হয়নি।' : 'No part is recorded yet. Sunnah and Nafl are not assumed.'}</p>`}`;
  bindEventRecordActions(rootC);
  rootT.innerHTML = `<div class="eyebrow">${bn ? 'সময়' : 'EVENT TIMING'}</div><h2>${escapeHtml(fmt(countdownState.start))} – ${escapeHtml(fmt(countdownState.end))}</h2><p>${escapeHtml(dayName(countdownState.start))}</p><p class="muted">${escapeHtml(open && recordEvent && new Date() >= recordEvent.end ? (bn ? 'শুধু রেকর্ড। নামাজের সময় শেষ।' : 'Recording only. The prayer time has ended.') : (bn ? 'গণনা নির্বাচিত পদ্ধতি ও মাজহাব অনুসরণ করে।' : 'Times follow the selected calculation profile and madhab.'))}</p>`;
}

function renderCountdownView() {
  if (!countdownState || currentPage !== 'countdown') return;
  const now = Date.now();
  let labelText;
  let remaining;
  if (now < countdownState.start.getTime()) {
    labelText = 'Begins in';
    remaining = countdownState.start.getTime() - now;
  } else if (now < countdownState.end.getTime()) {
    labelText = 'Time remaining';
    remaining = countdownState.end.getTime() - now;
  } else {
    labelText = 'This prayer period has ended';
    remaining = null;
  }
  $('countdownLarge').textContent = remaining == null ? '—' : countdown(remaining);
  $('countdownDescription').textContent = labelText;
  $('countdownStart').textContent = `Begins ${fmt(countdownState.start)} · Ends ${fmt(countdownState.end)} · ${dayName(countdownState.start)}`;
  const best = $('bestBlock');
  const pref = preferredWindow(countdownState.key, countdownState.start, countdownState.end, state.profile.school, { friday: countdownState.friday, eid: countdownState.eid });
  const phase = preferredState(pref, now);
  const hero = $('eventHero');
  if (hero) hero.classList.toggle('is-best', phase === 'active');
  $('countdownLarge').classList.toggle('is-gold', phase === 'active');
  if (best) {
    if (phase === 'none' || phase === 'expired') best.hidden = true;
    else {
      best.hidden = false;
      const before = phase === 'upcoming';
      $('bestCountdown').textContent = countdown((before ? pref.start.getTime() : pref.end.getTime()) - now);
      $('bestNote').textContent = `${before ? (lang()==='bn' ? 'উত্তম সময় শুরু হতে' : 'Preferred window begins in') : (lang()==='bn' ? 'উত্তম সময় বাকি' : 'Preferred window remaining')} · ${lang()==='bn' ? pref.bn : pref.en}`;
    }
  }
  renderCountdownDetails();
  translateRenderedText();
}

function navigateToPrayerDescription(key) {
  const dialog = $('eventInfo');
  const body = $('eventInfoBody');
  const title = $('eventInfoTitle');
  if (!dialog || !body) return;
  const name = slotName(key, selectedDate);
  if (title) title.textContent = name;
  body.innerHTML = referenceCardHtml(key, name) || `<p>${escapeHtml(lang() === 'bn' ? 'এই ইভেন্টের আলাদা বিবরণ নেই।' : 'No separate description is stored for this event.')}</p>`;
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  else dialog.hidden = false;
}

function fardLookback(now = new Date()) {
  const events = [];
  for (let offset = -8; offset <= 1; offset++) {
    const date = addDays(startOfDay(now), offset);
    const times = getTimes(date);
    const next = getTimes(addDays(date, 1));
    if (!times || !next) continue;
    for (const event of getFardEvents(date, times, next)) events.push({ ...event, dateKey: dateKey(date) });
  }
  return events;
}

function openTimeView() {
  homeScrollTop = window.scrollY || 0;
  currentPage = 'time';
  $('homeView').hidden = true;
  $('countdownView').hidden = true;
  $('settingsView').hidden = true;
  $('timeView').hidden = false;
  $('settingsToggle').hidden = true;
  renderTimeView();
  window.scrollTo(0, 0);
}

function renderTimeView() {
  const root = $('timeCards');
  if (!root) return;
  const now = new Date();
  const bn = lang() === 'bn';
  const times = getTimes(startOfDay(now));
  const next = getNextPrayer(now);
  const active = getActiveEvents(now).find(event => event.kind === 'fard') || getActiveEvents(now)[0];
  const focus = active || next;
  const mainCount = focus ? countdown((active ? focus.end.getTime() : next.start.getTime()) - now.getTime()) : '—';
  const mainLabel = active ? (bn ? 'এই ওয়াক্ত শেষ হতে' : 'Time remaining in this prayer') : (bn ? 'পরবর্তী ফরজ শুরু হতে' : 'Until the next obligatory prayer');
  const pref = focus ? preferredWindow(focus.key, focus.start, focus.end, state.profile.school, { friday: focus.key === 'dhuhr' && focus.date.getDay() === 5, eid: focus.eid || '' }) : null;
  const phase = preferredState(pref, now);
  const preferredCard = phase === 'none' || phase === 'expired' || !pref ? '' : `<article class="page-card panel${phase === 'active' ? ' is-best' : ''}" id="timePreferredCard"><div class="eyebrow">${bn ? 'উত্তম সময়' : 'PREFERRED TIME'}</div><h2 id="timePreferredHeading">${escapeHtml(phase === 'active' ? (bn ? 'উত্তম সময় চলছে' : 'Preferred window is open') : (bn ? 'উত্তম সময় আসছে' : 'Preferred window is ahead'))}</h2><div class="countdown-large${phase === 'active' ? ' is-gold' : ''}" id="timePreferredCount">${escapeHtml(countdown((phase === 'upcoming' ? pref.start.getTime() : pref.end.getTime()) - now.getTime()))}</div><p>${escapeHtml(bn ? pref.bn : pref.en)}</p></article>`;
  const guide = focus ? (focus.key === 'dhuhr' && focus.date.getDay() === 5 ? PRAYER_GUIDANCE.jumuah : PRAYER_GUIDANCE[focus.key]) : null;
  const sun = hasLocation() ? sunPosition(now, state.lat, state.lon) : null;
  const moon = hasLocation() ? moonPosition(now, state.lat, state.lon) : null;
  const pass = hasLocation() ? moonPass(now, state.lat, state.lon) : null;
  const timing = [];
  if (times) for (const key of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']) if (times[key]) timing.push(`<li><span>${escapeHtml(prayerName(key))}</span><strong>${escapeHtml(fmt(times[key]))}</strong></li>`);
  if (times?.solarNoon) timing.push(`<li><span>${bn ? 'সৌর মধ্যাহ্ন' : 'Solar noon'}</span><strong>${escapeHtml(fmt(times.solarNoon))}</strong></li>`);
  if (times?.zawalStart) timing.push(`<li><span>${bn ? 'জাওয়াল' : 'Zawal'}</span><strong>${escapeHtml(fmt(times.zawalStart))}–${escapeHtml(fmt(times.zawalEnd))}</strong></li>`);
  if (sun) timing.push(`<li><span>${bn ? 'সূর্য' : 'Sun'}</span><strong>${escapeHtml(bn ? localizeDigits(Math.round(sun.altitude)) + '° / ' + localizeDigits(Math.round(sun.azimuth)) + '°' : Math.round(sun.altitude) + '° alt · ' + Math.round(sun.azimuth) + '° az')}</strong></li>`);
  if (moon) timing.push(`<li><span>${bn ? 'চাঁদ' : 'Moon'}</span><strong>${escapeHtml(bn ? localizeDigits(Math.round(moon.altitude)) + '° / ' + localizeDigits(Math.round(moon.azimuth)) + '°' : Math.round(moon.altitude) + '° alt · ' + Math.round(moon.azimuth) + '° az')}</strong></li>`);
  if (pass?.rise) timing.push(`<li><span>${bn ? 'চাঁদ ওঠে' : 'Moonrise'}</span><strong>${escapeHtml(fmt(pass.rise))}</strong></li>`);
  if (pass?.set) timing.push(`<li><span>${bn ? 'চাঁদ ডোবে' : 'Moonset'}</span><strong>${escapeHtml(fmt(pass.set))}</strong></li>`);
  const recordCard = focus ? (() => {
    const lines = summaryLines(focus);
    const openDataset = `data-kind="${focus.kind}" data-key="${focus.key}" data-date="${dateKey(focus.date)}" data-start="${focus.start.getTime()}" data-end="${focus.end.getTime()}"`;
    return `<article class="page-card panel"><div class="eyebrow">${bn ? 'রেকর্ড' : 'COMPLETION'}</div><h2>${escapeHtml(slotName(focus.key, focus.date))}</h2>${lines.length ? `<ul class="summary-lines">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : `<p class="muted">${bn ? 'এখনো কিছু রেকর্ড হয়নি।' : 'Nothing is recorded for this event yet.'}</p>`}<button class="secondary-button" type="button" id="timeOpenEvent" ${openDataset}>${bn ? 'পুরো পৃষ্ঠা খুলুন' : 'Open the full event page'}</button></article>`;
  })() : '';
  root.innerHTML = `<article class="page-card panel countdown-focus${phase === 'active' ? ' is-best' : ''}"><div class="eyebrow">${bn ? 'নামাজের গণনা' : 'MAIN PRAYER COUNTDOWN'}</div><h1 id="timeNow">${escapeHtml(formatClock(now, { lang: lang(), clock: state.clock, seconds: true }))}</h1><p id="timeDate">${escapeHtml(dayName(now))} · ${escapeHtml($('hijriDateLabel')?.textContent || '')}</p><div class="countdown-large${phase === 'active' ? ' is-gold' : ''}" id="timeMainCount" data-time-main-count>${escapeHtml(mainCount)}</div><p>${escapeHtml(focus ? slotName(focus.key, focus.date) + ' · ' + mainLabel : mainLabel)}</p></article>${preferredCard}<article class="page-card panel"><div class="eyebrow">${bn ? 'ইভেন্ট' : 'PRAYER EVENT'}</div><h2>${escapeHtml(focus ? slotName(focus.key, focus.date) : (bn ? 'কোনো ইভেন্ট নেই' : 'No event'))}</h2><p>${escapeHtml(focus ? fmt(focus.start) + ' – ' + fmt(focus.end) : '')}</p></article><article class="page-card panel"><div class="eyebrow">${bn ? 'রাকাত' : "RAK'AH"}</div><h2>${escapeHtml(guide ? (bn ? guide.bn : guide.rakahs) : (bn ? '—' : '—'))}</h2><p class="muted">${escapeHtml(guide ? (bn ? guide.guideBn : guide.guide) : '')}</p></article>${recordCard}<article class="page-card panel"><div class="eyebrow">${bn ? 'জ্যোতির্বিজ্ঞান' : 'EVENT TIMING'}</div><ul class="fact-list">${timing.join('')}</ul></article>`;
  const opener = $('timeOpenEvent');
  if (opener) opener.addEventListener('click', () => openEventCountdown(opener.dataset));
}

function openSettings() {
  homeScrollTop = window.scrollY || 0;
  currentPage = 'settings';
  $('homeView').hidden = true;
  $('countdownView').hidden = true;
  $('timeView').hidden = true;
  $('settingsView').hidden = false;
  $('settingsToggle').hidden = false;
  $('settingsToggle').innerHTML = homeIcon;
  $('settingsToggle').setAttribute('aria-label', 'Home');
  $('settingsToggle').title = 'Home';
  syncSettingsControls();
  translateRenderedText();
  window.scrollTo(0, 0);
}

function openHome() {
  if (!hasLocation()) {
    showToast('Set your location with a Google Maps link or coordinates first.');
    openSettings();
    return;
  }
  const previous = currentPage;
  currentPage = 'home';
  $('settingsView').hidden = true;
  $('countdownView').hidden = true;
  $('timeView').hidden = true;
  $('homeView').hidden = false;
  $('settingsToggle').hidden = false;
  $('settingsToggle').innerHTML = gearIcon;
  $('settingsToggle').setAttribute('aria-label', 'Settings');
  $('settingsToggle').title = 'Settings';
  countdownState = null;
  render();
  if (previous !== 'home') window.setTimeout(() => window.scrollTo(0, homeScrollTop), 0);
}

function renderEventReminderSettings() {
  const root = $('eventReminderSettings');
  if (!root) return;
  const labels = Object.fromEntries([...FARD, ...REMINDER_VOLUNTARY].map(item => [item.key, lang() === 'bn' ? (item.bn || item.en) : item.en]));
  const options = [0, 5, 10, 15, 20, 30, 40, 50, 60];
  const hijriNow = currentHijriDate(new Date());
  root.innerHTML = [...FARD, ...REMINDER_VOLUNTARY].filter(item => reminderRowVisible(item.key, hijriNow)).map(item => {
    const value = Number(state.reminders[item.key] || 0);
    return `<div class="event-reminder-row"><label for="reminder-${item.key}">${escapeHtml(labels[item.key])}</label><select id="reminder-${item.key}" data-reminder-key="${item.key}" aria-label="${escapeHtml(labels[item.key])} reminder"><option value="0">${lang() === 'bn' ? 'বন্ধ' : 'Off'}</option>${options.slice(1).map(min => `<option value="${min}" ${value === min ? 'selected' : ''}>${min} ${lang() === 'bn' ? 'মিনিট আগে' : 'min before'}</option>`).join('')}</select></div>`;
  }).join('');
  root.querySelectorAll('[data-reminder-key]').forEach(select => select.addEventListener('change', event => {
    state.reminders[event.target.dataset.reminderKey] = Number(event.target.value) || 0;
    save();
  }));
}

/* Minutes before each obligatory prayer begins: any whole number 0–180 (0 = off). */
function renderPreReminderSettings() {
  const root = $('preReminderSettings');
  if (!root) return;
  const bn = lang() === 'bn';
  root.innerHTML = FARD.map(item => {
    const label = bn ? (item.bn || item.en) : item.en;
    const value = Number(state.preReminders[item.key] || 0);
    return `<div class="event-reminder-row"><label for="pre-reminder-${item.key}">${escapeHtml(label)}</label><span class="pre-reminder-field"><input id="pre-reminder-${item.key}" class="pre-reminder-input" type="number" inputmode="numeric" min="0" max="${PRE_REMINDER_MAX}" step="1" value="${value}" data-pre-reminder-key="${item.key}" aria-label="${escapeHtml(bn ? `${label}-এর কত মিনিট আগে স্মরণ করাবে` : `Minutes before ${label} begins`)}"><small>${bn ? 'মিনিট আগে' : 'min before'}</small></span></div>`;
  }).join('');
  root.querySelectorAll('[data-pre-reminder-key]').forEach(input => input.addEventListener('change', event => {
    const key = event.target.dataset.preReminderKey;
    const minutes = parseReminderMinutes(event.target.value);
    if (minutes === null) {
      event.target.value = Number(state.preReminders[key] || 0);
      showToast('Enter whole minutes from 0 to 180');
      return;
    }
    if (minutes) state.preReminders[key] = minutes; else delete state.preReminders[key];
    event.target.value = minutes;
    save();
  }));
}

function syncSettingsControls() {
  $('themeSelect').value = state.theme;
  $('languageSelect').value = state.language;
  $('soundToggle').checked = state.sound;
  $('tickStyleSelect').value = state.tickStyle;
  $('clockFormatSelect').value = state.clock;
  renderUiFontSelect();
  renderProfileSettings();
  $('compactToggle').checked = state.compact;
  $('notificationsToggle').checked = state.notifications;
  if ($('showDescriptionsToggle')) $('showDescriptionsToggle').checked = state.sections.descriptions;
  if ($('showSunnahToggle')) $('showSunnahToggle').checked = state.sections.sunnah;
  if ($('showOnThisDayToggle')) $('showOnThisDayToggle').checked = state.sections.onThisDay;
  document.querySelectorAll('[data-card]').forEach(box => { box.checked = state.cards[box.dataset.card] !== false; });
  document.querySelectorAll('.card-toggles').forEach(group => { const on = state.sections[{ showDescriptionsToggle: 'descriptions', showSunnahToggle: 'sunnah', showOnThisDayToggle: 'onThisDay' }[group.dataset.tab]]; group.querySelectorAll('input').forEach(input => { input.disabled = !on; }); });
  renderEventReminderSettings();
  renderPreReminderSettings();
  $('latitude').value = hasLocation() ? state.lat : '';
  $('longitude').value = hasLocation() ? state.lon : '';
  $('startupToggle').checked = !!state.startup;
  $('savedLocationText').textContent = hasLocation() ? 'Saved location' : 'Location not configured';
  $('savedCoordinates').textContent = hasLocation() ? `${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}` : '—';
  for (const [key, value] of Object.entries(state.adjustments)) {
    const input = $(`adjust-${key}`);
    if (input) input.value = value;
  }
}

function renderSettingsSummary() {
  renderSettingsIntervals();
  if ($('savedLocationText')) {
    $('savedLocationText').textContent = hasLocation() ? 'Saved location' : 'Location not configured';
    $('savedCoordinates').textContent = hasLocation() ? `${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}` : '—';
  }
}

function useMapLink() {
  const text = $('mapsLink').value.trim();
  if (!text) {
    setTranslatedText('mapLinkNote', 'Paste a Google Maps share link first.');
    return;
  }
  if (!isGoogleMapsUrl(text)) {
    setTranslatedText('mapLinkNote', 'Enter a valid Google Maps HTTPS link.');
    return;
  }
  const coords = parseCoordinates(text);
  if (!coords) {
    setTranslatedText('mapLinkNote', 'This Maps link does not contain readable coordinates. Shortened links cannot be expanded offline; copy the latitude and longitude from Maps and enter them below.');
    return;
  }
  $('latitude').value = coords.lat;
  $('longitude').value = coords.lon;
  setTranslatedText('mapLinkNote', `Coordinates found: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}. Select Save location to store them on this device.`);
}

function saveLocation() {
  const latText = $('latitude').value.trim();
  const lonText = $('longitude').value.trim();
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    setTranslatedText('locationStatus', 'Enter valid coordinates: latitude −90 to 90, longitude −180 to 180.');
    return;
  }
  state.lat = lat;
  state.lon = lon;
  state.place = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  save();
  setTranslatedText('locationStatus', 'Location saved locally on this device.');
  translateRenderedText();
  showToast('Location saved');
  openHome();
}

/* ---- Locking of marked events (src/tick-lock.js) ------------------------- */
function lockContext(date) {
  const times = getTimes(date);
  const nextTimes = getTimes(addDays(date, 1));
  const afterTimes = getTimes(addDays(date, 2));
  if (!times || !nextTimes) return { events: [], nextFajr: null };
  const events = [...getFardEvents(date, times, nextTimes), ...getVoluntaryEvents(date, times, nextTimes)];
  if (afterTimes) events.push(...getFardEvents(addDays(date, 1), nextTimes, afterTimes));
  return { events, nextFajr: nextTimes.fajr };
}

function lockItem(layer, key) {
  const slot = layer === 'sunnah' || layer === 'nafl' ? findSlot(layer, key) : null;
  return { kind: layer, key, prayer: slot ? slot.prayer : undefined };
}

/** Is this ticked item locked now, and which event's start locked it. */
function lockState(layer, key, date, now = new Date()) {
  const dayStr = dateKey(date);
  const ctx = lockContext(startOfDay(date));
  const lock = lockInstant(lockItem(layer, key), ctx.events, ctx.nextFajr);
  const sealed = !!dayRecord(date, false).locked?.[lockKey(layer, key)];
  const locked = sealed || dayIsLocked(dayStr, dateKey(progressDate(now)), state.lockWatermark) || (!!lock && now.getTime() >= lock.at);
  return { locked, by: lock ? lock.by : null };
}

/** "Locked after Dhuhr began" in the current language, or '' when not locked. */
function lockTipFor(layer, key, date, now = new Date()) {
  const { locked, by } = lockState(layer, key, date, now);
  if (!locked) return '';
  const byDate = by === 'fajr' ? addDays(startOfDay(date), 1) : startOfDay(date);
  return lockTip(by ? slotName(by, byDate) : null, lang());
}

/** Small lock icon with a tooltip. Inside a button it is decoration only (the button itself is focusable and carries the text). */
function lockMarkHtml(tip, inButton = false) {
  return inButton
    ? `<span class="lock-mark" aria-hidden="true" data-lock-tip="${escapeHtml(tip)}"></span>`
    : `<span class="lock-mark" role="img" tabindex="0" aria-label="${escapeHtml(tip)}" data-lock-tip="${escapeHtml(tip)}"></span>`;
}

/** Remember locks as they happen (so a clock set back never re-opens them) and advance the date watermark. */
function sealLocks(now = new Date()) {
  const day = progressDate(now);
  const times = getTimes(day);
  const dhuhrStarted = !!(times?.dhuhr && now >= times.dhuhr);
  let changed = false;
  const watermark = nextWatermark(state.lockWatermark, dateKey(day), addDaysKey, dhuhrStarted);
  if (watermark !== state.lockWatermark) { state.lockWatermark = watermark; changed = true; }
  for (const target of [addDays(day, -1), day]) {
    const record = state.history[dateKey(target)];
    if (!record) continue;
    const ctx = lockContext(target);
    changed = sealRecord(record, (layer, key) => ({ item: lockItem(layer, key), events: ctx.events, nextFajr: ctx.nextFajr }), now) || changed;
  }
  if (changed) save();
}

function togglePrayer(kind, key, dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || '');
  if (!match) return;
  const eventDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // A locked tick can no longer be unmarked: no toast, no error sound (the tooltip explains it).
  if (dayRecord(eventDate, false)[kind]?.[key] && lockState(kind, key, eventDate).locked) return;
  const event = findRecordableEvent(kind, key, eventDate);
  const lock = event ? lockInstant(lockItem(kind, key), lockContext(eventDate).events, lockContext(eventDate).nextFajr) : null;
  if (!event || !recordingOpen(event.start, event.end, lock && lock.at, new Date())) {
    showToast('This prayer event is not currently available.');
    renderLiveEvents();
    return;
  }
  const layer = layerOf(kind, key);
  const before = dayLayers(eventDate);
  const record = dayRecord(eventDate);
  const completionMap = ensureCompletedEventMap(eventDate, record);
  const eventId = `${kind}:${key}`;
  if (!Object.prototype.hasOwnProperty.call(completionMap, eventId)) completionMap[eventId] = false;
  const target = record[kind] || (record[kind] = {});
  if (target[key]) {
    delete target[key];
    if (record.completedEvents) delete record.completedEvents[`${kind}:${key}`];
    if (record.at) delete record.at[`${kind}:${key}`];
    save();
    playLayerSound(layer, false, before, dayLayers(eventDate));
    render();
    return;
  }
  target[key] = true;
  // v1.3.2: when it was ticked (minutes after the window opened, minute of day) for the offline habit learning
  (record.at || (record.at = {}))[`${kind}:${key}`] = [Math.max(0, Math.round((Date.now() - event.start.getTime()) / 60000)), new Date().getHours() * 60 + new Date().getMinutes()];
  save();
  // One tick per new completion in the layer's own voice; its pitch steps
  // through the pentatonic scale with that layer's count. Closing a ring adds
  // a small flourish; completing every layer plays the completion chime.
  const after = dayLayers(eventDate);
  playLayerSound(layer, true, before, after);
  noteRecognition(before, after);
  render();
  // Good Job = all five Fard; Great Job = every layer present that day.
  const { summary } = after;
  if (summary.great) showToast('Great Job!');
  else if (summary.good) showToast('Good Job!');
  else showToast('Prayer marked complete');
}


function updateClock() {
  $('liveClock').textContent = formatClock(new Date(), { lang: lang(), clock: state.clock, seconds: true });
  $('dateLabel').textContent = dayName(new Date());
  const hijriDate = new Intl.DateTimeFormat(lang()==='bn'?'bn-BD':'en-GB-u-ca-islamic-umalqura', {day:'numeric',month:'long',year:'numeric',calendar:'islamic-umalqura'}).format(islamicCalendarDateAt(new Date()));
  $('hijriDateLabel').textContent = hijriDate;
  updateSky();
}

/* Sky panel under the header/clock: the sun crosses a dashed arc from sunrise to sunset, the moon from
   moonrise to moonset in its current phase (faint while the sun is up); sky colour, stars and clouds follow the
   sun's altitude. Offline maths (src/sky.js) from the saved latitude/longitude; redrawn only when the minute
   changes or the panel is resized. Twinkle and drift are CSS (transform/opacity only). */
let lastSkyKey = '';
let skyGeom = null;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PHASE_NAMES = {
  new: ['New moon', 'অমাবস্যা'], full: ['Full moon', 'পূর্ণিমা'],
  'first-quarter': ['First quarter', 'প্রথম অর্ধচন্দ্র'], 'last-quarter': ['Last quarter', 'শেষ অর্ধচন্দ্র'],
  'waxing-crescent': ['Waxing crescent', 'বর্ধমান সরু চাঁদ'], 'waxing-gibbous': ['Waxing gibbous', 'বর্ধমান, প্রায় পূর্ণ'],
  'waning-gibbous': ['Waning gibbous', 'ক্ষীয়মাণ, প্রায় পূর্ণ'], 'waning-crescent': ['Waning crescent', 'ক্ষীয়মাণ সরু চাঁদ']
};
const svgElement = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
function nightArcPoint(f, width, horizonY, depth, margin) {
  const x = margin + (width - 2 * margin) * (1 - f);
  return { x, y: horizonY + depth * Math.sin(Math.PI * f) };
}
function nightArcPath(width, horizonY, depth, margin, steps = 96) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const p = nightArcPoint(i / steps, width, horizonY, depth, margin);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}

function drawObservatoryFrame(width, height) {
  const host = $('skyFiligree');
  if (!host) return;
  host.textContent = '';
  const inset = Math.max(7, Math.min(width, height) * 0.045);
  host.append(svgElement('rect', { class: 'sky-frame', x: inset.toFixed(1), y: inset.toFixed(1), width: (width - inset * 2).toFixed(1), height: (height - inset * 2).toFixed(1), rx: Math.max(10, height * 0.08).toFixed(1) }));
  const leaves = Math.max(10, Math.round(width / 78));
  const leaf = (x, y, flip) => {
    const s = Math.max(4.5, height * 0.055);
    const d = flip
      ? `M${x} ${y}c${(-s).toFixed(1)} ${(-s * 1.4).toFixed(1)} ${(s * .2).toFixed(1)} ${(-s * 1.7).toFixed(1)} ${(s * 1.05).toFixed(1)} ${(-s * .2).toFixed(1)}c${(-s * .15).toFixed(1)} ${(s * .7).toFixed(1)} ${(-s * .85).toFixed(1)} ${(s * 1.15).toFixed(1)} ${(-s * 1.05).toFixed(1)} ${(s * .2).toFixed(1)}z`
      : `M${x} ${y}c${s.toFixed(1)} ${(s * 1.4).toFixed(1)} ${(-s * .2).toFixed(1)} ${(s * 1.7).toFixed(1)} ${(-s * 1.05).toFixed(1)} ${(s * .2).toFixed(1)}c${(s * .15).toFixed(1)} ${(-s * .7).toFixed(1)} ${(s * .85).toFixed(1)} ${(-s * 1.15).toFixed(1)} ${(s * 1.05).toFixed(1)} ${(-s * .2).toFixed(1)}z`;
    return d;
  };
  for (let i = 0; i < leaves; i++) {
    const x = inset + ((width - inset * 2) * (i + 0.5)) / leaves;
    host.append(svgElement('path', { class: i % 2 ? 'sky-leaf silver' : 'sky-leaf gold', d: leaf(x.toFixed(1), inset.toFixed(1), false) }));
    host.append(svgElement('path', { class: i % 2 ? 'sky-leaf gold' : 'sky-leaf silver', d: leaf(x.toFixed(1), (height - inset).toFixed(1), true) }));
  }
}

function updateSky(force = false) {
  const panel = $('skyPanel');
  if (!panel) return;
  if (!hasLocation()) { panel.hidden = true; return; }
  panel.hidden = false;
  const now = new Date();
  const W = panel.clientWidth, Hh = panel.clientHeight;
  if (!W || !Hh) return;
  const key = `${Math.floor(now.getTime() / 60000)}|${lang()}|${state.clock}|${state.lat}|${state.lon}|${state.adjustments.sunrise}|${W}x${Hh}`;
  if (key === lastSkyKey && !force) placeSkyBodies(now);
  if (!force && key === lastSkyKey) return;
  lastSkyKey = key;
  const bn = lang() === 'bn';
  const u = Math.max(.72, Hh / 150);
  const margin = Math.max(28, W * .045);
  const railY = Hh - Math.max(12, Hh * .12);
  const horizonY = Hh * .56;
  const apexY = Hh * .20;
  const nightDepth = Math.max(8, railY - horizonY - Math.max(22, Hh * .16));
  const times = getTimes(startOfDay(now));
  const sun = sunPosition(now, state.lat, state.lon);
  const phase = moonPhase(now);
  const pass = moonPass(now, state.lat, state.lon);
  const okTimes = !!times && Number.isFinite(times.sunrise?.getTime()) && Number.isFinite(times.sunset?.getTime()) && times.sunset > times.sunrise;
  const svg = $('skySvg');
  svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
  const bg = svg.querySelector('.sky-bg');
  if (bg) { bg.setAttribute('width', W); bg.setAttribute('height', Hh); }
  const wash = svg.querySelector('#skyObservatoryBg');
  if (wash) { wash.setAttribute('gradientUnits', 'userSpaceOnUse'); wash.setAttribute('x1', '0'); wash.setAttribute('y1', '0'); wash.setAttribute('x2', '0'); wash.setAttribute('y2', String(Hh)); }
  $('skyClipRect').setAttribute('width', W); $('skyClipRect').setAttribute('height', Hh);
  $('skyArcDay').setAttribute('d', timeArcPath(W, horizonY, apexY, margin));
  $('skyArcNight').setAttribute('d', nightArcPath(W, horizonY, nightDepth, margin));
  $('skyMoonArc').setAttribute('d', timeArcPath(W, horizonY - 5 * u, Math.max(6, apexY - 6 * u), margin));
  $('skyMoonNightArc').setAttribute('d', nightArcPath(W, horizonY + 3 * u, Math.max(6, nightDepth - 4 * u), margin));
  $('skyHorizon').setAttribute('d', `M${margin * .55} ${horizonY.toFixed(1)}H${(W - margin * .55).toFixed(1)}`);
  const arch = $('skyArch');
  if (arch) arch.setAttribute('d', '');
  if ($('skyGridOuter')) $('skyGridOuter').setAttribute('d', '');
  if ($('skyGridInner')) $('skyGridInner').setAttribute('d', '');
  if ($('skyGridRadials')) $('skyGridRadials').setAttribute('d', '');
  $('skyObservatoryGlow').setAttribute('cx', (W / 2).toFixed(1));
  $('skyObservatoryGlow').setAttribute('cy', (horizonY - Hh * .12).toFixed(1));
  $('skyObservatoryGlow').setAttribute('r', (Math.min(W * .28, Hh * 1.1)).toFixed(1));

  const sunUp = okTimes && now >= times.sunrise && now < times.sunset;
  let sunPoint;
  if (okTimes && sunUp) {
    sunPoint = timeArcPoint(passFraction(times.sunrise, times.sunset, now) ?? .5, W, horizonY, apexY, margin);
  } else if (okTimes) {
    const yesterday = getTimes(addDays(startOfDay(now), -1));
    const tomorrow = getTimes(addDays(startOfDay(now), 1));
    const previousSet = now < times.sunrise ? yesterday?.sunset : times.sunset;
    const nextRise = now < times.sunrise ? times.sunrise : tomorrow?.sunrise;
    if (previousSet && nextRise && nextRise > previousSet) {
      const f = Math.max(0, Math.min(1, (now - previousSet) / (nextRise - previousSet)));
      sunPoint = nightArcPoint(f, W, horizonY, nightDepth, margin);
    }
  }
  sunPoint ||= { x: W / 2, y: horizonY + nightDepth * .6 };
  const sunScale = Math.max(.82, Math.min(1.25, u));
  $('skySun').style.transform = `translate(${sunPoint.x.toFixed(1)}px, ${sunPoint.y.toFixed(1)}px) scale(${sunScale.toFixed(3)})`;
  $('skySun').style.opacity = '1';
  panel.style.setProperty('--sky-i', sunIntensity(sun.altitude, 90 - Math.abs(state.lat - sun.declination)).toFixed(3));

  let moonPoint;
  const moonF = pass.up ? passFraction(pass.rise, pass.set, now) : null;
  if (pass.up && moonF !== null) {
    moonPoint = timeArcPoint(moonF, W, horizonY - 5 * u, Math.max(6, apexY - 6 * u), margin);
  } else {
    const prior = moonPass(new Date(now.getTime() - 24 * 3600000), state.lat, state.lon);
    if (prior.set && pass.rise && pass.rise > prior.set) {
      const f = Math.max(0, Math.min(1, (now - prior.set) / (pass.rise - prior.set)));
      moonPoint = nightArcPoint(f, W, horizonY + 3 * u, Math.max(6, nightDepth - 4 * u), margin);
    }
  }
  moonPoint ||= { x: W / 2, y: horizonY + nightDepth * .45 };
  $('skyMoon').style.transform = `translate(${moonPoint.x.toFixed(1)}px, ${moonPoint.y.toFixed(1)}px) scale(${sunScale.toFixed(3)})`;
  $('skyMoon').style.opacity = '1';
  $('skyMoon').classList.toggle('is-below', !pass.up);
  const litD = moonLitPath(phase.illumination, phase.waxing, 0, 0, 16, state.lat < 0);
  $('skyMoonClipPath').setAttribute('d', litD);

  skyColors(sun.altitude, okTimes ? now < times.dhuhr : now.getHours() < 12).forEach((hex, i) => panel.style.setProperty(`--sk-l${i}`, hex));
  panel.dataset.mode = sunUp ? 'day' : 'night';

  // Exact prohibited intervals from the same rule engine used everywhere else in the app.
  drawObservatoryFrame(W, Hh);
  const zonesEl = $('skyZones');
  zonesEl.textContent = '';
  const intervals = okTimes ? prohibitedIntervals(times) : [];
  const obstacles = [sunPoint, moonPoint].filter(Boolean);
  const bodyGap = 22 * sunScale;
  const slicePath = (f0, f1) => {
    const steps = 32;
    let d = '';
    let pen = false;
    for (let i = 0; i <= steps; i++) {
      const f = f0 + (f1 - f0) * (i / steps);
      const p = timeArcPoint(f, W, horizonY, apexY, margin);
      const blocked = obstacles.some(point => Math.hypot(p.x - point.x, p.y - point.y) < bodyGap);
      if (blocked) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const spans = okTimes ? zoneSpans(intervals, times.sunrise, times.sunset) : [];
  for (const zone of spans) {
    const g = svgElement('g', { class: `sky-zone z-${zone.key}` });
    const dashes = slicePath(zone.f0, zone.f1);
    const halo = svgElement('path', { class: 'sky-zone-halo', d: dashes });
    const track = svgElement('path', { class: 'sky-zone-track', d: dashes });
    const edgeAt = fraction => {
      const p = timeArcPoint(fraction, W, horizonY, apexY, margin);
      const ahead = timeArcPoint(Math.min(1, fraction + 0.012), W, horizonY, apexY, margin);
      const dx = ahead.x - p.x, dy = ahead.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const h = Math.max(5, 6 * u);
      return svgElement('path', { class: 'sky-zone-edge', d: `M${(p.x + nx * h).toFixed(1)} ${(p.y + ny * h).toFixed(1)}L${(p.x - nx * h).toFixed(1)} ${(p.y - ny * h).toFixed(1)}` });
    };
    const sourceInterval = intervals.find(item => item.key === zone.key);
    const active = !!sourceInterval && now >= sourceInterval.start && now < sourceInterval.end;
    if (active) g.classList.add('is-active');
    g.append(halo, track, edgeAt(zone.f0), edgeAt(zone.f1)); zonesEl.append(g);
  }
  const footer = $('skyObservatoryFooter');
  footer.innerHTML = intervals.map(item => {
    const label = PROHIBITED_LABELS[item.key][bn ? 'bn' : 'en'];
    const active = now >= item.start && now < item.end;
    return `<span class="sky-zone-chip${active ? ' is-active' : ''}"><i></i><b>${escapeHtml(label)}</b><small>${escapeHtml(fmt(item.start))}–${escapeHtml(fmt(item.end))}</small></span>`;
  }).join('');
  const percent = Math.round(phase.illumination * 100);
  const phaseText = PHASE_NAMES[phaseName(phase)][bn ? 1 : 0];
  const moon = moonPosition(now, state.lat, state.lon);
  const noon = okTimes && times.solarNoon ? fmt(times.solarNoon) : '';
  const zawal = okTimes && times.zawalStart ? `${fmt(times.zawalStart)}–${fmt(times.zawalEnd)}` : '';
  $('skyHeading').textContent = bn ? 'চাঁদ ও সূর্যের অবস্থান' : 'CELESTIAL OBSERVATORY';
  $('skyPosition').textContent = bn
    ? `সূর্য ${localizeDigits(Math.round(sun.altitude))}° · দিগন্ত ${localizeDigits(Math.round(sun.azimuth))}° · চাঁদ ${localizeDigits(Math.round(moon.altitude))}° · ${phaseText}${noon ? ` · মধ্যাহ্ন ${noon}` : ''}`
    : `SUN ${Math.round(sun.altitude)}° · AZ ${Math.round(sun.azimuth)}° · MOON ${Math.round(moon.altitude)}° · ${percent}% · ${phaseText.toUpperCase()}${noon ? ` · NOON ${noon}` : ''}${zawal ? ` · ZAWAL ${zawal}` : ''}`;
  const parts = [
    bn ? `সূর্যের উচ্চতা ${localizeDigits(Math.round(sun.altitude))}° দিগন্ত ${localizeDigits(Math.round(sun.azimuth))}°` : `Sun altitude ${Math.round(sun.altitude)}° azimuth ${Math.round(sun.azimuth)}°`,
    bn ? `চাঁদ ${localizeDigits(percent)}% আলোকিত, ${phaseText}` : `Moon ${percent}% lit, ${phaseText}`
  ];
  if (okTimes) parts.push(`${bn ? 'সূর্যোদয়' : 'Sunrise'} ${fmt(times.sunrise)}`, `${bn ? 'সূর্যাস্ত' : 'Sunset'} ${fmt(times.sunset)}`);
  if (pass.rise && pass.set) parts.push(`${bn ? 'চাঁদ ওঠে' : 'Moonrise'} ${fmt(pass.rise)}`, `${bn ? 'চাঁদ ডোবে' : 'Moonset'} ${fmt(pass.set)}`);
  panel.setAttribute('aria-label', parts.join(' · '));
  panel.title = parts.join(' · ');
  skyGeom = { W, Hh, margin, horizonY, apexY, nightDepth, u, times, okTimes, pass, phase };
}

function placeSkyBodies(now) {
  const g = skyGeom;
  const panel = $('skyPanel');
  if (!g || !panel) return;
  const { W, margin, horizonY, apexY, nightDepth, u, times, okTimes, pass, phase } = g;
  const sun = sunPosition(now, state.lat, state.lon);
  const sunUp = okTimes && now >= times.sunrise && now < times.sunset;
  let sunPoint;
  if (okTimes && sunUp) sunPoint = timeArcPoint(passFraction(times.sunrise, times.sunset, now) ?? .5, W, horizonY, apexY, margin);
  else if (okTimes) {
    const yesterday = getTimes(addDays(startOfDay(now), -1));
    const tomorrow = getTimes(addDays(startOfDay(now), 1));
    const previousSet = now < times.sunrise ? yesterday?.sunset : times.sunset;
    const nextRise = now < times.sunrise ? times.sunrise : tomorrow?.sunrise;
    if (previousSet && nextRise && nextRise > previousSet) {
      const f = Math.max(0, Math.min(1, (now - previousSet) / (nextRise - previousSet)));
      sunPoint = nightArcPoint(f, W, horizonY, nightDepth, margin);
    }
  }
  sunPoint ||= { x: W / 2, y: horizonY + nightDepth * .6 };
  const sunScale = Math.max(.82, Math.min(1.25, u));
  $('skySun').style.transform = `translate(${sunPoint.x.toFixed(1)}px, ${sunPoint.y.toFixed(1)}px) scale(${sunScale.toFixed(3)})`;
  $('skySun').style.opacity = '1';
  let moonPoint;
  const moonF = pass.up ? passFraction(pass.rise, pass.set, now) : null;
  if (pass.up && moonF !== null) moonPoint = timeArcPoint(moonF, W, horizonY - 5 * u, Math.max(6, apexY - 6 * u), margin);
  else {
    const prior = moonPass(new Date(now.getTime() - 24 * 3600000), state.lat, state.lon);
    if (prior.set && pass.rise && pass.rise > prior.set) {
      const f = Math.max(0, Math.min(1, (now - prior.set) / (pass.rise - prior.set)));
      moonPoint = nightArcPoint(f, W, horizonY + 3 * u, Math.max(6, nightDepth - 4 * u), margin);
    }
  }
  moonPoint ||= { x: W / 2, y: horizonY + nightDepth * .45 };
  $('skyMoon').style.transform = `translate(${moonPoint.x.toFixed(1)}px, ${moonPoint.y.toFixed(1)}px) scale(${sunScale.toFixed(3)})`;
  $('skyMoon').style.opacity = '1';
  $('skyMoon').classList.toggle('is-below', !pass.up);
  const litD = moonLitPath(phase.illumination, phase.waxing, 0, 0, 16, state.lat < 0);
  $('skyMoonClipPath').setAttribute('d', litD);
  panel.style.setProperty('--sky-i', sunIntensity(sun.altitude, 90 - Math.abs(state.lat - sun.declination)).toFixed(3));
  skyColors(sun.altitude, okTimes ? now < times.dhuhr : now.getHours() < 12).forEach((hex, i) => panel.style.setProperty(`--sk-l${i}`, hex));
  panel.dataset.mode = sunUp ? 'day' : 'night';
  const moonNow = moonPosition(now, state.lat, state.lon);
  const bnNow = lang() === 'bn';
  const noonNow = okTimes && times.solarNoon ? fmt(times.solarNoon) : '';
  const zawalNow = okTimes && times.zawalStart ? `${fmt(times.zawalStart)}–${fmt(times.zawalEnd)}` : '';
  $('skyPosition').textContent = bnNow
    ? `সূর্য ${localizeDigits(Math.round(sun.altitude))}° · দিগন্ত ${localizeDigits(Math.round(sun.azimuth))}° · চাঁদ ${localizeDigits(Math.round(moonNow.altitude))}°${noonNow ? ` · মধ্যাহ্ন ${noonNow}` : ''}`
    : `SUN ${Math.round(sun.altitude)}° · AZ ${Math.round(sun.azimuth)}° · MOON ${Math.round(moonNow.altitude)}°${noonNow ? ` · NOON ${noonNow}` : ''}${zawalNow ? ` · ZAWAL ${zawalNow}` : ''}`;
}

function fardDisplayName(event) {
  return slotName(event.key, event.date);
}

/* Tray tooltip: next obligatory prayer and time left. Updated from render()
   and the 15-second tick (which keeps running while hidden to the tray); the
   tray API is only called when the text actually changes (about once a minute). */
let trayIcon = null;
let trayLookup = null;
let lastTrayTooltip = '';
function getTray() {
  if (trayIcon) return Promise.resolve(trayIcon);
  if (!window.__TAURI_INTERNALS__) return Promise.resolve(null);
  if (!trayLookup) {
    trayLookup = TrayIcon.getById('main')
      .then(icon => { trayIcon = icon; return icon; })
      .catch(() => null)
      .finally(() => { trayLookup = null; });
  }
  return trayLookup;
}

function updateTrayTooltip(now = new Date()) {
  const next = hasLocation() ? getNextPrayer(now) : null;
  const text = trayTooltipText(next ? { name: fardDisplayName(next), ms: next.start.getTime() - now.getTime(), lang: lang() } : { lang: lang() });
  if (text === lastTrayTooltip) return;
  lastTrayTooltip = text;
  getTray()
    .then(icon => icon?.setTooltip(text))
    .catch(() => { lastTrayTooltip = ''; });
}

/* Windows toasts (v1.3.3). Root cause of "no notifications on Windows 10": the notification plugin tags toasts with
   the app identifier and ignores the result, and Windows 10 silently drops a toast whose AppUserModelID is not
   registered by a Start Menu shortcut (portable EXE, installer run with /NS, shortcut removed). The native command
   `notify_native` (src-tauri/src/main.rs) toasts with the app's identity when that shortcut exists, otherwise with the
   always-registered PowerShell identity, and returns the real error. The plugin remains the fallback when the command
   does not exist (older shell, browser preview). Resolves to { ok, how, error }. */
function playNotificationSound() {
  if (state.sound) playCues([{ type: 'notify' }], state.tickStyle, window); // v1.3.4: louder, stronger version of the tick
}

async function deliverNotification(title, body) {
  try {
    const how = await invoke('notify_native', { title, body });
    playNotificationSound();
    return { ok: true, how: typeof how === 'string' ? how : '' };
  } catch (error) {
    const message = String((error && error.message) || error || '');
    if (!/not found|unknown command|not allowed/i.test(message)) return { ok: false, error: message };
  }
  try {
    // sendNotification() from the plugin returns nothing (not a Promise); tolerate both forms.
    const result = sendNotification({ title, body });
    if (result && typeof result.then === 'function') await result;
    playNotificationSound();
    return { ok: true, how: 'plugin' };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error || '') };
  }
}

function sendReminder(id, title, body) {
  const forget = () => { delete state.reminderSent[id]; save(); };
  deliverNotification(title, body).then(result => { if (!result.ok) forget(); }, forget);
}

async function sendTestNotification() {
  const status = $('notificationStatus');
  const bn = lang() === 'bn';
  const say = message => { status.textContent = message; };
  say(bn ? 'পাঠানো হচ্ছে…' : 'Sending…');
  try {
    if (!(await isPermissionGranted())) await requestPermission();
  } catch { /* desktop always grants; ignore */ }
  const result = await deliverNotification(bn ? 'প্রার্থনার সময়' : 'Prayer Times', bn ? 'এটি একটি পরীক্ষামূলক বিজ্ঞপ্তি।' : 'This is a test notification. Prayer reminders will look like this.');
  let details = [];
  try { const lines = await invoke('notification_diagnostics'); if (Array.isArray(lines)) details = lines; } catch { /* browser preview */ }
  if (result.ok) say(`${bn ? 'পাঠানো হয়েছে। দেখতে না পেলে উইন্ডোজ সেটিংসে Notifications ও Focus assist (Do not disturb) পরীক্ষা করুন।' : 'Sent. If you do not see it, check Windows Settings > System > Notifications and Focus assist (Do not disturb).'}${details.length ? `\n${details.join('\n')}` : ''}`);
  else say(`${bn ? 'পাঠানো যায়নি: ' : 'Could not send: '}${result.error || ''}${details.length ? `\n${details.join('\n')}` : ''}`);
}

function checkNotifications() {
  if (!state.notifications || !liveTimes || !hasLocation()) return;
  const now = Date.now();
  const today = startOfDay(new Date());
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const events = [];
  for (const date of dates) {
    const times = getTimes(date);
    const nextTimes = getTimes(addDays(date, 1));
    if (!times || !nextTimes) continue;
    events.push(...getFardEvents(date, times, nextTimes));
    events.push(...getVoluntaryEvents(date, times, nextTimes));
  }
  for (const event of events) {
    const leadMinutes = Number(state.reminders[event.key] || 0);
    if (!leadMinutes) continue;
    const record = dayRecord(event.date, false);
    if (record[event.kind]?.[event.key]) continue;
    const id = `${dateKey(event.date)}:${event.key}`;
    const fireAt = event.end.getTime() - leadMinutes * 60000;
    // Never notify before a short event has actually begun.
    if (fireAt < event.start.getTime()) continue;
    // A short grace window prevents missed reminders after a brief sleep/wake or app resume.
    // The grace window covers sleep/wake, app resume and the roughly once-a-minute
    // timer throttling of a window hidden to the tray (see reminder-schedule.js).
    if (isReminderDue(now, fireAt, event.end.getTime()) && !state.reminderSent[id]) {
      state.reminderSent[id] = Date.now();
      const title = lang() === 'bn' ? `${prayerName(event.key)}-এর সময় শেষ হচ্ছে` : `${prayerName(event.key)} period is ending`;
      const body = lang() === 'bn'
        ? `আর ${localizeDigits(leadMinutes)} মিনিট বাকি। ${prayerName(event.key)} সম্পন্ন করুন।`
        : `${leadMinutes} minutes remain before the ${prayerName(event.key)} period ends.`;
      sendReminder(id, title, body);
      save();
    }
  }
  // Reminders before each obligatory prayer begins: one per prayer per day.
  for (const event of events) {
    if (event.kind !== 'fard') continue;
    const minutes = Number(state.preReminders[event.key] || 0);
    if (!minutes) continue;
    const id = `${dateKey(event.date)}:${event.key}:before`;
    const startAt = event.start.getTime();
    const fireAt = preReminderFireAt(event.start, minutes);
    if (!isReminderDue(now, fireAt, startAt) || state.reminderSent[id]) continue;
    state.reminderSent[id] = Date.now();
    const name = fardDisplayName(event);
    const left = Math.max(1, Math.ceil((startAt - now) / 60000));
    const title = lang() === 'bn' ? `${name} ${localizeDigits(left)} মিনিট পরে` : `${name} in ${left} minute${left === 1 ? '' : 's'}`;
    const body = lang() === 'bn' ? `${name}-এর সময় শুরু হবে ${fmt(event.start)}-এ।` : `${name} begins at ${fmt(event.start)}.`;
    sendReminder(id, title, body);
    save();
  }
  const starting = [];
  const ending = [];
  for (const event of events) {
    const day = dateKey(event.date);
    const startId = `edge:${day}:${event.key}:start`;
    const endId = `edge:${day}:${event.key}:end`;
    if (isReminderDue(now, event.start.getTime(), event.start.getTime() + 120000) && !state.reminderSent[startId]) starting.push(event);
    if (isReminderDue(now, event.end.getTime(), event.end.getTime() + 120000) && !state.reminderSent[endId]) ending.push(event);
  }
  if (starting.length || ending.length) {
    for (const event of starting) state.reminderSent[`edge:${dateKey(event.date)}:${event.key}:start`] = Date.now();
    for (const event of ending) state.reminderSent[`edge:${dateKey(event.date)}:${event.key}:end`] = Date.now();
    const bn = lang() === 'bn';
    const names = list => list.map(event => prayerName(event.key)).join(', ');
    const next = getNextPrayer(new Date());
    const nextLine = next ? (bn ? `এরপর ${fardDisplayName(next)} ${fmt(next.start)}-এ।` : `Next is ${fardDisplayName(next)} at ${fmt(next.start)}.`) : '';
    const title = bn ? 'নামাজের সময়' : 'Prayer times';
    const body = [
      starting.length ? (bn ? `শুরু: ${names(starting)}` : `Starting: ${names(starting)}`) : '',
      ending.length ? (bn ? `শেষ: ${names(ending)}` : `Ending: ${names(ending)}`) : '',
      nextLine
    ].filter(Boolean).join(' · ');
    sendReminder(`edge:${Date.now()}`, title, body);
    save();
  }
  // Keep the local sent-marker map bounded while retaining recent duplicate protection.
  const cutoff = Date.now() - 10 * 86400000;
  for (const [key, timestamp] of Object.entries(state.reminderSent)) if (timestamp < cutoff) delete state.reminderSent[key];
}

function requestPrayerNotifications(enabled) {
  if (!enabled) {
    state.notifications = false;
    save();
    showToast('Prayer reminders disabled');
    return;
  }
  (async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (!granted) throw new Error('Permission not granted');
      state.notifications = true;
      save();
      showToast('Prayer reminders enabled');
    } catch {
      state.notifications = false;
      $('notificationsToggle').checked = false;
      showToast('Windows notification permission was not granted');
    }
  })();
}

function updateCountdownWidgets() {
  const now = new Date();
  document.querySelectorAll('[data-event-countdown]').forEach(button => {
    const start = Number(button.dataset.start), end = Number(button.dataset.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const t = now.getTime();
    const until = t < start ? start : end;
    const strong = button.querySelector('[data-live-countdown]');
    if (strong) strong.dataset.until = String(until);
    const span = button.querySelector('span');
    if (span && !button.classList.contains('prayer-eta')) span.textContent = t < start ? 'OPENS IN' : 'TIME LEFT';
    const pref = preferredWindow(button.dataset.key, new Date(start), new Date(end), state.profile.school, { friday: button.dataset.key === 'dhuhr' && new Date(start).getDay() === 5, eid: button.dataset.eid || '' });
    button.classList.toggle('is-best', !!(pref && t >= pref.start.getTime() && t < pref.end.getTime()));
  });
  document.querySelectorAll('[data-live-countdown]').forEach(element => {
    element.textContent = countdown(Number(element.dataset.until) - Date.now());
  });
  updateTopCountdown();
  renderCountdownView();
  if (currentPage === 'time') updateTimeViewCountdown(now);
}

function updateTimeViewCountdown(now = new Date()) {
  if (currentPage !== 'time') return;
  const clock = $('timeNow'); if (clock) clock.textContent = formatClock(now, { lang: lang(), clock: state.clock, seconds: true });
  const main = $('timeMainCount');
  const next = getNextPrayer(now);
  const active = getActiveEvents(now).find(event => event.kind === 'fard') || getActiveEvents(now)[0];
  const focus = active || next;
  if (main) main.textContent = focus ? countdown((active ? focus.end.getTime() : next.start.getTime()) - now.getTime()) : '—';
  const pref = focus ? preferredWindow(focus.key, focus.start, focus.end, state.profile.school, { friday: focus.key === 'dhuhr' && focus.date.getDay() === 5, eid: focus.eid || '' }) : null;
  const phase = preferredState(pref, now);
  const prefCount = $('timePreferredCount');
  const prefCard = $('timePreferredCard');
  if (prefCard) {
    prefCard.hidden = !pref || phase === 'none' || phase === 'expired';
    prefCard.classList.toggle('is-best', phase === 'active');
  }
  if (prefCount && pref) { prefCount.textContent = countdown(((phase === 'upcoming' ? pref.start : pref.end).getTime()) - now.getTime()); prefCount.classList.toggle('is-gold', phase === 'active'); }
  const prefHeading = $('timePreferredHeading');
  if (prefHeading && pref) prefHeading.textContent = phase === 'active' ? (lang() === 'bn' ? 'উত্তম সময় চলছে' : 'Preferred window is open') : (lang() === 'bn' ? 'উত্তম সময় আসছে' : 'Preferred window is ahead');
  if (main) main.classList.toggle('is-gold', phase === 'active');
  const hero = main?.closest('.countdown-focus'); if (hero) hero.classList.toggle('is-best', phase === 'active');
}

function renderAdjustmentControls() {
  const grid = $('adjustmentGrid');
  const fields = [
    ['fajr', 'Fajr'], ['sunrise', 'Sunrise'], ['dhuhr', 'Dhuhr'],
    ['asr', 'Asr'], ['maghrib', 'Maghrib'], ['isha', 'Isha']
  ];
  grid.innerHTML = fields.map(([key, label]) => `<label class="adjustment-item"><span>${label}</span><input id="adjust-${key}" type="number" min="-30" max="30" step="1" value="${Number(state.adjustments[key]) || 0}" aria-label="${label} adjustment in minutes"></label>`).join('');
  for (const [key] of fields) $(`adjust-${key}`).addEventListener('change', event => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < -30 || value > 30) {
      event.target.value = state.adjustments[key];
      showToast('Adjustment must be between −30 and +30 minutes');
      return;
    }
    state.adjustments[key] = value;
    save();
    render();
  });
}

/* Every window start/end around now (yesterday, today, tomorrow), so the view is
   rebuilt the moment a prayer opens or closes (src/prayer-boundary.js). */
let boundaryAt = null;
let boundaryTimer = null;
let lastTickAt = null;
let lastRenderedDay = dateKey(new Date());

function boundaryEvents(now) {
  const today = startOfDay(now);
  const events = [];
  for (const offset of [-1, 0, 1]) {
    const date = addDays(today, offset);
    const times = getTimes(date);
    const nextTimes = getTimes(addDays(date, 1));
    if (!times || !nextTimes) continue;
    events.push(...getFardEvents(date, times, nextTimes), ...getVoluntaryEvents(date, times, nextTimes), ...prohibitedIntervals(times));
    if (times.midnight) events.push({ start: times.midnight, end: times.midnight });
    // heads-up moments for the progress line (the 20-45 minute window before each prayer, every 5 minutes; 10 minutes before Duha/Awwabin)
    for (const f of getFardEvents(date, times, nextTimes)) for (let lead = 20; lead <= 45; lead += 5) { const at = addMinutes(f.start, -lead); events.push({ start: at, end: at }); }
    for (const v of getVoluntaryEvents(date, times, nextTimes)) if (v.key === 'duha' || v.key === 'awwabin') { const at = addMinutes(v.start, -VOLUNTARY_HEADS_UP_MINUTES); events.push({ start: at, end: at }); }
  }
  return events;
}

function armBoundary() {
  clearTimeout(boundaryTimer);
  const now = new Date();
  lastRenderedDay = dateKey(now);
  boundaryAt = hasLocation() ? nextBoundary(boundaryEvents(now), now) : null;
  boundaryTimer = setTimeout(refreshIfStale, boundaryDelay(boundaryAt, now.getTime()));
}

/** Rebuild the view when a boundary, a day change, a sleep/wake or a clock jump made it stale. */
function refreshIfStale() {
  const now = Date.now();
  if (needsRefresh({ now, boundaryAt, lastTickAt, todayKey: dateKey(new Date(now)), lastDateKey: lastRenderedDay })) {
    const todayKey = dateKey(new Date(now));
    if (todayKey !== lastScheduleDate) {
      const wasFollowingToday = dateKey(selectedDate) === lastScheduleDate;
      lastScheduleDate = todayKey;
      if (wasFollowingToday) selectedDate = startOfDay(new Date(now));
    }
    lastTickAt = now;
    render();
    checkNotifications();
  } else {
    lastTickAt = now;
    clearTimeout(boundaryTimer);
    boundaryTimer = setTimeout(refreshIfStale, boundaryDelay(boundaryAt, now));
  }
}

function startVisibleTick() {
  if (tickHandle || document.hidden) return;
  updateClock();
  updateCountdownWidgets();
  lastTickAt = Date.now();
  tickHandle = setInterval(() => {
    refreshIfStale();
    updateClock();
    updateCountdownWidgets();
    if (currentPage === 'home') updateCardCountdowns(); // writes only when the minute text changes
  }, 1000);
}

function stopVisibleTick() {
  if (!tickHandle) return;
  clearInterval(tickHandle);
  tickHandle = null;
  lastTickAt = null;
}

function init() {
  applyTheme();
  document.body.classList.toggle('compact-mode', !!state.compact);
  $('themeSelect').innerHTML = THEMES.map(theme => `<option value="${escapeHtml(theme[0])}">${escapeHtml(theme[0])} (${theme[1]})</option>`).join('');
  renderAdjustmentControls();
  syncSettingsControls();

  $('themeSelect').addEventListener('change', event => {
    state.theme = event.target.value;
    save();
    applyTheme();
    $('themePreview').innerHTML = '';
  });
  $('languageSelect').addEventListener('change', event => { state.language = event.target.value; save(); render(); updateClock(); syncSettingsControls(); });
  $('soundToggle').addEventListener('change', event => { state.sound = event.target.checked; save(); });
  $('uiFontSelect').addEventListener('change', event => { state.uiFont = sanitizeUiFont(event.target.value); save(); applyUiFont(); });
  $('clockFormatSelect').addEventListener('change', event => { state.clock = sanitizeClockFormat(event.target.value); save(); render(); updateClock(); });
  const changeProfile = patch => {
    state.profile = sanitizeProfile({ ...state.profile, ...patch });
    save();
    // Recompute immediately; history is keyed by date and is not touched.
    liveTimes = null;
    render();
    renderProfileSettings();
    showToast('Calculation profile updated');
  };
  $('methodSelect').addEventListener('change', event => changeProfile({ method: event.target.value }));
  $('schoolSelect').addEventListener('change', event => changeProfile({ school: event.target.value, method: presetForSchool(event.target.value, state.profile.method) }));
  $('highLatSelect').addEventListener('change', event => changeProfile({ highLatitude: event.target.value }));
  $('tickStyleSelect').addEventListener('change', event => {
    state.tickStyle = sanitizeTickStyle(event.target.value);
    save();
    // Preview the chosen style once (if sound is on).
    if (state.sound) playCues([{ type: 'tick', layer: 'sunnah', step: 1 }], state.tickStyle, window);
  });
  $('compactToggle').addEventListener('change', event => {
    state.compact = event.target.checked;
    document.body.classList.toggle('compact-mode', state.compact);
    save();
  });
  $('notificationsToggle').addEventListener('change', event => requestPrayerNotifications(event.target.checked));
  [['showDescriptionsToggle', 'descriptions'], ['showSunnahToggle', 'sunnah'], ['showOnThisDayToggle', 'onThisDay']].forEach(([id, key]) => { const control = $(id); if (!control) return; control.addEventListener('change', event => {
    state.sections[key] = event.target.checked;
    save();
    applySectionVisibility();
    syncSettingsControls();
    translateRenderedText();
  }); });
  document.querySelectorAll('[data-card]').forEach(box => box.addEventListener('change', event => {
    state.cards[box.dataset.card] = event.target.checked;
    save();
    applySectionVisibility();
    translateRenderedText();
  }));
  $('testNotification').addEventListener('click', () => { sendTestNotification(); });
  $('startupToggle').addEventListener('change', async event => {
    try {
      if (event.target.checked) await enableAutostart();
      else await disableAutostart();
      state.startup = event.target.checked;
      save();
      showToast(state.startup ? 'Will start with Windows' : 'Windows startup disabled');
    } catch {
      event.target.checked = false;
      showToast('Could not update Windows startup setting');
    }
  });
  $('settingsToggle').addEventListener('click', () => {
    if (currentPage === 'settings') openHome();
    else if (currentPage === 'home') openSettings();
  });
  $('nextName').addEventListener('click', () => { if (nextPrayer && (nextPrayer.kind === 'fard' || nextPrayer.kind === 'voluntary')) navigateToPrayerDescription(nextPrayer.key); });
  $('nextCountdownOpen').addEventListener('click', openNextCountdown);
  $('countdownBack').addEventListener('click', openHome);
  $('parseMapLink').addEventListener('click', useMapLink);
  $('saveLocation').addEventListener('click', saveLocation);
  $('prevDay').addEventListener('click', () => { selectedDate = addDays(selectedDate, -1); render(); });
  $('nextDay').addEventListener('click', () => { selectedDate = addDays(selectedDate, 1); render(); });
  $('exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = 'prayer-times-backup.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('liveClock').addEventListener('click', openTimeView);
  $('liveClock').addEventListener('keydown', event => { if (event.key === 'Enter') openTimeView(); });
  $('liveClock').tabIndex = 0;
  $('timeBack').addEventListener('click', openHome);
  if ($('sunnahSeconds')) {
    $('sunnahSeconds').value = state.recognitionPace.sunnah;
    $('naflSeconds').value = state.recognitionPace.nafl;
    const savePace = () => {
      state.recognitionPace = { sunnah: Math.max(1, Number($('sunnahSeconds').value) || 2), nafl: Math.max(1, Number($('naflSeconds').value) || 1) };
      save();
    };
    $('sunnahSeconds').addEventListener('change', savePace);
    $('naflSeconds').addEventListener('change', savePace);
  }
  let pendingBackup = null;
  let recoveryHoldTimer = null;
  $('importFile').addEventListener('change', async () => {
    const file = $('importFile').files && $('importFile').files[0];
    if (!file) return;
    const parsed = parseBackup(await file.text());
    pendingBackup = parsed.ok ? parsed.backup : null;
    $('backupStatus').textContent = parsed.ok ? (lang() === 'bn' ? 'ব্যাকআপ প্রস্তুত। Replace অথবা Merge বেছে নিন।' : 'Backup ready. Choose Replace or Merge. A safety copy is kept first.') : parsed.error;
  });
  const keepSafety = () => localStorage.setItem('prayer-times-safety', JSON.stringify({ savedAt: new Date().toISOString(), data: state }));
  $('replaceBackup').addEventListener('click', () => {
    if (!pendingBackup) { $('backupStatus').textContent = lang() === 'bn' ? 'আগে একটি ব্যাকআপ ফাইল বেছে নিন।' : 'Choose a backup file first.'; return; }
    keepSafety();
    const { unknown, clean } = splitBackup(pendingBackup.data);
    if (clean.history) state.history = migrateHistory(clean.history);
    for (const key of ['profile', 'language', 'theme', 'clock', 'uiFont', 'notifications', 'reminders', 'preReminders', 'adjustments', 'sections', 'cards', 'recognitionPace', 'lat', 'lon', 'place', 'lockWatermark']) {
      if (key in clean) state[key] = clean[key];
    }
    save();
    $('backupStatus').textContent = unknown.length
      ? `Replaced. Not available in this version: ${unknown.join(', ')}. The previous data is in the safety copy.`
      : 'Replaced. The previous data is in the safety copy.';
    syncSettingsControls();
    openHome();
  });
  $('mergeBackup').addEventListener('click', () => {
    if (!pendingBackup) { $('backupStatus').textContent = lang() === 'bn' ? 'আগে একটি ব্যাকআপ ফাইল বেছে নিন।' : 'Choose a backup file first.'; return; }
    keepSafety();
    const { unknown, clean } = splitBackup(pendingBackup.data);
    const merged = mergeHistory(state.history, clean.history);
    state.history = migrateHistory(merged.history);
    save();
    const conflictText = merged.conflicts.length ? ` Kept the existing record where ${merged.conflicts.length} item${merged.conflicts.length === 1 ? '' : 's'} disagreed.` : '';
    const unknownText = unknown.length ? ` Not available in this version: ${unknown.join(', ')}.` : '';
    $('backupStatus').textContent = `Merged.${conflictText}${unknownText} A safety copy was kept.`;
    render();
  });
  $('recoveryHold').addEventListener('pointerdown', () => {
    clearTimeout(recoveryHoldTimer);
    recoveryHoldTimer = setTimeout(() => {
      const now = new Date();
      const events = fardLookback(now);
      const isRecorded = event => !!dayRecord(event.date, false).fard?.[event.key];
      const isLocked = event => {
        const lockAt = lockInstant({ kind: 'fard', key: event.key }, lockContext(event.date).events, lockContext(event.date).nextFajr)?.at;
        if (recordingOpen(event.start, event.end, lockAt, now)) return false;
        return lockState('fard', event.key, event.date, now).locked || (!!lockAt && now.getTime() >= lockAt);
      };
      const preceding = twoPrecedingFard(events, now);
      if (!recoveryEligible(preceding, isRecorded)) {
        $('recoveryStatus').textContent = lang() === 'bn' ? 'এখন আনা যাবে না। ঠিক আগের দুই ফরজ নামাজ আগে থেকে রেকর্ড থাকতে হবে।' : 'Not available. The two immediately preceding Fard prayers must both already be recorded.';
        $('recoveryPanel').hidden = true;
        return;
      }
      const list = recoverableFards(events, now, { isRecorded, isLocked });
      if (!list.length) {
        $('recoveryStatus').textContent = lang() === 'bn' ? 'লক হওয়া কোনো পুরনো ফরজ খালি নেই।' : 'There is no older locked Fard still unrecorded.';
        $('recoveryPanel').hidden = true;
        return;
      }
      $('recoverySelect').innerHTML = list.map(event => `<option value="${dateKey(event.date)}|${event.key}">${escapeHtml(prayerName(event.key))} · ${escapeHtml(dateKey(event.date))}</option>`).join('');
      $('recoveryConfirm').checked = false;
      $('recoveryPanel').hidden = false;
      $('recoveryStatus').textContent = lang() === 'bn' ? RECOVERY_CONFIRM.bn : RECOVERY_CONFIRM.en;
    }, 3000);
  });
  const cancelRecoveryHold = () => clearTimeout(recoveryHoldTimer);
  $('recoveryHold').addEventListener('pointerup', cancelRecoveryHold);
  $('recoveryHold').addEventListener('pointerleave', cancelRecoveryHold);
  $('recoverySave').addEventListener('click', () => {
    if (!$('recoveryConfirm').checked) {
      $('recoveryStatus').textContent = lang() === 'bn' ? RECOVERY_CONFIRM.bn : RECOVERY_CONFIRM.en;
      return;
    }
    const [day, key] = String($('recoverySelect').value || '').split('|');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!match || !key) return;
    const eventDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const now = new Date();
    const event = findRecordableEvent('fard', key, eventDate);
    const lockAt = event ? lockInstant({ kind: 'fard', key }, lockContext(eventDate).events, lockContext(eventDate).nextFajr)?.at : null;
    if (dayRecord(eventDate, false).fard?.[key]) { $('recoveryStatus').textContent = lang() === 'bn' ? 'এই নামাজ আগেই রেকর্ড করা আছে।' : 'This prayer is already recorded.'; return; }
    if (!event || recordingOpen(event.start, event.end, lockAt, now) || !lockState('fard', key, eventDate, now).locked) {
      $('recoveryStatus').textContent = lang() === 'bn' ? 'রেকর্ডের নিয়ম এড়িয়ে যাওয়া যাবে না। খোলা জানালায় সাধারণ টিক ব্যবহার করুন।' : 'Recovery cannot bypass the recording rules. Use the normal tick while the window is open.';
      return;
    }
    const still = twoPrecedingFard(fardLookback(now), now);
    if (!recoveryEligible(still, item => !!dayRecord(item.date, false).fard?.[item.key])) {
      $('recoveryStatus').textContent = lang() === 'bn' ? 'এখন আনা যাবে না। ঠিক আগের দুই ফরজ নামাজ আগে থেকে রেকর্ড থাকতে হবে।' : 'Not available. The two immediately preceding Fard prayers must both already be recorded.';
      return;
    }
    const record = dayRecord(eventDate);
    record.fard = record.fard || {};
    record.fard[key] = true;
    save();
    $('recoveryPanel').hidden = true;
    $('recoveryConfirm').checked = false;
    $('recoveryStatus').textContent = lang() === 'bn' ? 'রেকর্ড হয়েছে। যোগ্যতা আবার দেখা হয়েছে।' : 'Recorded. Eligibility was checked again.';
    render();
  });
  $('resetData').addEventListener('click', async () => {
    if (!confirm('Delete all locally stored settings, location and prayer history? You will need to enter a Google Maps link or coordinates again.')) return;
    try { await disableAutostart(); } catch { /* reset remains local even if Windows registration cannot be changed */ }
    localStorage.removeItem('prayer-times-data');
    Object.assign(state, DEFAULTS, { history: {}, reminders: {}, preReminders: {}, reminderSent: {}, adjustments: { ...DEFAULTS.adjustments }, profile: { ...DEFAULT_PROFILE } });
    save();
    syncSettingsControls();
    applyTheme();
    openSettings();
    showToast('Local data reset');
  });

  $('timezoneLabel').textContent = `${Intl.DateTimeFormat().resolvedOptions().timeZone || (lang()==='bn'?'ডিভাইসের স্থানীয় সময়':'Device local time')} · ${new Intl.DateTimeFormat('en', { timeZoneName: 'longOffset' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC') || ''}`;
  render();
  if (!hasLocation()) openSettings();
  startVisibleTick();
  // Small, deliberate keyboard set: navigation plus fullscreen and help.
  let desktopWindow = null;
  try { desktopWindow = getCurrentWindow(); } catch { desktopWindow = null; /* plain browser preview */ }
  const keyboardHelp = $('keyboardHelp');
  const toggleKeyboardHelp = () => { if (keyboardHelp.open) keyboardHelp.close(); else keyboardHelp.showModal(); };
  $('closeKeyboardHelp').addEventListener('click', () => keyboardHelp.close());
  keyboardHelp.addEventListener('click', event => { if (event.target === keyboardHelp) keyboardHelp.close(); });
  // Native <dialog> closes itself on Escape; keep our handler from also exiting fullscreen.
  let helpClosedByEscapeAt = 0;
  keyboardHelp.addEventListener('cancel', () => { helpClosedByEscapeAt = Date.now(); });
  const isFullscreen = async () => {
    if (desktopWindow) return desktopWindow.isFullscreen();
    return !!document.fullscreenElement;
  };
  const setFullscreen = async value => {
    if (desktopWindow) {
      // v1.3.4: Rust leaves the maximised state first (fixes the stuck/offset mouse after F11); the plugin call is the fallback
      try { await invoke('set_window_fullscreen', { fullscreen: value }); }
      catch { await desktopWindow.setFullscreen(value); }
      document.documentElement.classList.toggle('is-fullscreen', value);
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); // re-measure and re-hit-test the page
      return;
    }
    if (value) return document.documentElement.requestFullscreen?.();
    return document.fullscreenElement ? document.exitFullscreen?.() : undefined;
  };
  // Sunnah (blue) / Nafl (gold) sub-ticks in the prayer list and live events.
  $('eventInfoClose')?.addEventListener('click', () => { const dialog = $('eventInfo'); if (dialog?.open) dialog.close(); else if (dialog) dialog.hidden = true; });
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-record-kind]') : null;
    if (!button || button.disabled) return;
    togglePrayer(button.dataset.recordKind, button.dataset.recordKey, button.dataset.recordDate);
  });
  document.addEventListener('click', event => {
    const tick = event.target instanceof Element ? event.target.closest('[data-sub-layer]') : null;
    if (!tick || tick.disabled) return;
    toggleSubPrayer(tick.dataset.subLayer, tick.dataset.subKey, tick.dataset.subPrayer, tick.dataset.subDate);
  });
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-carousel-step]') : null;
    if (!button) return;
    stepCarousel(button.closest('[data-carousel]'), Number(button.dataset.carouselStep) || 0);
  });
  document.addEventListener('keydown', async event => {
    const target = event.target;
    // Left/Right page a carousel when focus is on the card or its buttons.
    const carouselHost = target instanceof Element ? target.closest('[data-carousel].has-carousel') : null;
    const arrowDelta = carouselHost ? carouselArrowDelta(event) : 0;
    if (arrowDelta) {
      event.preventDefault();
      stepCarousel(carouselHost, arrowDelta);
      return;
    }
    const action = shortcutFor(event, { helpOpen: keyboardHelp.open });
    if (!action) return;
    if (action === 'fullscreen') {
      event.preventDefault();
      try { await setFullscreen(!(await isFullscreen())); } catch { showToast('Fullscreen mode is unavailable'); }
      return;
    }
    if (action === 'escape') {
      if (keyboardHelp.open) { keyboardHelp.close(); return; }
      if (Date.now() - helpClosedByEscapeAt < 250) return;
      try {
        if (await isFullscreen()) { await setFullscreen(false); return; }
      } catch { /* ignore outside fullscreen */ }
      // Existing Back behaviour: leave the countdown screen; Settings returns home.
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ($('eventInfo')?.open) { $('eventInfo').close(); return; }
      if (currentPage === 'countdown' || currentPage === 'time') openHome();
      else if (currentPage === 'settings' && !typing && hasLocation()) openHome();
      return;
    }
    event.preventDefault();
    if (action === 'help') {
      toggleKeyboardHelp();
    } else if (action === 'home') {
      // Home goes to the home page (from Settings or a countdown) and to its top.
      if (currentPage !== 'home' && hasLocation()) {
        openHome();
        window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
      } else window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'pageUp') {
      window.scrollBy({ top: -pageScrollDistance(window.innerHeight), behavior: 'smooth' });
    } else if (action === 'pageDown') {
      window.scrollBy({ top: pageScrollDistance(window.innerHeight), behavior: 'smooth' });
    } else if (action === 'end') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    }
  });
  document.addEventListener('visibilitychange', () => { document.documentElement.classList.toggle('page-hidden', document.hidden); });
  window.addEventListener('resize', () => requestAnimationFrame(() => updateSky(true)));
  window.addEventListener('focus', () => onWindowReopened('focus'));
  try { // Rust-side signals from src-tauri/src/main.rs (tray click, tray menu, second launch, close-to-tray)
    listen('main-window-hidden', () => { windowWasHidden = true; }).catch(() => {});
    listen('main-window-shown', () => onWindowReopened('rust')).catch(() => {});
  } catch { /* browser preview: no Tauri event bridge */ }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      windowWasHidden = true;
      stopVisibleTick();
    } else {
      onWindowReopened('visibility'); // a new Today's Progress line once per reopen (before render() re-reads the lock)
      render(); // Refresh after a tray restore or Windows wake.
      startVisibleTick();
      checkNotifications();
    }
  });
  checkNotifications();
  renderHandle = setInterval(() => {
    const todayKey = dateKey(new Date());
    if (todayKey !== lastScheduleDate) {
      const wasFollowingToday = dateKey(selectedDate) === lastScheduleDate;
      lastScheduleDate = todayKey;
      if (wasFollowingToday) selectedDate = startOfDay(new Date());
      render();
    } else {
      if (currentPage === 'home') {
        renderLiveEvents();
        renderProgress();
        updateCardCountdowns();
      }
    }
    checkNotifications();
    updateTrayTooltip();
  }, 15000);
  isAutostartEnabled().then(enabled => { state.startup = enabled; $('startupToggle').checked = enabled; }).catch(() => {});
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

init();
