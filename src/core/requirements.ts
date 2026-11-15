// Mission requirements and the verdict for one landing time at one point.
import { STEP_H, type PointSeries } from './series';

export interface Requirements {
  durationDays: number;
  /** The Sun must be up (at least half of the disc) at landing. */
  sunAtLanding: boolean;
  /** Hours of uninterrupted Sun needed from landing; 0 = not required. */
  minContinuousSunH: number;
  /** Longest darkness the mission survives, hours; null = not required. */
  maxDarknessH: number | null;
  /** The Earth must be in view at landing. */
  earthAtLanding: boolean;
  /** Longest loss of direct communication tolerated, hours; null = not required. */
  maxBlackoutH: number | null;
  /** Height of the solar panel and antenna above the ground: index into [0, 2, 10] m. */
  mast: number;
  /** The Earth counts as in view only this many degrees above the terrain. */
  earthMarginDeg: number;
}

export type RequirementKey = 'sunAtLanding' | 'earthAtLanding' | 'continuousSun' | 'maxDarkness' | 'maxBlackout';
/** Order in which a failure is reported. */
export const REQUIREMENT_ORDER: RequirementKey[] = ['sunAtLanding', 'earthAtLanding', 'continuousSun', 'maxDarkness', 'maxBlackout'];

export type Status = 'ok' | 'marginal' | 'fail';
export const STATUS_RANK: Record<Status, number> = { fail: 0, marginal: 1, ok: 2 };

/** The Sun counts as present when at least this fraction of its disc is above the terrain. */
export const SUN_PRESENT = 0.5;
/** Below this fraction at landing the verdict is "marginal" even if every requirement is met. */
export const SUN_COMFORT = 0.75;
/** A requirement met with less than this share of its value to spare is "marginal". */
export const SLACK_SHARE = 0.1;

export interface Profile {
  id: string;
  label: string;
  blurb: string;
  req: Requirements;
}

/** Example profiles inspired by public statements. They are not the official requirements of any mission. */
export const PROFILES: Profile[] = [
  {
    id: 'short',
    label: 'Short surface mission',
    blurb: '6 days. Sunlight and Earth contact the whole time.',
    req: { durationDays: 6, sunAtLanding: true, minContinuousSunH: 0, maxDarknessH: 0, earthAtLanding: true, maxBlackoutH: 0, mast: 1, earthMarginDeg: 0 },
  },
  {
    id: 'lunar-day',
    label: 'Full lunar day lander',
    blurb: '14 days. Survives 6 h of darkness and 24 h without Earth contact.',
    req: { durationDays: 14, sunAtLanding: true, minContinuousSunH: 0, maxDarknessH: 6, earthAtLanding: true, maxBlackoutH: 24, mast: 1, earthMarginDeg: 0 },
  },
  {
    id: 'rover',
    label: 'Polar rover',
    blurb: '100 days. Survives 50 h of darkness and 14 days without Earth contact.',
    req: { durationDays: 100, sunAtLanding: true, minContinuousSunH: 0, maxDarknessH: 50, earthAtLanding: true, maxBlackoutH: 336, mast: 1, earthMarginDeg: 0 },
  },
];

/** A point series indexed for constant-time window questions. */
export interface Prepared {
  count: number;
  sunFrac: Float32Array;
  earthClear: Float32Array;
  earthMarginDeg: number;
  /** Runs without Sun as [start, end) pairs of step indices. */
  dark: Int32Array;
  /** Runs without Earth in view. */
  blackout: Int32Array;
  cumSun: Int32Array;
  cumEarth: Int32Array;
  cumBoth: Int32Array;
  cumPower: Float64Array;
}

function runsOf(count: number, bad: (i: number) => boolean): Int32Array {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i < count; i++) {
    if (bad(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push(start, i);
      start = -1;
    }
  }
  if (start >= 0) out.push(start, count);
  return Int32Array.from(out);
}

export function prepare(series: PointSeries, earthMarginDeg: number): Prepared {
  const n = series.sunFrac.length;
  const sunOk = (i: number) => series.sunFrac[i] >= SUN_PRESENT;
  const earthOk = (i: number) => series.earthClear[i] > earthMarginDeg;
  const cumSun = new Int32Array(n + 1);
  const cumEarth = new Int32Array(n + 1);
  const cumBoth = new Int32Array(n + 1);
  const cumPower = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const s = sunOk(i);
    const e = earthOk(i);
    cumSun[i + 1] = cumSun[i] + (s ? 1 : 0);
    cumEarth[i + 1] = cumEarth[i] + (e ? 1 : 0);
    cumBoth[i + 1] = cumBoth[i] + (s && e ? 1 : 0);
    cumPower[i + 1] = cumPower[i] + series.sunFrac[i];
  }
  return {
    count: n,
    sunFrac: series.sunFrac,
    earthClear: series.earthClear,
    earthMarginDeg,
    dark: runsOf(n, (i) => !sunOk(i)),
    blackout: runsOf(n, (i) => !earthOk(i)),
    cumSun,
    cumEarth,
    cumBoth,
    cumPower,
  };
}

/** Index of the first run that ends after step a. */
function firstRun(runs: Int32Array, a: number): number {
  let lo = 0;
  let hi = runs.length / 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid * 2 + 1] > a) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Longest run inside the window [a, b), in steps. */
function longestRun(runs: Int32Array, a: number, b: number): number {
  let best = 0;
  for (let r = firstRun(runs, a); r * 2 < runs.length && runs[r * 2] < b; r++) {
    const len = Math.min(runs[r * 2 + 1], b) - Math.max(runs[r * 2], a);
    if (len > best) best = len;
  }
  return best;
}

/** Steps from a until the next run starts (0 if a is inside one), capped at b. */
function stepsUntilRun(runs: Int32Array, a: number, b: number): number {
  const r = firstRun(runs, a);
  if (r * 2 >= runs.length) return b - a;
  return Math.max(0, Math.min(runs[r * 2], b) - a);
}

/** Numbers for a window [a, b) of one point. Times in hours, shares from 0 to 1. */
export interface WindowMetrics {
  sunShare: number;
  earthShare: number;
  bothShare: number;
  /** Mean visible fraction of the solar disc: a proxy for power from a Sun-tracking panel. Not watts. */
  powerIndex: number;
  longestDarkH: number;
  longestBlackoutH: number;
  continuousSunH: number;
  continuousEarthH: number;
}

export function windowMetrics(p: Prepared, a: number, b: number): WindowMetrics {
  const end = Math.min(b, p.count);
  const len = Math.max(1, end - a);
  return {
    sunShare: (p.cumSun[end] - p.cumSun[a]) / len,
    earthShare: (p.cumEarth[end] - p.cumEarth[a]) / len,
    bothShare: (p.cumBoth[end] - p.cumBoth[a]) / len,
    powerIndex: (p.cumPower[end] - p.cumPower[a]) / len,
    longestDarkH: longestRun(p.dark, a, end) * STEP_H,
    longestBlackoutH: longestRun(p.blackout, a, end) * STEP_H,
    continuousSunH: stepsUntilRun(p.dark, a, end) * STEP_H,
    continuousEarthH: stepsUntilRun(p.blackout, a, end) * STEP_H,
  };
}

export interface CellResult extends WindowMetrics {
  status: Status;
  /** First requirement that fails, in REQUIREMENT_ORDER; null when none fails. */
  failed: RequirementKey | null;
  /** Requirement met with little to spare, when the verdict is "marginal". */
  tight: RequirementKey | null;
  sunAtLanding: number;
  earthClearAtLanding: number;
  /** Whether every power requirement in force is met (Sun at landing, uninterrupted Sun, darkness survived). */
  power: boolean;
  /** Whether every communication requirement in force is met (Earth at landing, loss of contact survived). */
  contact: boolean;
}

export function durationSteps(req: Requirements): number {
  return Math.round((req.durationDays * 24) / STEP_H);
}

/** Verdict for landing at step `a`. The requirement fields `mast` and `earthMarginDeg` must match how `p` was built. */
export function evaluate(p: Prepared, a: number, req: Requirements): CellResult {
  const m = windowMetrics(p, a, a + durationSteps(req));
  const sunAtLanding = p.sunFrac[a];
  const earthClearAtLanding = p.earthClear[a];

  const checks: { key: RequirementKey; active: boolean; pass: boolean; tight: boolean }[] = [
    { key: 'sunAtLanding', active: req.sunAtLanding, pass: sunAtLanding >= SUN_PRESENT, tight: sunAtLanding < SUN_COMFORT },
    { key: 'earthAtLanding', active: req.earthAtLanding, pass: earthClearAtLanding > req.earthMarginDeg, tight: false },
    {
      key: 'continuousSun',
      active: req.minContinuousSunH > 0,
      pass: m.continuousSunH >= req.minContinuousSunH,
      tight: m.continuousSunH - req.minContinuousSunH < SLACK_SHARE * req.minContinuousSunH,
    },
    {
      key: 'maxDarkness',
      active: req.maxDarknessH !== null,
      pass: m.longestDarkH <= (req.maxDarknessH ?? 0),
      tight: (req.maxDarknessH ?? 0) > 0 && (req.maxDarknessH ?? 0) - m.longestDarkH < SLACK_SHARE * (req.maxDarknessH ?? 0),
    },
    {
      key: 'maxBlackout',
      active: req.maxBlackoutH !== null,
      pass: m.longestBlackoutH <= (req.maxBlackoutH ?? 0),
      tight: (req.maxBlackoutH ?? 0) > 0 && (req.maxBlackoutH ?? 0) - m.longestBlackoutH < SLACK_SHARE * (req.maxBlackoutH ?? 0),
    },
  ];

  const failed = checks.find((c) => c.active && !c.pass);
  const tight = failed ? undefined : checks.find((c) => c.active && c.tight);
  const about = (keys: RequirementKey[]) => !checks.some((c) => c.active && !c.pass && keys.includes(c.key));
  return {
    ...m,
    power: about(['sunAtLanding', 'continuousSun', 'maxDarkness']),
    contact: about(['earthAtLanding', 'maxBlackout']),
    status: failed ? 'fail' : tight ? 'marginal' : 'ok',
    failed: failed ? failed.key : null,
    tight: tight ? tight.key : null,
    sunAtLanding,
    earthClearAtLanding,
  };
}
