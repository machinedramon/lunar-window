// Messages between the page and the planner worker.
import type { SiteCalendar } from '../core/calendar';
import type { SkyEvent } from '../core/events';
import type { CellResult, Requirements } from '../core/requirements';

export interface WorkerPoint {
  lat: number;
  lon: number;
  elevationM: number;
  /** Horizon in hundredths of a degree, [mast][azimuth]; null = smooth sphere. */
  elevCdeg: number[][] | null;
  stepDeg: number;
}

export interface WorkerSite {
  id: string;
  /** The site itself first, then the ring points around it. */
  points: WorkerPoint[];
}

export interface ComputeRequest {
  type: 'compute';
  id: number;
  startMs: number;
  days: number;
  req: Requirements;
  /** Days (from startMs) for which the full verdict of each landing time is wanted, for every site. */
  detailDays: number[];
}

export interface WindowRequest {
  type: 'window';
  id: number;
  siteId: string;
  /** Step index, in the grid of the last compute, where the window starts. */
  fromStep: number;
  steps: number;
}

export type Request = { type: 'sites'; sites: WorkerSite[] } | ComputeRequest | WindowRequest;

/** Verdict of one site on one day: each of the four landing times, and how many nearby points agree. */
export interface DayDetail {
  day: number;
  times: CellResult[];
  /** Viable points (site plus ring) at each landing time. */
  robust: number[];
}

export interface ComputeResult {
  type: 'result';
  id: number;
  startMs: number;
  days: number;
  calendars: { siteId: string; cal: SiteCalendar; details: DayDetail[] }[];
  elapsedMs: number;
}

export interface WindowResult {
  type: 'window';
  id: number;
  siteId: string;
  startMs: number;
  stepMs: number;
  sunFrac: Float32Array;
  earthClear: Float32Array;
  eclipse: Float32Array;
  events: SkyEvent[];
}

export type Response = ComputeResult | WindowResult;
