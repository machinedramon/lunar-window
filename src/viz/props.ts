// Things that stand on the ground near the camera: scanned lunar rocks (Poly Haven, CC0), NASA's
// model of its Space Exploration Vehicle concept (at the Apollo sites, of the Lunar Module), and a
// solar array mast of our own. All of it is set dressing for scale and mood; only the height of
// the array and where it points come from the planner, and nothing here feeds back into it.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMast, type Mast } from './mast';
import { restOn } from './rest';

export const PROP_LAYER = 1;
const base = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

interface RockModel {
  geometry: THREE.BufferGeometry;
  /** The same rock with about a fifteenth of the triangles, for instances too far away to show the difference. */
  far: BufferGeometryOrNull;
  material: THREE.MeshStandardMaterial;
  size: number;
}
type BufferGeometryOrNull = THREE.BufferGeometry | null;

/** A rock is drawn in full detail when its size is more than this share of its distance (about 1.7 degrees). */
const FULL_DETAIL = 0.03;

function firstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let mesh: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  return mesh;
}

/** The simplified geometry of a rock; null if it cannot be loaded (the full one is then used everywhere). */
function loadFar(k: number): Promise<BufferGeometryOrNull> {
  return new Promise((resolve) => {
    loader.load(
      `${base}models/rock${k}_far.gltf`,
      (gltf) => resolve(firstMesh(gltf.scene)?.geometry.clone() ?? null),
      undefined,
      () => resolve(null),
    );
  });
}

let rocksReady: Promise<RockModel[]> | null = null;

function loadRocks(): Promise<RockModel[]> {
  if (!rocksReady) {
    rocksReady = Promise.all(
      [1, 2, 3].map(
        (k) =>
          new Promise<RockModel>((resolve, reject) => {
            const farReady = loadFar(k);
            loader.load(
              `${base}models/rock${k}.gltf`,
              (gltf) => {
                const m = firstMesh(gltf.scene);
                if (!m) return reject(new Error('rock without mesh'));
                const geometry = m.geometry.clone();
                geometry.computeBoundingBox();
                const box = geometry.boundingBox!;
                // Centre on the vertical axis, base at y = 0.
                const shift: [number, number, number] = [-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2];
                geometry.translate(...shift);
                const material = (m.material as THREE.MeshStandardMaterial).clone();
                // Lunar rock is dark: the scans are lit for display, bring them down to a lunar albedo.
                material.color.setScalar(0.36);
                material.roughness = 0.96;
                material.metalness = 0;
                const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
                void farReady.then((far) => {
                  far?.translate(...shift);
                  resolve({ geometry, far, material, size });
                });
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

/** Reads ahead the vehicles a change of site can ask for: the Apollo Lunar Module and NASA's rover. */
export function preloadModels(): void {
  const roomy = window.innerWidth >= 1100 && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) >= 4;
  for (const file of ['apollo-lm.glb', roomy ? 'sev-4k.glb' : 'sev.glb']) loadModel(file).catch(() => models.delete(file));
}

function loadModel(file: string): Promise<THREE.Group> {
  let p = models.get(file);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) =>
      loader.load(
        `${base}models/${file}`,
        (gltf) => {
          // Sharp at a grazing angle too: the side of a vehicle is usually seen nearly edge-on.
          gltf.scene.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            for (const map of [m?.map, m?.normalMap, m?.roughnessMap, m?.metalnessMap, (m as THREE.MeshPhysicalMaterial | undefined)?.specularColorMap]) if (map) map.anisotropy = 8;
          });
          resolve(gltf.scene);
        },
        undefined,
        reject,
      ),
    );
    models.set(file, p);
  }
  return p;
}

export interface Props {
  group: THREE.Group;
  mast: Mast | null;
  /** Where the vehicle and the mast stand (metres east and north, radius): the invented small relief is kept away from them. */
  stands: { e: number; n: number; r: number }[];
  /** Height of each contact of the vehicle above the ground it rests on, metres (negative: pressed into the soil). */
  vehicleGaps: number[];
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

/**
 * Hardware that has stood and driven on the Moon is not clean: regolith dust coats what is near the ground and
 * settles on what faces up, and no paint or metal is perfectly even. This adds both to a material (illustrative,
 * like the objects themselves): dust by height above the ground and by how much a surface faces the sky, broken
 * up by a grain, and a faint unevenness in the finish.
 * @param ground height of the ground the object stands on, shared by the materials of that object
 */
function weather(material: THREE.Material, ground: { value: number }): void {
  const m = material as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.userData.weathered) return;
  m.userData.weathered = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLwGround = ground;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLwWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLwWorld;
uniform float uLwGround;
float lwHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float lwGrain(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(lwHash(i), lwHash(i + vec3(1, 0, 0)), f.x), mix(lwHash(i + vec3(0, 1, 0)), lwHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(lwHash(i + vec3(0, 0, 1)), lwHash(i + vec3(1, 0, 1)), f.x), mix(lwHash(i + vec3(0, 1, 1)), lwHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 lwUp = inverseTransformDirection(normal, viewMatrix);
  float lwHeight = vLwWorld.y - uLwGround;
  float lwFine = lwGrain(vLwWorld * 11.0);
  float lwPatch = lwGrain(vLwWorld * 1.6);
  // dust thrown up by the wheels and the feet: thick near the ground, thinning with height, in uneven patches
  float lwLow = 1.0 - smoothstep(0.08, 1.35, lwHeight + (lwPatch - 0.5) * 0.8);
  // dust that settles: on what faces the sky
  float lwTop = smoothstep(0.4, 0.95, lwUp.y) * 0.34;
  float lwDust = clamp(max(lwLow * 0.82, lwTop) * (0.7 + 0.6 * lwFine), 0.0, 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.33, 0.32) * (0.82 + 0.36 * lwFine), lwDust);
  roughnessFactor = mix(clamp(roughnessFactor * (0.8 + 0.4 * lwPatch), 0.04, 1.0), 1.0, lwDust);
  metalnessFactor *= 1.0 - lwDust;
  // no finish is perfectly even: a faint grain in the way the surface catches the light
  vec3 lwBump = vec3(lwGrain(vLwWorld * 46.0), lwGrain(vLwWorld * 46.0 + 7.3), lwGrain(vLwWorld * 46.0 + 13.1)) - 0.5;
  normal = normalize(normal + lwBump * (0.05 + 0.1 * lwDust));
}`,
      );
  };
  m.customProgramCacheKey = () => 'lw-weathered';
  m.needsUpdate = true;
}
/** Height of the ground under the vehicle and under the mast: read by their weathered materials. */
const vehicleGround = { value: 0 };

/** Depth a wheel or a footpad presses into the regolith, metres. */
const SINK = 0.02;
const UP = new THREE.Vector3(0, 1, 0);

interface Contacts {
  /** Points that can touch the ground, in the model's own frame. */
  points: THREE.Vector3[];
  /** Middle of the model, at the level of its lowest point. */
  pivot: THREE.Vector3;
}
const contactsOf = new Map<string, Contacts>();

/**
 * The parts of a model that touch the ground, read from its own geometry: the lowest vertices, gathered into
 * patches (one per wheel or footpad), each at its own lowest level.
 */
function findContacts(file: string, model: THREE.Object3D): Contacts {
  const known = contactsOf.get(file);
  if (known) return known;
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const band = box.min.y + 0.12;
  const CELL = 0.6;
  const patches = new Map<string, { low: number; pts: THREE.Vector3[] }>();
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
      if (v.y > band) continue;
      const key = `${Math.round(v.x / CELL)},${Math.round(v.z / CELL)}`;
      let patch = patches.get(key);
      if (!patch) patches.set(key, (patch = { low: v.y, pts: [] }));
      patch.low = Math.min(patch.low, v.y);
      patch.pts.push(v.clone());
    }
  });
  const points: THREE.Vector3[] = [];
  for (const patch of patches.values()) {
    // the part of the patch that would touch first: within 2 cm of its lowest point
    const touch = patch.pts.filter((q) => q.y <= patch.low + 0.02);
    const c = touch.reduce((sum, q) => sum.add(q), new THREE.Vector3()).multiplyScalar(1 / touch.length);
    points.push(new THREE.Vector3(c.x, patch.low, c.z));
  }
  const found = { points, pivot: new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2) };
  contactsOf.set(file, found);
  return found;
}

/**
 * Puts a model on the ground at a point, at rest: it leans with the terrain so that its wheels or footpads
 * touch, and no part of them is below the surface. Returns how far each contact is from the ground.
 */
function stand(model: THREE.Object3D, file: string, east: number, north: number, ground: (east: number, north: number) => number, yaw: number): number[] {
  const { points, pivot } = findContacts(file, model);
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const rest = restOn(
    points.map((q) => q.clone().sub(pivot).applyQuaternion(turn)),
    east,
    north,
    ground,
    SINK,
  );
  model.quaternion.copy(rest.tilt).multiply(turn);
  model.position.set(east, rest.y, -north).sub(pivot.clone().applyQuaternion(model.quaternion));
  return rest.gaps;
}

/**
 * @param ground      height of the terrain (m) at east, north metres from the site
 * @param vehicleAz   azimuth, degrees, around which the vehicle and the mast are placed
 * @param vehicleKind 'rover' (NASA concept rover and our solar mast), 'apollo' (Lunar Module) or 'none'
 * @param mastM       height of the solar array above the ground
 */
export async function createProps(ground: (east: number, north: number) => number, seed: number, vehicleAz: number, vehicleKind: 'rover' | 'apollo' | 'mast' | 'none', mastM: number): Promise<Props> {
  const apollo = vehicleKind === 'apollo';
  const group = new THREE.Group();
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const at = (az: number, dist: number): [number, number] => [Math.sin((az * Math.PI) / 180) * dist, Math.cos((az * Math.PI) / 180) * dist];
  const keepOut: { e: number; n: number; r: number }[] = [];

  // ----- the vehicle: NASA models, at their real size
  const [ve, vn] = at(vehicleAz, apollo ? 26 : 19);
  let vehicleGaps: number[] = [];
  if (vehicleKind === 'rover' || apollo) try {
    // The rover's textures at their original 4096 pixels on a desktop; at 2048 on a phone, which has no memory to spare.
    const roomy = window.innerWidth >= 1100 && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) >= 4;
    const file = apollo ? 'apollo-lm.glb' : roomy ? 'sev-4k.glb' : 'sev.glb';
    const vehicle = (await loadModel(file)).clone(true);
    vehicleGaps = stand(vehicle, file, ve, vn, ground, ((vehicleAz + (apollo ? 40 : 205)) * Math.PI) / 180);
    vehicleGround.value = ground(ve, vn);
    vehicle.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (mat) for (const one of Array.isArray(mat) ? mat : [mat]) weather(one, vehicleGround);
    });
    group.add(vehicle);
    keepOut.push({ e: ve, n: vn, r: apollo ? 6.5 : 4.5 });
  } catch (err) {
    console.warn('vehicle model unavailable:', err);
  }

  // ----- the solar array mast (not at the Apollo sites: nothing like it was there)
  let mast: Mast | null = null;
  if (vehicleKind === 'rover' || vehicleKind === 'mast') {
    const [me, mn] = at(vehicleAz + 31, 12.5);
    // The mast stays upright; each of its three legs reaches down to the ground under its own footpad.
    const yaw = rnd() * Math.PI * 2;
    const here = ground(me, mn);
    mast = createMast(
      mastM,
      (x, z) => {
        const dx = x * Math.cos(yaw) + z * Math.sin(yaw);
        const dz = -x * Math.sin(yaw) + z * Math.cos(yaw);
        return ground(me + dx, mn - dz) - here - SINK;
      },
      tag,
    );
    mast.group.position.set(me, here, -mn);
    mast.group.rotation.y = yaw;
    const mastGround = { value: here };
    mast.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      // the link line is a drawing aid, not hardware
      if (mat && !o.userData.noShadow) weather(mat, mastGround);
    });
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
      // The camera never leaves its spot, so which rocks are near enough to need every triangle is known once.
      const near: THREE.Matrix4[] = [];
      const distant: THREE.Matrix4[] = [];
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
        (model.far && size / Math.hypot(e, n) < FULL_DETAIL ? distant : near).push(dummy.matrix.clone());
      }
      for (const [geometry, list] of [[model.geometry, near], [model.far, distant]] as const) {
        if (!geometry || !list.length) continue;
        const mesh = new THREE.InstancedMesh(geometry, model.material, list.length);
        list.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        meshes.push(mesh);
        group.add(mesh);
      }
    }
  } catch (err) {
    console.warn('rock models unavailable:', err);
  }
  tag(group);

  return {
    group,
    mast,
    stands: keepOut,
    vehicleGaps,
    dispose() {
      mast?.dispose();
      for (const m of meshes) m.dispose();
    },
  };
}
