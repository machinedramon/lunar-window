// Page-side handle of the planner worker.
import type { Requirements } from '../core/requirements';
import type { ComputeResult, Request, Response, WindowResult, WorkerSite } from '../worker/protocol';
import type { App } from './app';
import type { LoadedSite } from './data';
import { CUSTOM_SITE, ownOn } from './store';

function toWorker(l: LoadedSite): WorkerSite {
  const s = l.site;
  const points: WorkerSite['points'] = [
    { lat: s.lat, lon: s.lon, elevationM: s.elevationM, elevDeg: l.data ? l.data.elevDeg : null, elevCdeg: null, stepDeg: l.data ? l.data.stepDeg : 360 },
  ];
  if (l.ring) {
    for (const p of l.ring.points) points.push({ lat: p.lat, lon: p.lon, elevationM: p.elevationM, elevDeg: null, elevCdeg: p.elevCdeg, stepDeg: l.ring.stepDeg });
  }
  return { id: s.id, points };
}

export class Planner {
  private readonly worker: Worker;
  private ready: Promise<void>;
  private base: WorkerSite[] = [];
  private wanted = '';
  private ownListeners: (() => void)[] = [];
  /** The visitor's own point, once its terrain is computed: it takes part in every calendar, under the id "custom". */
  own: LoadedSite | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, (r: Response) => void>();

  constructor(app: App) {
    this.worker = new Worker(new URL('../worker/planner.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Response>) => {
      const done = this.waiting.get(ev.data.id);
      this.waiting.delete(ev.data.id);
      done?.(ev.data);
    };
    this.ready = app.all().then((all) => {
      this.base = all.map(toWorker);
      this.post({ type: 'sites', sites: this.base });
    });
    // A failed download is reported where the result is awaited, not as an unhandled error.
    this.ready.catch(() => undefined);
    // The visitor's own point joins the sites when it is in use.
    const sync = () => {
      const st = app.store.state;
      const want = ownOn(st) ? app.ownKey() : '';
      if (want === this.wanted) return;
      this.wanted = want;
      this.setOwn(null); // the point left or moved: the old one goes at once
      if (want) {
        void app.site(CUSTOM_SITE).then((l) => {
          if (this.wanted === want) this.setOwn(l.data ? l : null);
        });
      }
    };
    app.store.subscribe((_state, changed) => {
      if (changed.has('pin') || changed.has('custom') || changed.has('siteId')) sync();
    });
    sync();
  }

  /** True while the terrain of the visitor's own point is being computed. */
  get ownPending(): boolean {
    return !!this.wanted && !this.own;
  }

  /** Calls `fn` when the visitor's own point joins, moves or leaves. Returns the way to stop. */
  onOwn(fn: () => void): () => void {
    this.ownListeners.push(fn);
    return () => {
      this.ownListeners = this.ownListeners.filter((f) => f !== fn);
    };
  }

  private setOwn(l: LoadedSite | null): void {
    if (l === this.own) return;
    this.own = l;
    this.ready = this.ready.then(() => this.post({ type: 'sites', sites: l ? [toWorker(l), ...this.base] : this.base }));
    this.ready.catch(() => undefined);
    for (const fn of this.ownListeners) fn();
  }

  private post(msg: Request): void {
    this.worker.postMessage(msg);
  }

  private ask<T extends Response>(build: (id: number) => Request): Promise<T> {
    return this.ready.then(
      () =>
        new Promise<T>((resolve) => {
          const id = this.nextId++;
          this.waiting.set(id, resolve as (r: Response) => void);
          this.post(build(id));
        }),
    );
  }

  /** Calendar of every site for `days` days from `startMs` (00:00 UTC). */
  compute(startMs: number, days: number, req: Requirements, detailDays: number[] = []): Promise<ComputeResult> {
    return this.ask<ComputeResult>((id) => ({ type: 'compute', id, startMs, days, req, detailDays }));
  }

  /** Series of one site inside a period, and optionally the verdict of one day of it. */
  window(startMs: number, days: number, req: Requirements, siteId: string, fromStep: number, steps: number, day?: number): Promise<WindowResult> {
    return this.ask<WindowResult>((id) => ({ type: 'window', id, startMs, days, req, siteId, fromStep, steps, day }));
  }
}
