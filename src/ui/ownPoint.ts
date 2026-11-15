// Page-side handle of the worker that computes the terrain of the visitor's own point.
import { MAST_HEIGHTS_M } from '../core/horizon';
import type { OwnPoint, OwnRequest, OwnResponse, OwnStage } from '../worker/terrainProtocol';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (p: OwnPoint) => void; reject: (err: Error) => void }>();
const listeners = new Set<(stage: OwnStage | null) => void>();
let busy = 0;

/** Tells what the worker is doing: downloading the model, computing, or nothing (null). */
export function onOwnStage(fn: (stage: OwnStage | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const tell = (stage: OwnStage | null) => listeners.forEach((fn) => fn(stage));

export function computeOwnPoint(lat: number, lon: number, ring: { radiusM: number; bearingsDeg: number[] }): Promise<OwnPoint> {
  if (!worker) {
    worker = new Worker(new URL('../worker/terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<OwnResponse>) => {
      const msg = ev.data;
      if (msg.type === 'stage') {
        tell(msg.stage);
        return;
      }
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      busy--;
      if (busy <= 0) tell(null);
      if (!w) return;
      if (msg.type === 'error') w.reject(new Error(msg.message));
      else w.resolve(msg);
    };
  }
  const id = nextId++;
  busy++;
  // An absolute address: inside the worker a relative one would be resolved against the worker's own file.
  const base = new URL(import.meta.env.BASE_URL, document.baseURI).href;
  const request: OwnRequest = { id, base, lat, lon, mastsM: [...MAST_HEIGHTS_M], ring };
  return new Promise<OwnPoint>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage(request);
  });
}
