import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { restOn, triangleHeight } from '../../src/viz/rest';

/** Four wheels of a vehicle 3 m long and 2 m wide, pivot under its middle. */
const wheels = () => [new THREE.Vector3(1, 0, 1.5), new THREE.Vector3(-1, 0, 1.5), new THREE.Vector3(1, 0, -1.5), new THREE.Vector3(-1, 0, -1.5)];

describe('an object at rest on the ground', () => {
  it('stands level on level ground', () => {
    const r = restOn(wheels(), 10, 20, () => 3);
    expect(r.y).toBeCloseTo(3, 9);
    for (const g of r.gaps) expect(g).toBeCloseTo(0, 9);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(r.tilt).y).toBeCloseTo(1, 9);
  });

  it('leans with a slope so that every wheel touches', () => {
    // 12 degrees up towards the east, 5 degrees up towards the north
    const ground = (e: number, n: number) => e * Math.tan((12 * Math.PI) / 180) + n * Math.tan((5 * Math.PI) / 180);
    const r = restOn(wheels(), 0, 0, ground, 0.02);
    for (const g of r.gaps) expect(g).toBeCloseTo(-0.02, 6);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(r.tilt);
    // the object's "up" is the normal of the slope: it leans west and south
    expect(up.x).toBeLessThan(0);
    expect(up.z).toBeGreaterThan(0);
  });

  it('never leaves a contact below the ground, whatever the relief', () => {
    const ground = (e: number, n: number) => 0.3 * Math.sin(e * 0.9) + 0.2 * Math.cos(n * 1.3) + 0.05 * e;
    for (const [e, n] of [
      [0, 0],
      [3.3, -7.1],
      [-12, 4.4],
    ]) {
      const r = restOn(wheels(), e, n, ground, 0.02);
      expect(Math.min(...r.gaps)).toBeCloseTo(-0.02, 9);
      for (const g of r.gaps) expect(g).toBeGreaterThanOrEqual(-0.02 - 1e-9);
    }
  });
});

describe('height of a triangulated grid', () => {
  const at = (i: number, j: number) => [
    [0, 1],
    [2, 7],
  ][j][i];
  it('gives the samples at the corners', () => {
    expect(triangleHeight(at, 0, 0)).toBe(0);
    expect(triangleHeight(at, 0.999999, 0)).toBeCloseTo(1, 4);
    expect(triangleHeight(at, 0, 0.999999)).toBeCloseTo(2, 4);
  });
  it('is flat along the south-west to north-east diagonal, where the two triangles meet', () => {
    expect(triangleHeight(at, 0.5, 0.5)).toBeCloseTo(3.5, 9);
    expect(triangleHeight(at, 0.25, 0.25)).toBeCloseTo(1.75, 9);
  });
  it('follows each triangle, not the smooth blend of the four corners', () => {
    // north-west triangle (0, 2, 7): at a = 0.25, b = 0.75
    expect(triangleHeight(at, 0.25, 0.75)).toBeCloseTo(0 + (7 - 2) * 0.25 + (2 - 0) * 0.75, 9);
    // south-east triangle (0, 1, 7): at a = 0.75, b = 0.25
    expect(triangleHeight(at, 0.75, 0.25)).toBeCloseTo(0 + (1 - 0) * 0.75 + (7 - 1) * 0.25, 9);
  });
});
