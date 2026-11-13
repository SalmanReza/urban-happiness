/* Religious opportunity and the completion-recording window are different.
   The recording window never means the prayer is still valid to perform,
   and a delayed record inside that window is not Qada. */

const ms = value => (value instanceof Date ? value.getTime() : Number(value));

export function religiouslyOpen(start, end, now) {
  const t = ms(now);
  return Number.isFinite(ms(start)) && Number.isFinite(ms(end)) && t >= ms(start) && t < ms(end);
}

/** A new completion may be entered from the start until the recording lock. If the lock is unknown, only the religious window is open. */
export function recordingOpen(start, end, lockAt, now) {
  const t = ms(now);
  if (!Number.isFinite(ms(start)) || t < ms(start)) return false;
  if (lockAt == null || !Number.isFinite(ms(lockAt))) return religiouslyOpen(start, end, now);
  return t < ms(lockAt);
}

/** Sunnah before closes once the Fard is recorded. Sunnah/Nafl after opens only after the Fard is recorded.
 *  Without lockAt, that eligibility is only inside the religious period.
 *  With lockAt, a delayed record stays available until the two-period lock, and is not Qada. */
export function partRecordable({ position, fardDone, start, end, now, lockAt = null }) {
  const open = lockAt == null ? religiouslyOpen(start, end, now) : recordingOpen(start, end, lockAt, now);
  if (!open) return false;
  if (position === 'before') return !fardDone;
  if (position === 'after') return !!fardDone;
  return false;
}

/** 'completed' when every applicable part is recorded. 'live' when one is still actionable. Otherwise the event has closed unfinished. */
export function eventPlace(parts) {
  const list = Array.isArray(parts) ? parts : [];
  if (list.length && list.every(part => part.done)) return 'completed';
  if (list.some(part => !part.done && part.actionable)) return 'live';
  return 'closed';
}
