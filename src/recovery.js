/* Prayer Completion Recovery. Records a prayer the user says they performed
   and forgot to record. It is not Qada, and it cannot record a prayer that
   was not performed. The two immediately preceding Fard events must both
   already be recorded. */

const ms = value => (value instanceof Date ? value.getTime() : Number(value));

/** The two Fard events whose period has already ended, nearest to `now`. */
export function twoPrecedingFard(events, now) {
  const t = ms(now);
  return (events || [])
    .filter(event => event && event.kind === 'fard' && Number.isFinite(ms(event.end)) && ms(event.end) <= t)
    .sort((a, b) => ms(b.end) - ms(a.end))
    .slice(0, 2);
}

export function recoveryEligible(preceding, isRecorded) {
  return Array.isArray(preceding) && preceding.length === 2 && preceding.every(event => isRecorded(event));
}

/** Locked, unrecorded Fard events older than the two preceding ones. */
export function recoverableFards(events, now, { isRecorded, isLocked }) {
  const preceding = twoPrecedingFard(events, now);
  if (!recoveryEligible(preceding, isRecorded)) return [];
  const skip = new Set(preceding.map(event => `${event.dateKey || ''}:${event.key}`));
  return (events || [])
    .filter(event => event && event.kind === 'fard' && !skip.has(`${event.dateKey || ''}:${event.key}`))
    .filter(event => !isRecorded(event) && isLocked(event))
    .sort((a, b) => ms(b.start) - ms(a.start));
}

export const RECOVERY_CONFIRM = Object.freeze({
  en: 'I performed this prayer but forgot to record it.',
  bn: 'আমি এই নামাজ পড়েছি, কিন্তু রেকর্ড করতে ভুলে গেছি।'
});
