/// <reference lib="webworker" />
// The terrain of a point of the visitor's own, off the main thread: downloads the pieces of NASA's LOLA polar
// elevation model that the point needs (public/data/polar), then computes its horizon, the horizons of the eight
// points around it and the terrain grids of the 3D view. The method is in src/core/polar.ts.
import { destination, horizonAt, joinTiles, PolarTerrain, terrainTiles, tileOf, undoDifferences, type Patch, type PolarIndex } from '../core/polar';
import type { OwnRequest, OwnResponse } from './terrainProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let index: Promise<PolarIndex> | null = null;
let far: Promise<Patch> | null = null;
const tiles = new Map<string, Promise<Int16Array>>();

const post = (msg: OwnResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

/** A grid file: gzip (unless the server already inflated it), 16-bit, differences along each row. */
async function grid(url: string, width: number): Promise<Int16Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return undoDifferences(new Int16Array(buf), width);
}

async function run(msg: OwnRequest): Promise<void> {
  const root = `${msg.base}data/polar/`;
  post({ id: msg.id, type: 'stage', stage: 'model' });
  index ??= fetch(`${root}index.json`).then((res) => {
    if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
    return res.json() as Promise<PolarIndex>;
  });
  const ix = await index;
  far ??= grid(`${root}far.bin.gz`, ix.far.n).then((a) => ({ a, n: ix.far.n, stepM: ix.far.stepM, oi: 0, oj: 0, w: ix.far.n, h: ix.far.n }));
  const [ti, tj] = tileOf(msg.lat, msg.lon, ix.near.n, ix.near.stepM, ix.near.tile);
  const names: string[] = [];
  for (let j = tj - 1; j <= tj + 1; j++) for (let i = ti - 1; i <= ti + 1; i++) if (ix.near.tiles.includes(`${i}_${j}`)) names.push(`${i}_${j}`);
  const coarse = await far;
  const dense = await Promise.all(
    names.map((name) => {
      let p = tiles.get(name);
      if (!p) {
        p = grid(`${root}near/${name}.bin.gz`, ix.near.tile);
        tiles.set(name, p);
      }
      return p;
    }),
  );
  const model = new PolarTerrain(ix.unitM, coarse, joinTiles(new Map(names.map((name, k) => [name, dense[k]])), ti, tj, ix));
  post({ id: msg.id, type: 'stage', stage: 'horizon' });
  const centre = horizonAt(model, msg.lat, msg.lon, msg.mastsM);
  const grids = terrainTiles(model, msg.lat, msg.lon);
  const ring = msg.ring.bearingsDeg.map((bearingDeg) => {
    const [lat, lon] = destination(msg.lat, msg.lon, bearingDeg, msg.ring.radiusM);
    const r = horizonAt(model, lat, lon, msg.mastsM);
    return { bearingDeg, lat, lon, elevationM: r.elevationM, elevCdeg: r.elevDeg.map((row) => Array.from(row, (v) => Math.round(v * 100))) };
  });
  post(
    { id: msg.id, type: 'done', elevationM: centre.elevationM, stepDeg: centre.stepDeg, elevDeg: centre.elevDeg.map((row) => Array.from(row)), distKm: centre.distKm.map((row) => Array.from(row)), ring, tiles: grids },
    [grids.buffer],
  );
}

scope.onmessage = (ev: MessageEvent<OwnRequest>) => {
  run(ev.data).catch((err: unknown) => {
    // A failed download is tried again the next time.
    index = null;
    far = null;
    tiles.clear();
    post({ id: ev.data.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};
