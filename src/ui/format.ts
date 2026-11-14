// Text formatting. Everything is UTC and every number carries its unit.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number): string => String(n).padStart(2, '0');

export const HOUR_MS = 3600000;
export const DAY_MS = 86400000;

/** 2027-01-10 */
export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 2027-01-10T12:00 (value of a datetime-local input, read as UTC) */
export function isoMinute(ms: number): string {
  const d = new Date(ms);
  return `${isoDate(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function parseUtc(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}

/** 10 Jan 2027 */
export function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 10 Jan 2027, 12:00 UTC */
export function dayTime(ms: number): string {
  const d = new Date(ms);
  return `${day(ms)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function monthShort(ms: number): string {
  return MONTHS[new Date(ms).getUTCMonth()];
}

/** 4 d 3 h, 5 h 20 min, 12 min */
export function duration(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d >= 1) return h ? `${d} d ${h} h` : `${d} d`;
  if (h >= 1) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** Signed number with a real minus sign. */
export function num(value: number, digits = 1): string {
  const s = Math.abs(value).toFixed(digits);
  return (value < 0 && Number(s) !== 0 ? '−' : '') + s;
}

export function deg(value: number, digits = 2): string {
  return `${num(value, digits)}°`;
}

export function pct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

export function latLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(az: number): string {
  return COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}
