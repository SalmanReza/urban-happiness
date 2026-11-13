/* Recording lock (v1.4.1). A completion stays recordable during the event's own
   period and through the following prayer-event period. It locks when the
   second following Fard period begins. Voluntary events use that same boundary
   and keep their own eligibility rules (when they exist, and Sunnah-before /
   Sunnah-after order). This is a recording lock only. It is not a statement
   that the prayer is still religiously valid, and it is never Qada.

   Fard: Fajr locks at Asr, Dhuhr at Maghrib, Asr at Isha, Maghrib at the next
   Fajr, Isha at the next Dhuhr. A voluntary event between two Fard prayers
   does not count as one of those Fard boundaries.
   Sunnah and Nafl parts use the parent Fard's recording lock. They do not
   close at the end of the parent period.

   The immediately previous prayer day is not blanket-locked: Isha and the
   night prayers stay recordable until the next Dhuhr. Older days are sealed.
   The date watermark advances to yesterday only once today's Dhuhr has begun,
   and at most one day per step, so a wrong clock cannot lock the future or
   reopen a lock that was already seen. */

export const NIGHT_KEYS = Object.freeze(['isha', 'qiyam', 'witr', 'tahajjud']);
const ms = value => (value instanceof Date ? value.getTime() : Number(value));

export const lockKey = (kind, key) => `${kind}:${key}`;

function shiftDateKey(key, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Fard starts in chronological order, including the next Fajr when it is known. */
export function fardStarts(events = [], nextFajr = null) {
  const list = [];
  for (const event of events) {
    if (event && event.kind === 'fard' && Number.isFinite(ms(event.start))) list.push({ key: event.key, at: ms(event.start) });
  }
  if (nextFajr != null && Number.isFinite(ms(nextFajr))) list.push({ key: 'fajr', at: ms(nextFajr) });
  list.sort((a, b) => a.at - b.at);
  const out = [];
  for (const item of list) {
    if (out.some(other => other.key === item.key && other.at === item.at)) continue;
    out.push(item);
  }
  return out;
}

/** When this item locks: { at, by }. `by` is the Fard key whose start locks the recording.
 *  item: { kind, key, prayer? }; events: [{ kind, key, start, end? }] of the prayer day and, when known, the next day. */
export function lockInstant(item, events = [], nextFajr = null) {
  const parentKey = item.kind === 'sunnah' || item.kind === 'nafl' ? item.prayer : null;
  const kind = parentKey ? 'fard' : item.kind;
  const key = parentKey || item.key;
  const own = events.find(event => event.kind === kind && event.key === key);
  if (!own || !Number.isFinite(ms(own.start))) return null;
  const second = fardStarts(events, nextFajr).filter(fard => fard.at > ms(own.start))[1];
  return second ? { at: second.at, by: second.key } : null;
}

/** Is a ticked item locked at `now`? `sealed` is true when a lock was already recorded. */
export function isLockedAt(item, events, nextFajr, now, sealed = false) {
  if (sealed) return true;
  const lock = lockInstant(item, events, nextFajr);
  return !!lock && ms(now) >= lock.at;
}

/** Days older than the immediately previous prayer day are locked. Yesterday stays
 *  open for items still inside the two-period window (Isha until the next Dhuhr).
 *  A watermark, once written, keeps those days locked after a clock change. */
export function dayIsLocked(dayKey, currentPrayerDayKey, watermark = null) {
  if (watermark && dayKey <= watermark) return true;
  const previous = shiftDateKey(currentPrayerDayKey, -1);
  if (!previous || !dayKey) return false;
  return dayKey < previous;
}

/** The date watermark moves forward at most one day per step. Until today's Dhuhr
 *  has begun, yesterday's night prayers are still recordable, so the watermark
 *  stops two prayer days back. */
export function nextWatermark(previous, currentPrayerDayKey, addDaysKey, dhuhrStarted = false) {
  const target = addDaysKey(currentPrayerDayKey, dhuhrStarted ? -1 : -2);
  if (!previous) return target;
  if (target <= previous) return previous;
  const step = addDaysKey(previous, 1);
  return step < target ? step : target;
}

/** Record the locks of one day's record: every ticked item whose lock instant has passed gets a flag. Returns true when anything changed. */
export function sealRecord(record, itemsFor, now) {
  if (!record) return false;
  let changed = false;
  const flags = record.locked || {};
  for (const layer of ['fard', 'voluntary', 'sunnah', 'nafl']) {
    for (const key of Object.keys(record[layer] || {})) {
      if (!record[layer][key] || flags[lockKey(layer, key)]) continue;
      const { item, events, nextFajr } = itemsFor(layer, key);
      if (isLockedAt(item, events, nextFajr, now)) { flags[lockKey(layer, key)] = 1; changed = true; }
    }
  }
  if (changed) record.locked = flags;
  return changed;
}

/** Tooltip text: "Locked after Dhuhr began" / "যোহর শুরু হওয়ার পর লক হয়েছে". `name` is null for a past day. */
export function lockTip(name, lang = 'en') {
  if (lang === 'bn') return name ? `${name} শুরু হওয়ার পর লক হয়েছে` : 'পরবর্তী ওয়াক্ত শুরু হওয়ায় লক হয়েছে';
  return name ? `Locked after ${name} began` : 'Locked: a later prayer has begun';
}
