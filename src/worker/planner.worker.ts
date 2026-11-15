/// <reference lib="webworker" />
// Heavy work off the main thread: a year of Sun and Earth positions, the series of
// every site and of the points around it, and the landing-window calendar.
import { buildCalendar, LANDING_STEPS } from '../core/calendar';
import { siteFrame, type SiteFrame } from '../core/ephemeris';
import { findEvents } from '../core/events';
import { Horizon, MAST_HEIGHTS_M } from '../core/horizon';
import { evaluate, prepare, type Prepared, type Requirements } from '../core/requirements';
import { DAY_STEPS, pointSeries, sampleSky, STEP_MS, type PointSeries, type SkySamples } from '../core/series';
import type { ComputeRequest, DayDetail, Request, Response, WindowRequest, WorkerSite } from './protocol';

interface Point {
  lat: number;
  lon: number;
  elevationM: number;
  horizon: Horizon;
}

let sites: { id: string; points: Point[] }[] = [];
/** The series of a period, a mast height and an Earth margin. A few are kept: the planner and each mission have their own. */
interface Kept {
  sky: string;
  mast: string;
  key: string;
  samples: SkySamples;
  series: PointSeries[][];
  prepared: Prepared[][];
  mastInUse: number;
  marginInUse: number;
}
let kept: Kept[] = [];
let samples: SkySamples | null = null;
let series: PointSeries[][] = [];
let prepared: Prepared[][] = [];
let mastInUse = 1;
let marginInUse = 0;

function setSites(list: WorkerSite[]): void {
  sites = list.map((s) => ({
    id: s.id,
    points: s.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevationM: p.elevationM,
      horizon: p.elevDeg ? Horizon.fromDegrees(p.stepDeg, p.elevDeg) : p.elevCdeg ? Horizon.fromCentidegrees(p.stepDeg, p.elevCdeg) : Horizon.sphere(),
    })),
  }));
  kept = [];
  samples = null;
  series = [];
  prepared = [];
}

const frameOf = (p: Point, mast: number): SiteFrame => siteFrame(p.lat, p.lon, p.elevationM + MAST_HEIGHTS_M[mast]);

/** Makes sure the series in memory are those of this period, mast height and Earth margin. The last few are kept. */
function ready(startMs: number, days: number, req: Requirements): void {
  const count = (days + Math.ceil(req.durationDays) + 2) * DAY_STEPS;
  const sky = `${startMs}/${count}`;
  const mast = `${sky}/${req.mast}`;
  const key = `${mast}/${req.earthMarginDeg}`;
  let k = kept.find((x) => x.key === key);
  if (!k) {
    const sameMast = kept.find((x) => x.mast === mast);
    const s = (sameMast ?? kept.find((x) => x.sky === sky))?.samples ?? sampleSky({ startMs, stepMs: STEP_MS, count });
    const ser = sameMast ? sameMast.series : sites.map((site) => site.points.map((p) => pointSeries(s, frameOf(p, req.mast), p.horizon, req.mast)));
    k = { sky, mast, key, samples: s, series: ser, prepared: ser.map((points) => points.map((ps) => prepare(ps, req.earthMarginDeg))), mastInUse: req.mast, marginInUse: req.earthMarginDeg };
    kept.unshift(k);
    if (kept.length > 5) kept.pop();
  } else if (kept[0] !== k) {
    kept.splice(kept.indexOf(k), 1);
    kept.unshift(k);
  }
  samples = k.samples;
  series = k.series;
  prepared = k.prepared;
  mastInUse = k.mastInUse;
  marginInUse = k.marginInUse;
}

function compute(msg: ComputeRequest): Response {
  const t0 = performance.now();
  ready(msg.startMs, msg.days, msg.req);
  const calendars = sites.map((site, i) => {
    const points = prepared[i];
    const details = msg.detailDays.filter((d) => d >= 0 && d < msg.days).map((d) => dayDetail(points, d, msg.req));
    return { siteId: site.id, cal: buildCalendar(points, msg.req, 0, msg.days), details };
  });
  return { type: 'result', id: msg.id, startMs: msg.startMs, days: msg.days, calendars, elapsedMs: performance.now() - t0 };
}

function dayDetail(points: Prepared[], day: number, req: Requirements): DayDetail {
  const times = LANDING_STEPS.map((k) => evaluate(points[0], day * DAY_STEPS + k, req));
  const robustMask = LANDING_STEPS.map((k) => points.reduce((mask, p, i) => mask | (evaluate(p, day * DAY_STEPS + k, req).status !== 'fail' ? 1 << i : 0), 0));
  const robust = robustMask.map((mask) => {
    let n = 0;
    for (let b = mask; b; b >>= 1) n += b & 1;
    return n;
  });
  return { day, times, robust, robustMask };
}

function windowOf(msg: WindowRequest): Response | null {
  const i = sites.findIndex((s) => s.id === msg.siteId);
  if (i < 0) return null;
  ready(msg.startMs, msg.days, msg.req);
  if (!samples || !series[i]) return null;
  const s = series[i][0];
  const from = Math.max(0, Math.min(msg.fromStep, s.sunFrac.length - 1));
  const to = Math.min(s.sunFrac.length, from + msg.steps);
  const p = sites[i].points[0];
  return {
    type: 'window',
    id: msg.id,
    siteId: msg.siteId,
    startMs: samples.grid.startMs + from * STEP_MS,
    stepMs: STEP_MS,
    sunFrac: s.sunFrac.slice(from, to),
    earthClear: s.earthClear.slice(from, to),
    eclipse: s.eclipse.slice(from, to),
    events: findEvents(s, samples.grid, frameOf(p, mastInUse), p.horizon, mastInUse, marginInUse, from, to),
    detail: msg.day !== undefined && msg.day >= 0 && msg.day < msg.days ? dayDetail(prepared[i], msg.day, msg.req) : null,
  };
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const msg = ev.data;
  if (msg.type === 'sites') {
    setSites(msg.sites);
  } else if (msg.type === 'compute') {
    self.postMessage(compute(msg));
  } else {
    const res = windowOf(msg);
    if (res) self.postMessage(res);
  }
};
