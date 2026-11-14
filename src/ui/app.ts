// Shared context of the screens.
import { loadSite, type LoadedSite, type Site, type SiteList } from './data';
import type { State, Store } from './store';

export interface View {
  el: HTMLElement;
  /** Called when the state changed while the view is visible, and when it becomes visible. */
  update(state: State, changed: Set<keyof State> | null): void;
  /** Called when the view is hidden, to stop animations. */
  hide?(): void;
}

export class App {
  readonly sites: Site[];
  private loaded = new Map<string, Promise<LoadedSite>>();
  private ready = new Map<string, LoadedSite>();

  constructor(
    readonly store: Store,
    readonly list: SiteList,
  ) {
    this.sites = list.sites;
  }

  siteInfo(id: string): Site {
    return this.sites.find((s) => s.id === id) ?? this.sites[0];
  }

  /** Horizon profile of a site and of the ring around it, loaded once. */
  site(id: string): Promise<LoadedSite> {
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
    return this.ready.get(id);
  }

  all(): Promise<LoadedSite[]> {
    return Promise.all(this.sites.map((s) => this.site(s.id)));
  }
}
