// Loads the site list and the horizon profiles built by tools/build_horizon.py.
import { siteFrame, type SiteFrame } from '../core/ephemeris';
import { Horizon, MAST_HEIGHTS_M, type HorizonData, type RingData } from '../core/horizon';

export interface Site {
  id: string;
  name: string;
  category: 'south-pole' | 'apollo' | 'clps' | 'international';
  mission: string;
  status: 'landed' | 'failed' | 'planned' | 'candidate';
  date?: string;
  lat: number;
  lon: number;
  elevationM: number;
  horizon: 'lola-5m-80m-240m' | 'lola-80m-240m' | 'sphere';
  source: string;
  note?: string;
  published?: { lat: number; lon: number };
  nasa?: { sunVisibility: number; sunVisibility3x3: number; earthVisibility: number; earthVisibility3x3: number };
}

export interface SiteList {
  frame: string;
  radiusKm: number;
  generated: string;
  ring: { radiusM: number; bearingsDeg: number[] };
  sites: Site[];
}

export interface LoadedSite {
  site: Site;
  horizon: Horizon;
  /** Present for terrain sites: used to draw how far away the skyline is. */
  data: HorizonData | null;
  ring: RingData | null;
}

const base = import.meta.env.BASE_URL;

async function json<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadSiteList(): Promise<SiteList> {
  return json<SiteList>('data/sites.json');
}

export async function loadSite(site: Site, withRing: boolean): Promise<LoadedSite> {
  if (site.horizon === 'sphere') return { site, horizon: Horizon.sphere(), data: null, ring: null };
  const [data, ring] = await Promise.all([
    json<HorizonData>(`data/horizons/${site.id}.json`),
    withRing ? json<RingData>(`data/horizons/${site.id}.ring.json`) : Promise.resolve(null),
  ]);
  return { site, horizon: Horizon.fromData(data), data, ring };
}

/** Observer frame of a site with its panel and antenna `mast` (index into 0, 2, 10 m) above the ground. */
export function frameOf(site: { lat: number; lon: number; elevationM: number }, mast: number): SiteFrame {
  return siteFrame(site.lat, site.lon, site.elevationM + MAST_HEIGHTS_M[mast]);
}

export const CATEGORY_LABEL: Record<Site['category'], string> = {
  'south-pole': 'Lunar south pole (real terrain)',
  apollo: 'Apollo',
  clps: 'Commercial (CLPS)',
  international: 'Other nations',
};
