// Messages between the page and the worker that computes the terrain of the visitor's own point.

export interface OwnRequest {
  id: number;
  /** Base URL of the site, to find data/polar. */
  base: string;
  lat: number;
  lon: number;
  mastsM: number[];
  /** The points around the site that test robustness to a landing error. */
  ring: { radiusM: number; bearingsDeg: number[] };
}

export interface OwnPoint {
  /** Height of the ground, metres above the 1737.4 km sphere. */
  elevationM: number;
  stepDeg: number;
  /** Terrain horizon in degrees, [mast][azimuth]. */
  elevDeg: number[][];
  /** Distance in km of the terrain that sets it, [mast][azimuth]. */
  distKm: number[][];
  ring: { bearingDeg: number; lat: number; lon: number; elevationM: number; elevCdeg: number[][] }[];
  /** The four terrain grids of the 3D view, as in public/data/terrain/<id>.bin. */
  tiles: Int16Array;
}

export type OwnStage = 'model' | 'horizon';

export type OwnResponse = { id: number; type: 'stage'; stage: OwnStage } | ({ id: number; type: 'done' } & OwnPoint) | { id: number; type: 'error'; message: string };
