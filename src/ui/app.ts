// Shared context of the screens.
import { S } from '../i18n';
import { Horizon, MAST_HEIGHTS_M, type HorizonData, type RingData } from '../core/horizon';
import { loadSite, type LoadedSite, type Site, type SiteList } from './data';
import { computeOwnPoint, hasOwnTerrain } from './ownPoint';
import { CUSTOM_SITE, type State, type Store } from './store';

export interface View {
  el: HTMLElement;
  /** Called when the state changed while the view is visible, and when it becomes visible. */
  update(state: State, changed: Set<keyof State> | null): void;
  /** Called when the view is hidden, to stop animations. */
  hide?(): void;
  /** Called when the view is thrown away (a change of language rebuilds every view): stops what would keep running. */
  dispose?(): void;
}

export class App {
  readonly sites: Site[];
  private loaded = new Map<string, Promise<LoadedSite>>();
  private ready = new Map<string, LoadedSite>();
  /** The visitor's own points already computed, by coordinates. */
  private own = new Map<string, Promise<LoadedSite>>();
  private ownReady = new Map<string, LoadedSite>();

  constructor(
    readonly store: Store,
    readonly list: SiteList,
  ) {
    this.sites = list.sites;
    // The name of a site, and the note about it, are read in the language in use; English is what the data file holds.
    for (const site of this.sites) {
      const name = site.name;
      const note = site.note;
      Object.defineProperty(site, 'name', { get: () => S.siteNames[site.id] ?? name, enumerable: true });
      Object.defineProperty(site, 'note', { get: () => (note ? (S.siteNotes[site.id] ?? note) : note), enumerable: true });
    }
  }

  siteInfo(id: string): Site {
    if (id === CUSTOM_SITE) return this.customSite();
    return this.sites.find((s) => s.id === id) ?? this.sites[0];
  }

  /** Key of the visitor's own point as it is now. */
  ownKey(): string {
    const { lat, lon } = this.store.state.custom;
    return `${lat},${lon}`;
  }

  /**
   * The visitor's own point. From the pole to 84°S its terrain is computed in the browser from NASA's polar
   * model (until that is done, and everywhere else, the horizon is that of a smooth sphere).
   */
  private customSite(): Site {
    const { lat, lon } = this.store.state.custom;
    const done = this.ownReady.get(this.ownKey());
    return {
      id: CUSTOM_SITE,
      name: S.explore.custom.group,
      category: 'international',
      mission: S.explore.custom.group,
      status: 'candidate',
      lat,
      lon,
      elevationM: done ? done.site.elevationM : 0,
      horizon: done ? done.site.horizon : 'sphere',
      source: 'https://github.com/machinedramon/lunar-window',
    };
  }

  private loadOwn(): Promise<LoadedSite> {
    const { lat, lon } = this.store.state.custom;
    if (!hasOwnTerrain(lat)) return loadSite({ ...this.customSite(), elevationM: 0, horizon: 'sphere' }, false);
    const key = this.ownKey();
    let p = this.own.get(key);
    if (!p) {
      const base = this.customSite();
      p = computeOwnPoint(lat, lon, this.list.ring).then(
        (r): LoadedSite => {
          const site: Site = { ...base, elevationM: r.elevationM, horizon: 'lola-80m-480m' };
          Object.defineProperty(site, 'name', { get: () => S.explore.custom.group, enumerable: true });
          Object.defineProperty(site, 'mission', { get: () => S.explore.custom.group, enumerable: true });
          const data: HorizonData = { siteId: CUSTOM_SITE, lat, lon, elevationM: r.elevationM, stepDeg: r.stepDeg, mastsM: [...MAST_HEIGHTS_M], elevDeg: r.elevDeg, distKm: r.distKm, dem: ['ldem_80s_80m', 'ldem_75s_240m'], generated: '' };
          const ring: RingData = { siteId: CUSTOM_SITE, radiusM: this.list.ring.radiusM, stepDeg: r.stepDeg, mastsM: [...MAST_HEIGHTS_M], points: r.ring };
          const loaded: LoadedSite = { site, horizon: Horizon.fromData(data), data, ring, tiles: r.tiles };
          this.ownReady.set(key, loaded);
          return loaded;
        },
        (err: unknown) => {
          // Without the model (offline, an old browser) the point still works, on a smooth Moon.
          console.warn(err);
          this.own.delete(key);
          return loadSite({ ...base, elevationM: 0, horizon: 'sphere' }, false);
        },
      );
      this.own.set(key, p);
      // A handful of points are kept; older ones are computed again if asked for.
      if (this.own.size > 6) {
        const oldest = this.own.keys().next().value as string;
        this.own.delete(oldest);
        this.ownReady.delete(oldest);
      }
    }
    return p;
  }

  /** Horizon profile of a site and of the ring around it, loaded once. */
  site(id: string): Promise<LoadedSite> {
    if (id === CUSTOM_SITE) return this.loadOwn();
    let p = this.loaded.get(id);
    if (!p) {
      p = loadSite(this.siteInfo(id), true).then((l) => {
        this.ready.set(id, l);
        return l;
      });
      this.loaded.set(id, p);
    }
    return p;
  }

  peek(id: string): LoadedSite | undefined {
    if (id === CUSTOM_SITE) return this.ownReady.get(this.ownKey());
    return this.ready.get(id);
  }

  all(): Promise<LoadedSite[]> {
    return Promise.all(this.sites.map((s) => this.site(s.id)));
  }
}
