// Application state, mirrored in the address bar so a scenario can be shared as a link.
import { PROFILES, type Requirements } from '../core/requirements';
import { DAY_MS, isoDate, isoMinute, parseUtc } from './format';

export type Tab = 'explore' | 'plan' | 'compare' | 'missions' | 'accuracy';
export const TABS: Tab[] = ['explore', 'plan', 'compare', 'missions', 'accuracy'];

export interface CompareItem {
  siteId: string;
  /** 00:00 UTC of the landing day. */
  dayMs: number;
}

export interface State {
  tab: Tab;
  siteId: string;
  /** Coordinates of the visitor's own point, used when siteId is "custom". Degrees, east positive. */
  custom: { lat: number; lon: number };
  /** The visitor's own point is kept in the planner (its row, its marker) even when another site is being explored. */
  pin: boolean;
  /** Moment shown in Explore. */
  timeMs: number;
  /** Mission requirements; `req.mast` is also the observer height used in Explore. */
  req: Requirements;
  /** Id of a ready-made profile, or "custom" once a requirement was edited. */
  profileId: string;
  /** 00:00 UTC of the planned landing day. */
  plannedMs: number;
  slipDays: number;
  compare: CompareItem[];
  /** Cell open in the planner detail: site and landing day, or null. */
  detail: CompareItem | null;
  hero: '3d' | 'panorama';
}

/** Site id of a point given by its coordinates rather than chosen from the list. */
export const CUSTOM_SITE = 'custom';
/** Whether the visitor's own point is in use: explored, or kept in the planner. */
export const ownOn = (s: Pick<State, 'siteId' | 'pin'>): boolean => s.pin || s.siteId === CUSTOM_SITE;
export const MIN_MS = Date.UTC(1969, 0, 1);
export const MAX_MS = Date.UTC(2035, 11, 31);
export const MAX_SLIP = 120;

export function defaults(): State {
  const planned = Date.UTC(2027, 0, 17);
  return {
    tab: 'explore',
    siteId: 'haworth',
    custom: { lat: -85, lon: 0 },
    pin: false,
    timeMs: planned,
    req: { ...PROFILES[0].req },
    profileId: PROFILES[0].id,
    plannedMs: planned,
    slipDays: 0,
    compare: [],
    detail: null,
    hero: '3d',
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function encodeReq(r: Requirements): string {
  return [r.durationDays, r.sunAtLanding ? 1 : 0, r.minContinuousSunH, r.maxDarknessH ?? 'x', r.earthAtLanding ? 1 : 0, r.maxBlackoutH ?? 'x', r.mast, r.earthMarginDeg].join('_');
}

function decodeReq(text: string, fallback: Requirements): Requirements {
  const p = text.split('_');
  if (p.length !== 8) return fallback;
  const n = (s: string, lo: number, hi: number, d: number) => (Number.isFinite(+s) ? clamp(+s, lo, hi) : d);
  return {
    durationDays: n(p[0], 1, 120, fallback.durationDays),
    sunAtLanding: p[1] === '1',
    minContinuousSunH: n(p[2], 0, 2880, 0),
    maxDarknessH: p[3] === 'x' ? null : n(p[3], 0, 2880, 0),
    earthAtLanding: p[4] === '1',
    maxBlackoutH: p[5] === 'x' ? null : n(p[5], 0, 2880, 0),
    mast: Math.round(n(p[6], 0, 2, 1)),
    earthMarginDeg: n(p[7], 0, 10, 0),
  };
}

export function toHash(s: State): string {
  const q = new URLSearchParams();
  q.set('site', s.siteId);
  if (ownOn(s)) q.set('ll', `${s.custom.lat},${s.custom.lon}`);
  if (s.pin) q.set('pin', '1');
  q.set('t', isoMinute(s.timeMs));
  q.set('plan', isoDate(s.plannedMs));
  if (s.slipDays) q.set('slip', String(s.slipDays));
  q.set('p', s.profileId);
  if (s.profileId === 'custom' || s.req.mast !== 1 || s.req.earthMarginDeg !== 0) q.set('req', encodeReq(s.req));
  if (s.compare.length) q.set('cmp', s.compare.map((c) => `${c.siteId}@${isoDate(c.dayMs)}`).join(','));
  if (s.detail) q.set('cell', `${s.detail.siteId}@${isoDate(s.detail.dayMs)}`);
  if (s.hero !== '3d') q.set('view', s.hero);
  return `#${s.tab}?${q.toString().replace(/%3A/g, ':').replace(/%40/g, '@').replace(/%2C/g, ',')}`;
}

function parseItem(text: string): CompareItem | null {
  const [siteId, date] = text.split('@');
  const dayMs = parseUtc(date ?? '');
  return siteId && Number.isFinite(dayMs) ? { siteId, dayMs } : null;
}

export function fromHash(hash: string, knownSites: (id: string) => boolean): State {
  const s = defaults();
  const m = /^#?([a-z]+)?\??(.*)$/.exec(hash);
  if (!m) return s;
  if (TABS.includes(m[1] as Tab)) s.tab = m[1] as Tab;
  const q = new URLSearchParams(m[2]);
  const site = q.get('site');
  if (site && knownSites(site)) s.siteId = site;
  const ll = (q.get('ll') ?? '').split(',').map(Number);
  if (ll.length === 2 && ll.every(Number.isFinite)) s.custom = { lat: clamp(ll[0], -90, 90), lon: clamp(ll[1], -180, 180) };
  s.pin = q.get('pin') === '1';
  const t = parseUtc(q.get('t') ?? '');
  if (Number.isFinite(t)) s.timeMs = clamp(t, MIN_MS, MAX_MS);
  const plan = parseUtc(q.get('plan') ?? '');
  if (Number.isFinite(plan)) s.plannedMs = clamp(Math.floor(plan / DAY_MS) * DAY_MS, Date.UTC(2024, 0, 1), Date.UTC(2034, 11, 31));
  s.slipDays = Math.round(clamp(Number(q.get('slip') ?? 0) || 0, 0, MAX_SLIP));
  const profile = PROFILES.find((p) => p.id === q.get('p'));
  if (profile) {
    s.profileId = profile.id;
    s.req = { ...profile.req };
  }
  const req = q.get('req');
  if (req) {
    s.req = decodeReq(req, s.req);
    if (q.get('p') === 'custom') s.profileId = 'custom';
  }
  s.compare = (q.get('cmp') ?? '')
    .split(',')
    .map(parseItem)
    .filter((c): c is CompareItem => !!c && knownSites(c.siteId))
    .slice(0, 4);
  const cell = parseItem(q.get('cell') ?? '');
  s.detail = cell && knownSites(cell.siteId) ? cell : null;
  if (q.get('view') === 'panorama') s.hero = 'panorama';
  return s;
}

type Listener = (state: State, changed: Set<keyof State>) => void;

export class Store {
  state: State;
  private listeners: Listener[] = [];
  private timer = 0;

  constructor(initial: State) {
    this.state = initial;
  }

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  set(patch: Partial<State>): void {
    const changed = new Set<keyof State>();
    for (const key of Object.keys(patch) as (keyof State)[]) {
      if (this.state[key] !== patch[key]) changed.add(key);
    }
    if (!changed.size) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state, changed);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const hash = toHash(this.state);
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }, 250);
  }

  /** The current scenario as a full address. */
  link(): string {
    return location.origin + location.pathname + toHash(this.state);
  }
}
