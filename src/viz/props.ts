// Things that stand on the ground near the camera: scanned lunar rocks (Poly Haven, CC0), NASA's
// model of its Space Exploration Vehicle concept (at the Apollo sites, of the Lunar Module), and a
// solar array mast of our own. All of it is set dressing for scale and mood; only the height of
// the array and where it points come from the planner, and nothing here feeds back into it.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMast, type Mast } from './mast';

export const PROP_LAYER = 1;
const base = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

interface RockModel {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  size: number;
}

let rocksReady: Promise<RockModel[]> | null = null;

function loadRocks(): Promise<RockModel[]> {
  if (!rocksReady) {
    rocksReady = Promise.all(
      [1, 2, 3].map(
        (k) =>
          new Promise<RockModel>((resolve, reject) => {
            loader.load(
              `${base}models/rock${k}.gltf`,
              (gltf) => {
                let mesh: THREE.Mesh | null = null;
                gltf.scene.traverse((o) => {
                  if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
                });
                if (!mesh) return reject(new Error('rock without mesh'));
                const m = mesh as THREE.Mesh;
                const geometry = m.geometry.clone();
                geometry.computeBoundingBox();
                const box = geometry.boundingBox!;
                // Centre on the vertical axis, base at y = 0.
                geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
                const material = (m.material as THREE.MeshStandardMaterial).clone();
                // Lunar rock is dark: the scans are lit for display, bring them down to a lunar albedo.
                material.color.setScalar(0.36);
                material.roughness = 0.96;
                material.metalness = 0;
                resolve({ geometry, material, size: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) });
              },
              undefined,
              reject,
            );
          }),
      ),
    );
  }
  return rocksReady;
}

const models = new Map<string, Promise<THREE.Group>>();
function loadModel(file: string): Promise<THREE.Group> {
  let p = models.get(file);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => loader.load(`${base}models/${file}`, (gltf) => resolve(gltf.scene), undefined, reject));
    models.set(file, p);
  }
  return p;
}

export interface Props {
  group: THREE.Group;
  mast: Mast | null;
  dispose(): void;
}

function tag(o: THREE.Object3D): void {
  o.traverse((c) => {
    c.layers.set(PROP_LAYER);
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = !c.userData.noShadow;
      c.receiveShadow = !c.userData.noShadow;
      c.frustumCulled = false;
    }
  });
}

/** Puts a model on the ground at a point, wheels or feet down, whatever its own origin is. */
function stand(model: THREE.Object3D, east: number, north: number, groundY: number, yaw: number): void {
  model.rotation.y = yaw;
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.set(east - (box.min.x + box.max.x) / 2, groundY - box.min.y, -north - (box.min.z + box.max.z) / 2);
}

/**
 * @param ground      height of the terrain (m) at east, north metres from the site
 * @param vehicleAz   azimuth, degrees, around which the vehicle and the mast are placed
 * @param apollo      true at the Apollo sites: the Lunar Module instead of the rover
 * @param mastM       height of the solar array above the ground
 */
export async function createProps(ground: (east: number, north: number) => number, seed: number, vehicleAz: number, apollo: boolean, mastM: number): Promise<Props> {
  const group = new THREE.Group();
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const at = (az: number, dist: number): [number, number] => [Math.sin((az * Math.PI) / 180) * dist, Math.cos((az * Math.PI) / 180) * dist];
  const keepOut: { e: number; n: number; r: number }[] = [];

  // ----- the vehicle: NASA models, at their real size
  const [ve, vn] = at(vehicleAz, apollo ? 26 : 19);
  try {
    const vehicle = (await loadModel(apollo ? 'apollo-lm.glb' : 'sev.glb')).clone(true);
    stand(vehicle, ve, vn, ground(ve, vn), ((vehicleAz + (apollo ? 40 : 205)) * Math.PI) / 180);
    group.add(vehicle);
    keepOut.push({ e: ve, n: vn, r: apollo ? 6.5 : 4.5 });
  } catch (err) {
    console.warn('vehicle model unavailable:', err);
  }

  // ----- the solar array mast (not at the Apollo sites: nothing like it was there)
  let mast: Mast | null = null;
  if (!apollo) {
    const [me, mn] = at(vehicleAz + 31, 12.5);
    mast = createMast(mastM);
    mast.group.position.set(me, ground(me, mn), -mn);
    mast.group.rotation.y = rnd() * Math.PI * 2;
    group.add(mast.group);
    keepOut.push({ e: me, n: mn, r: 2.4 });
  }

  // ----- rocks
  const meshes: THREE.InstancedMesh[] = [];
  try {
    const rocks = await loadRocks();
    const perModel = 44;
    const dummy = new THREE.Object3D();
    for (const model of rocks) {
      const mesh = new THREE.InstancedMesh(model.geometry, model.material, perModel);
      for (let i = 0; i < perModel; i++) {
        let e = 0;
        let n = 0;
        // Mostly near the camera, where they can be seen; never on top of the camera, the vehicle or the mast.
        for (let tries = 0; tries < 20; tries++) {
          const r = 3.2 + 80 * Math.pow(rnd(), 1.5);
          const th = rnd() * Math.PI * 2;
          e = Math.sin(th) * r;
          n = Math.cos(th) * r;
          if (keepOut.every((k) => Math.hypot(e - k.e, n - k.n) > k.r)) break;
        }
        // Many pebbles, few boulders.
        const size = 0.14 + 1.5 * Math.pow(rnd(), 5.5);
        const k = size / model.size;
        dummy.position.set(e, ground(e, n) - size * 0.12, -n);
        dummy.rotation.set((rnd() - 0.5) * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5);
        dummy.scale.set(k * (0.8 + 0.5 * rnd()), k * (0.7 + 0.5 * rnd()), k * (0.8 + 0.5 * rnd()));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      meshes.push(mesh);
      group.add(mesh);
    }
  } catch (err) {
    console.warn('rock models unavailable:', err);
  }
  tag(group);

  return {
    group,
    mast,
    dispose() {
      mast?.dispose();
      for (const m of meshes) m.dispose();
    },
  };
}
