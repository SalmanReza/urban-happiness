/* Approximate eclipse watch. This is NOT an almanac. It only notices when the
   Moon is near a node at new or full moon, and the Sun or Moon is above the
   local horizon. Confirm with a published source before acting on it. */

import { moonPhase, moonPosition, sunPosition, julianDay } from './sky.js';

const RAD = Math.PI / 180;
const norm = deg => ((deg % 360) + 360) % 360;

export function moonEclipticLatitude(date) {
  const d = julianDay(date) - 2451545.0;
  const F = norm(93.272 + 13.229350 * d);
  return 5.128 * Math.sin(F * RAD);
}

function solarCandidate(date, latitude, longitude) {
  const phase = moonPhase(date);
  const elongation = phase.elongation;
  const nearNew = elongation <= 14 || elongation >= 346;
  if (!nearNew || Math.abs(moonEclipticLatitude(date)) > 1.55) return false;
  return sunPosition(date, latitude, longitude).altitude > 0;
}

function lunarCandidate(date, latitude, longitude) {
  const elongation = moonPhase(date).elongation;
  if (Math.abs(elongation - 180) > 14 || Math.abs(moonEclipticLatitude(date)) > 1.55) return false;
  return moonPosition(date, latitude, longitude).altitude > 0;
}

/** The first approximate local eclipse contact inside the next `hours`, or null. */
export function nextEclipse(from, latitude, longitude, hours = 24) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const start = from.getTime();
  const end = start + hours * 3600000;
  for (let t = start; t <= end; t += 10 * 60000) {
    const date = new Date(t);
    if (solarCandidate(date, latitude, longitude)) {
      return { kind: 'solar', at: date, approximate: true };
    }
    if (lunarCandidate(date, latitude, longitude)) {
      return { kind: 'lunar', at: date, approximate: true };
    }
  }
  return null;
}
