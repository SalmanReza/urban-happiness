/* Preferred time inside a prayer's own window.
   The fraction or the minute cap is an approximation. The wording says so.
   Nothing here extends the window or adds a prayer the school does not list. */

const pack = (startMs, endMs, en, bn) => {
  if (!(endMs > startMs)) return null;
  return { start: new Date(startMs), end: new Date(endMs), en, bn };
};

const span = (start, end, from, to, en, bn) => {
  const a = start.getTime();
  const b = end.getTime();
  if (!(b > a)) return null;
  const width = b - a;
  return pack(a + width * from, Math.min(b, a + width * to), en, bn);
};

const firstMinutes = (start, end, minutes, en, bn) => {
  const a = start.getTime();
  const b = end.getTime();
  if (!(b > a)) return null;
  return pack(a, Math.min(b, a + minutes * 60000), en, bn);
};

const FAJR_EARLY = ['The other schools prefer Fajr while it is still dark. This earlier share of the window is an approximation.', 'অন্য মাজহাব ফজর আঁধারে পড়তে পছন্দ করে। জানালার এই আগের অংশটি একটি আনুমানিক ভাগ।'];
const FAJR_LATE = ['Abu Hanifa preferred Fajr once the sky had brightened, still safely before sunrise. This later share is an approximation.', 'আবু হানিফা ফজর আকাশ আলোকিত হলে পড়তে পছন্দ করতেন, সূর্যোদয়ের আগেই। এই পরের অংশটি একটি আনুমানিক ভাগ।'];

export function preferredWindow(key, start, end, school = 'hanafi', options = {}) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  const hanafi = school === 'hanafi';
  if (key === 'fajr') {
    const text = hanafi ? FAJR_LATE : FAJR_EARLY;
    return hanafi ? span(start, end, 0.5, 0.88, text[0], text[1]) : span(start, end, 0, 0.4, text[0], text[1]);
  }
  if (key === 'dhuhr') {
    const extra = options.friday
      ? [' Jumu‘ah itself follows the local mosque, which this app does not guess.', ' জুমার সময় স্থানীয় মসজিদ ঠিক করে, অ্যাপ তা অনুমান করে না।']
      : ['', ''];
    return span(start, end, 0, 0.34,
      'Preferred soon after Zawal. The first third is an approximation. Extreme heat can be a reason to delay; the weather is not guessed here.' + extra[0],
      'জাওয়ালের পর শীঘ্রই উত্তম। প্রথম তৃতীয়াংশ একটি আনুমানিক ভাগ। প্রচণ্ড গরমে দেরি করা যায়; আবহাওয়া এখানে অনুমান করা হয় না।' + extra[1]);
  }
  if (key === 'asr') {
    return span(start, end, 0, 0.5,
      'Preferred before the sun yellows. Halfway toward Maghrib is an approximation of that, not a duration fixed in the text.',
      'সূর্য হলুদ হওয়ার আগে উত্তম। মাগরিবের দিকে অর্ধেক পথ একটি আনুমানিক সীমা, কোনো নির্দিষ্ট সময় নয়।');
  }
  if (key === 'maghrib') {
    return firstMinutes(start, end, 15,
      'Preferred at once, at the start of Maghrib. Fifteen minutes is an approximation, not a stated length.',
      'মাগরিবের শুরুতেই উত্তম। পনেরো মিনিট একটি আনুমানিক সীমা, নির্দিষ্ট কোনো দৈর্ঘ্য নয়।');
  }
  if (key === 'isha') {
    return span(start, end, 0, 1 / 3,
      'Preferred before the night is late. The first third of this window is an approximation.',
      'রাত বেশি হওয়ার আগে উত্তম। এই জানালার প্রথম তৃতীয়াংশ একটি আনুমানিক ভাগ।');
  }
  if (key === 'duha') {
    return span(start, end, 0.5, 1,
      'Preferred once the sun is well up, later in the morning, before Zawal. The later half is an approximation.',
      'সূর্য ভালোভাবে উঠলে, সকালের পরের দিকে, জাওয়ালের আগে উত্তম। পরের অর্ধেক একটি আনুমানিক ভাগ।');
  }
  if (key === 'awwabin') {
    return span(start, end, 0, 0.5,
      'Prayed between Maghrib and Isha. No text fixes the minute. The earlier half is an approximation.',
      'মাগরিব ও ইশার মাঝে পড়া হয়। কোনো বর্ণনা মিনিট ঠিক করে না। আগের অর্ধেক একটি আনুমানিক ভাগ।');
  }
  if (key === 'qiyam' || key === 'witr') {
    return span(start, end, 2 / 3, 1,
      'Preferred in the last third of the night for someone who will wake. Earlier is appropriate if one may sleep through it. The third is an approximation.',
      'যে জাগতে পারবে, তার জন্য রাতের শেষ তৃতীয়াংশ উত্তম। ঘুমিয়ে পড়ার আশঙ্কা থাকলে আগে পড়া যায়। এই তৃতীয়াংশ একটি আনুমানিক ভাগ।');
  }
  if (key === 'tahajjud') {
    return span(start, end, 0, 1,
      'This window is already the last third of the night, which is the preferred time.',
      'এই জানালাটিই রাতের শেষ তৃতীয়াংশ, যা উত্তম সময়।');
  }
  if (key === 'tarawih') {
    return span(start, end, 0, 0.5,
      'After Isha in Ramadan. The first half of the night is an approximation, so it is not pushed to the end of the night.',
      'রমজানে ইশার পর। রাতের প্রথম অর্ধেক একটি আনুমানিক ভাগ, যাতে তা রাতের শেষে ঠেলে দেওয়া না হয়।');
  }
  if (key === 'eid_prayer') {
    return options.eid === 'adha'
      ? span(start, end, 0, 0.35, 'Eid al-Adha is hastened. The first part of the morning window is an approximation of that.', 'ঈদুল আজহা আগে আদায় করা হয়। সকালের জানালার প্রথম অংশটি তার একটি আনুমানিক ভাগ।')
      : span(start, end, 0.2, 0.6, 'Eid al-Fitr is delayed a little so people can eat. The middle of the morning window is an approximation of that.', 'ঈদুল ফিতর একটু দেরিতে, যাতে মানুষ খেতে পারে। সকালের জানালার মাঝামাঝি তার একটি আনুমানিক ভাগ।');
  }
  return null;
}

/** upcoming: before the preferred window. active: inside it. expired: after it. none: no window. */
export function preferredState(pref, now) {
  if (!pref || !(pref.start instanceof Date) || !(pref.end instanceof Date)) return 'none';
  const t = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(t)) return 'none';
  if (t < pref.start.getTime()) return 'upcoming';
  if (t < pref.end.getTime()) return 'active';
  return 'expired';
}
