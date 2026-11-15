// Landing-window calendar: for every day, can the mission land at this site?
import { evaluate, STATUS_RANK, REQUIREMENT_ORDER, type Prepared, type Requirements, type Status } from './requirements';
import { DAY_STEPS } from './series';

/** Landing times tried on each day, in steps from 00:00 UTC: 00:00, 06:00, 12:00 and 18:00. */
export const LANDING_STEPS = [0, 12, 24, 36];
export const STATUS_CODES: Status[] = ['fail', 'marginal', 'ok'];

/**
 * One row of the calendar. Typed arrays, one entry per day, so the row can be posted from a worker.
 * A day is as good as its best landing time.
 */
export interface SiteCalendar {
  days: number;
  /** Index into STATUS_CODES. */
  status: Uint8Array;
  /** Index into LANDING_STEPS of the best landing time. */
  bestTime: Uint8Array;
  /** Bit k set when landing time k is viable (ok or marginal). */
  timeMask: Uint8Array;
  /** 0 when nothing fails, else 1 + index into REQUIREMENT_ORDER of the first failed requirement at the best time. */
  failed: Uint8Array;
  /** What the day has, at the best time: bit 0 when the power requirements are met, bit 1 when the communication ones are. */
  has: Uint8Array;
  /** How many of the points (the site and the ring around it) are viable at the best time. */
  robust: Uint8Array;
  /** Number of points tested: 9 with a terrain ring, 1 otherwise. */
  points: number;
}

/**
 * @param points  the site first, then the ring points around it, all prepared with the mast and margin of `req`
 * @param first   step index of 00:00 UTC of the first day
 */
export function buildCalendar(points: Prepared[], req: Requirements, first: number, days: number): SiteCalendar {
  const cal: SiteCalendar = {
    days,
    status: new Uint8Array(days),
    bestTime: new Uint8Array(days),
    timeMask: new Uint8Array(days),
    failed: new Uint8Array(days),
    has: new Uint8Array(days),
    robust: new Uint8Array(days),
    points: points.length,
  };
  const centre = points[0];
  for (let d = 0; d < days; d++) {
    let best = -1;
    let bestRank = -1;
    let bestMet = -1;
    let bestFailed = 0;
    let bestHas = 0;
    let mask = 0;
    for (let k = 0; k < LANDING_STEPS.length; k++) {
      const r = evaluate(centre, first + d * DAY_STEPS + LANDING_STEPS[k], req);
      const rank = STATUS_RANK[r.status];
      if (rank > 0) mask |= 1 << k;
      // The best time is the one with the best verdict; among times that all fail, the one that meets the most.
      const met = (r.power ? 1 : 0) + (r.contact ? 1 : 0);
      if (rank > bestRank || (rank === bestRank && met > bestMet)) {
        bestRank = rank;
        bestMet = met;
        best = k;
        bestFailed = r.failed ? 1 + REQUIREMENT_ORDER.indexOf(r.failed) : 0;
        bestHas = (r.power ? 1 : 0) | (r.contact ? 2 : 0);
      }
    }
    let robust = bestRank > 0 ? 1 : 0;
    const a = first + d * DAY_STEPS + LANDING_STEPS[best];
    for (let p = 1; p < points.length; p++) {
      if (evaluate(points[p], a, req).status !== 'fail') robust++;
    }
    cal.status[d] = bestRank;
    cal.bestTime[d] = best;
    cal.timeMask[d] = mask;
    cal.failed[d] = bestFailed;
    cal.has[d] = bestHas;
    cal.robust[d] = robust;
  }
  return cal;
}

/** Runs of consecutive viable days, longest first: the landing windows. */
export function landingWindows(cal: SiteCalendar): { start: number; length: number }[] {
  const out: { start: number; length: number }[] = [];
  let start = -1;
  for (let d = 0; d <= cal.days; d++) {
    const viable = d < cal.days && cal.status[d] > 0;
    if (viable && start < 0) start = d;
    if (!viable && start >= 0) {
      out.push({ start, length: d - start });
      start = -1;
    }
  }
  return out.sort((a, b) => b.length - a.length || a.start - b.start);
}

/** First viable day at or after `day`, or -1. */
export function nextViableDay(cal: SiteCalendar, day: number): number {
  for (let d = Math.max(0, day); d < cal.days; d++) if (cal.status[d] > 0) return d;
  return -1;
}
