/// <reference lib="webworker" />
// The terrain of a point of the visitor's own, off the main thread: downloads the pieces of NASA's LOLA elevation
// models that the point needs, then computes its horizon, the horizons of the eight points around it and the
// terrain grids of the 3D view. Near the south pole the polar model is used (public/data/polar, 80 m per pixel);
// everywhere else the global one (public/data/global, 474 m at the equator). The method is in src/core/polar.ts.
import {
  destination,
  geoTilesFor,
  GeoTerrain,
  horizonAt,
  joinGeoTiles,
  joinTiles,
  PolarTerrain,
  REACH_GLOBAL,
  REACH_POLAR,
  terrainTiles,
  tileOf,
  undoDifferences,
  unpackSecond,
  type GeoPatch,
  type GlobalIndex,
  type Ground,
  type Patch,
  type PolarIndex,
  type Reach,
} from '../core/polar';
import type { OwnRequest, OwnResponse } from './terrainProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let polarIndex: Promise<PolarIndex> | null = null;
let polarFar: Promise<Patch> | null = null;
const polarTiles = new Map<string, Promise<Int16Array>>();
let globalIndex: Promise<GlobalIndex> | null = null;
let globalFar: Promise<GeoPatch> | null = null;
const globalTiles = new Map<string, Promise<Int16Array>>();

const post = (msg: OwnResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The bytes of a grid file, inflated here unless the server already did it. */
async function bytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** Keeps a download for the next point; a failed one is forgotten so that it is tried again. */
function once<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) {
    p = make();
    map.set(key, p);
    p.catch(() => map.delete(key));
  }
  return p;
}

interface Model {
  ground: Ground;
  kind: 'polar' | 'global';
  reach: Reach;
  /** Azimuth step of the horizons of the points around the site. */
  ringStepDeg: number;
}

async function polarModel(root: string, ix: PolarIndex, lat: number, lon: number): Promise<Model> {
  polarFar ??= bytes(`${root}far.bin.gz`).then((buf) => ({ a: undoDifferences(new Int16Array(buf), ix.far.n), n: ix.far.n, stepM: ix.far.stepM, oi: 0, oj: 0, w: ix.far.n, h: ix.far.n }));
  polarFar.catch(() => (polarFar = null));
  const [ti, tj] = tileOf(lat, lon, ix.near.n, ix.near.stepM, ix.near.tile);
  const names: string[] = [];
  for (let j = tj - 1; j <= tj + 1; j++) for (let i = ti - 1; i <= ti + 1; i++) if (ix.near.tiles.includes(`${i}_${j}`)) names.push(`${i}_${j}`);
  const coarse = await polarFar;
  const dense = await Promise.all(names.map((name) => once(polarTiles, name, () => bytes(`${root}near/${name}.bin.gz`).then((buf) => undoDifferences(new Int16Array(buf), ix.near.tile)))));
  const near = joinTiles(new Map(names.map((name, k) => [name, dense[k]])), ti, tj, ix);
  return { ground: new PolarTerrain(ix.unitM, coarse, near), kind: 'polar', reach: REACH_POLAR, ringStepDeg: 0.25 };
}

async function globalModel(root: string, lat: number, lon: number): Promise<Model> {
  globalIndex ??= json<GlobalIndex>(`${root}index.json`);
  globalIndex.catch(() => (globalIndex = null));
  const ix = await globalIndex;
  const farWidth = 360 * ix.far.ppd;
  globalFar ??= bytes(`${root}far.bin.gz`).then((buf) => ({ a: unpackSecond(new Uint8Array(buf), farWidth), ppd: ix.far.ppd, oi: 0, oj: 0, w: farWidth, h: 180 * ix.far.ppd }));
  globalFar.catch(() => (globalFar = null));
  const { cols, rows } = geoTilesFor(lat, lon, ix.near.ppd, ix.near.tile);
  const colsInAll = (360 * ix.near.ppd) / ix.near.tile;
  const wrap = (c: number) => ((c % colsInAll) + colsInAll) % colsInAll;
  const names = new Set<string>();
  for (const r of rows) for (const c of cols) names.add(`${wrap(c)}_${r}`);
  const list = [...names];
  const coarse = await globalFar;
  const dense = await Promise.all(list.map((name) => once(globalTiles, name, () => bytes(`${root}near/${name}.bin.gz`).then((buf) => unpackSecond(new Uint8Array(buf), ix.near.tile)))));
  const have = new Map(list.map((name, k) => [name, dense[k]]));
  const near = joinGeoTiles((c, r) => have.get(`${c}_${r}`)!, cols, rows, ix.near.ppd, ix.near.tile);
  // A hundred tiles are kept at most: a visitor who tries many places does not fill the memory.
  while (globalTiles.size > 100) globalTiles.delete(globalTiles.keys().next().value as string);
  return { ground: new GeoTerrain(ix.unitM, coarse, near), kind: 'global', reach: REACH_GLOBAL, ringStepDeg: 0.5 };
}

async function run(msg: OwnRequest): Promise<void> {
  post({ id: msg.id, type: 'stage', stage: 'model' });
  polarIndex ??= json<PolarIndex>(`${msg.base}data/polar/index.json`);
  polarIndex.catch(() => (polarIndex = null));
  const ix = await polarIndex;
  const model = msg.lat <= ix.minLat ? await polarModel(`${msg.base}data/polar/`, ix, msg.lat, msg.lon) : await globalModel(`${msg.base}data/global/`, msg.lat, msg.lon);
  post({ id: msg.id, type: 'stage', stage: 'horizon' });
  const centre = horizonAt(model.ground, msg.lat, msg.lon, msg.mastsM, 0.25, model.reach);
  const grids = terrainTiles(model.ground, msg.lat, msg.lon);
  const ring = msg.ring.bearingsDeg.map((bearingDeg) => {
    const [lat, lon] = destination(msg.lat, msg.lon, bearingDeg, msg.ring.radiusM);
    const r = horizonAt(model.ground, lat, lon, msg.mastsM, model.ringStepDeg, model.reach);
    return { bearingDeg, lat, lon, elevationM: r.elevationM, elevCdeg: r.elevDeg.map((row) => Array.from(row, (v) => Math.round(v * 100))) };
  });
  post(
    {
      id: msg.id,
      type: 'done',
      model: model.kind,
      elevationM: centre.elevationM,
      stepDeg: centre.stepDeg,
      elevDeg: centre.elevDeg.map((row) => Array.from(row)),
      distKm: centre.distKm.map((row) => Array.from(row)),
      ringStepDeg: model.ringStepDeg,
      ring,
      tiles: grids,
    },
    [grids.buffer],
  );
}

scope.onmessage = (ev: MessageEvent<OwnRequest>) => {
  run(ev.data).catch((err: unknown) => post({ id: ev.data.id, type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
