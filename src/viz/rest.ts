// How a rigid object comes to rest on uneven ground: the pose in which its contact points (wheels,
// footpads) lie on the terrain and none of them is below it. Objects at rest need no physics engine:
// the answer is the support plane under the contacts, and a lift until nothing penetrates.
import * as THREE from 'three';

export interface RestPose {
  /** Tilt that takes the object's own "up" to the normal of the ground it stands on. */
  tilt: THREE.Quaternion;
  /** Height of the object's pivot, metres, in the frame of the ground function. */
  y: number;
  /** Height of each contact above the ground once at rest, metres: `-sink` for those that touch, more for any left in the air. */
  gaps: number[];
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param contacts points of the object that can touch the ground, relative to its pivot, already turned to its heading
 *                 (x east, y up, z south)
 * @param east     where the pivot stands, metres east of the origin
 * @param north    ... and north of it
 * @param ground   height of the ground at (east, north)
 * @param sink     how far a contact presses into the soil, metres (lunar regolith gives a centimetre or two under a wheel)
 */
export function restOn(contacts: THREE.Vector3[], east: number, north: number, ground: (east: number, north: number) => number, sink = 0): RestPose {
  const tilt = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const heights = (): { x: number; z: number; g: number; y: number }[] =>
    contacts.map((c) => {
      p.copy(c).applyQuaternion(tilt);
      return { x: p.x, z: p.z, y: p.y, g: ground(east + p.x, north - p.z) };
    });
  // The support plane: least squares through the ground under the contacts. Tilting moves the contacts a
  // little sideways, so the fit is repeated until it settles.
  if (contacts.length >= 3) {
    for (let pass = 0; pass < 4; pass++) {
      const h = heights();
      const n = h.length;
      const mx = h.reduce((s, q) => s + q.x, 0) / n;
      const mz = h.reduce((s, q) => s + q.z, 0) / n;
      const mg = h.reduce((s, q) => s + q.g, 0) / n;
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      let sxg = 0;
      let szg = 0;
      for (const q of h) {
        const dx = q.x - mx;
        const dz = q.z - mz;
        sxx += dx * dx;
        szz += dz * dz;
        sxz += dx * dz;
        sxg += dx * (q.g - mg);
        szg += dz * (q.g - mg);
      }
      const det = sxx * szz - sxz * sxz;
      // Contacts in a line give no plane: the object stays level.
      if (Math.abs(det) < 1e-9) break;
      const a = (sxg * szz - szg * sxz) / det;
      const b = (szg * sxx - sxg * sxz) / det;
      tilt.setFromUnitVectors(UP, new THREE.Vector3(-a, 1, -b).normalize());
    }
  }
  // Lift (or lower) until the lowest contact presses `sink` into the ground and nothing is deeper.
  const h = heights();
  const y = h.length ? Math.max(...h.map((q) => q.g - q.y)) - sink : ground(east, north);
  return { tilt, y, gaps: h.map((q) => q.y + y - q.g) };
}

/**
 * Height of a surface drawn as a grid of squares, each split into two triangles along the south-west to north-east
 * diagonal (the split of three.js's PlaneGeometry): the height that is drawn, not a smooth interpolation of the samples.
 * @param at height of the sample at column i (eastward) and row j (northward)
 * @param fx position in columns, @param fy position in rows
 */
export function triangleHeight(at: (i: number, j: number) => number, fx: number, fy: number): number {
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const a = fx - i;
  const b = fy - j;
  const sw = at(i, j);
  const ne = at(i + 1, j + 1);
  if (b >= a) {
    const nw = at(i, j + 1);
    return sw + (ne - nw) * a + (nw - sw) * b;
  }
  const se = at(i + 1, j);
  return sw + (se - sw) * a + (ne - se) * b;
}
