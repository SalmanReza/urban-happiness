/* v1.4.1: the home page no longer has Islamic History, Qur'an, Sunnah, Seerah
   or a separate Prayer descriptions section. Saved section switches from older
   versions are ignored and are not revived. Prayer guidance opens from the
   prayer-event title instead. */
export const SECTION_KEYS = [];

export function sanitizeSections(saved) {
  const input = saved && typeof saved === 'object' ? saved : {};
  return Object.fromEntries(SECTION_KEYS.map(key => [key, typeof input[key] === 'boolean' ? input[key] : true]));
}

export const CARD_KEYS = {};
export const ALL_CARD_KEYS = Object.values(CARD_KEYS).flat();

export function sanitizeCards(saved) {
  const input = saved && typeof saved === 'object' ? saved : {};
  return Object.fromEntries(ALL_CARD_KEYS.map(key => [key, typeof input[key] === 'boolean' ? input[key] : true]));
}

/** Removed home sections stay hidden. A tab with no cards is not drawn. */
export function tabVisible(tab, sections, cards) {
  if (!sections || sections[tab] === false) return false;
  const keys = CARD_KEYS[tab];
  if (!keys || !keys.length) return false;
  return keys.some(key => cards[key] !== false);
}
