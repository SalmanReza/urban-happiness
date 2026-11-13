/* Centre-of-circle phrases. Application feedback, not a religious ranking. */

export const PHRASES = Object.freeze({
  first: {
    ar: 'شُكْرًا لِلَّهِ', tr: 'Shukran Lillah', en: 'Thanks be to Allah',
    trBn: 'শুকরান লিল্লাহ', bn: 'আল্লাহর শুকরিয়া'
  },
  fard: {
    ar: 'مَا شَاءَ اللَّهُ', tr: 'Mashallah', en: 'What Allah has willed',
    trBn: 'মাশাআল্লাহ', bn: 'আল্লাহ যা চেয়েছেন'
  },
  sunnah: {
    ar: 'الْحَمْدُ لِلَّهِ', tr: 'Alhamdulillah', en: 'All praise is due to Allah',
    trBn: 'আলহামদুলিল্লাহ', bn: 'সমস্ত প্রশংসা আল্লাহর'
  },
  ghair: {
    ar: 'تَبَارَكَ اللَّهُ', tr: 'Tabarakallah', en: 'Blessed is Allah',
    trBn: 'তাবারাকাল্লাহ', bn: 'আল্লাহ কত বরকতময়'
  },
  voluntary: {
    ar: 'سُبْحَانَ اللَّهِ', tr: 'Subhanallah', en: 'Glory be to Allah',
    trBn: 'সুবহানাল্লাহ', bn: 'আল্লাহ পবিত্র'
  },
  all: {
    ar: 'اللَّهُ أَكْبَرُ', tr: 'Allahu Akbar', en: 'Allah is the Greatest',
    trBn: 'আল্লাহু আকবার', bn: 'আল্লাহ সবচেয়ে মহান'
  },
  flexible: {
    ar: 'جَزَاكَ اللَّهُ خَيْرًا', tr: 'Jazakallahu Khayran', en: 'May Allah reward you with goodness',
    trBn: 'জাযাকাল্লাহু খাইরান', bn: 'আল্লাহ আপনাকে উত্তম প্রতিদান দিন'
  }
});

/** Fixed seconds for a Fard count of 1..5. */
export const FARD_SECONDS = Object.freeze({ 1: 15, 2: 10, 3: 15, 4: 20, 5: 30 });

export function phraseLines(key, lang = 'en') {
  const phrase = PHRASES[key];
  if (!phrase) return null;
  const bn = lang === 'bn';
  return { ar: phrase.ar, tr: bn ? phrase.trBn : phrase.tr, meaning: bn ? phrase.bn : phrase.en };
}

/**
 * Highest milestone currently true.
 * flags: { fardDone, sunnahComplete, ghairComplete, voluntaryDone, allStructured, flexible }
 * ghairComplete means the non-emphasised Sunnah slots (stored with Nafl in this app) are all recorded.
 */
export function recognitionKey(flags) {
  if (!flags) return null;
  if (flags.allStructured) return 'all';
  if (flags.flexible) return 'flexible';
  if (flags.voluntaryDone) return 'voluntary';
  if (flags.ghairComplete && flags.sunnahComplete) return 'ghair';
  if (flags.sunnahComplete) return 'sunnah';
  if (flags.fardDone >= 5) return 'fard';
  if (flags.fardDone >= 1 && flags.firstJustNow) return 'first';
  return null;
}

export function recognitionSeconds(key, { fardDone = 0, sunnahCount = 0, naflCount = 0, pace = {} } = {}) {
  if (key === 'first') return FARD_SECONDS[1];
  if (key === 'fard') return FARD_SECONDS[Math.min(5, Math.max(1, fardDone))] || 30;
  const perSunnah = Number(pace.sunnah) > 0 ? Number(pace.sunnah) : 2;
  const perNafl = Number(pace.nafl) > 0 ? Number(pace.nafl) : 1;
  return Math.max(2, Math.round(sunnahCount * perSunnah + naflCount * perNafl));
}
