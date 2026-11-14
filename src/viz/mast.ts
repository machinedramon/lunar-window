// A vertical solar array on a mast, with a dish: the piece of hardware that the "panel and
// antenna height" requirement is about. The panel stands at the chosen height and turns to the
// Sun; the dish points at the Earth and shows a symbolic radio link when the Earth is in view.
// Original design, loosely after NASA's vertical solar array concept for the lunar south pole;
// it is illustrative and not a model of any real hardware.
import * as THREE from 'three';

export interface Mast {
  group: THREE.Group;
  /**
   * @param sunYaw    rotation about the vertical that turns the panel towards the Sun
   * @param earthDir  unit vector towards the Earth, in scene coordinates
   * @param powered   0 to 1: how much of the Sun reaches the panel
   * @param linked    true when the Earth is above the terrain: a direct radio link exists
   * @param timeS     seconds, for the travelling pulses of the link and the beacon
   */
  update(sunYaw: number, earthDir: THREE.Vector3, powered: number, linked: boolean, timeS: number): void;
  /** The small animations (radio link, beacon), every frame. */
  animate(timeS: number): void;
  dispose(): void;
}

function cellTexture(cols: number, rows: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = cols * 32;
  c.height = rows * 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#04060b';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const shade = 12 + ((x * 7 + y * 13) % 5) * 3;
      g.fillStyle = `rgb(${shade},${shade + 5},${shade + 20})`;
      g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
      g.strokeStyle = 'rgba(200,210,230,0.28)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x * 32 + 11, y * 32 + 1.5);
      g.lineTo(x * 32 + 11, y * 32 + 30.5);
      g.moveTo(x * 32 + 21, y * 32 + 1.5);
      g.lineTo(x * 32 + 21, y * 32 + 30.5);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Crinkled insulation foil: a normal map made of random facets. */
function foilNormals(): THREE.Texture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cells = 14;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < cells * cells; i++) {
    nx.push((rnd() - 0.5) * 0.9);
    ny.push((rnd() - 0.5) * 0.9);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x / size) * cells + Math.sin(y * 0.31) * 0.35);
      const cy = Math.floor((y / size) * cells + Math.sin(x * 0.27) * 0.35);
      const k = (((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells);
      const i = (y * size + x) * 4;
      data[i] = 128 + nx[k] * 127;
      data[i + 1] = 128 + ny[k] * 127;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.needsUpdate = true;
  return t;
}

const LINK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vAlong;
void main() {
  vAlong = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const LINK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uOn;
varying float vAlong;
void main() {
  #include <logdepthbuf_fragment>
  // Short pulses running up the beam towards the Earth, fading with distance.
  float pulse = smoothstep(0.55, 1.0, fract(vAlong * 0.09 - uTime * 0.9));
  float fade = exp(-vAlong * 0.012);
  gl_FragColor = vec4(vec3(0.49, 0.72, 1.0) * (0.22 + 1.1 * pulse) * fade * uOn, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createMast(mastM: number): Mast {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const tall = mastM >= 8;
  const panelW = tall ? 2.6 : 1.7;
  const panelH = tall ? 3.6 : 1.05;
  const centre = Math.max(0.62, mastM);

  const foil = keep(new THREE.MeshStandardMaterial({ color: 0xb9b9bd, metalness: 0.85, roughness: 0.42, normalMap: keep(foilNormals()), normalScale: new THREE.Vector2(0.32, 0.32) }));
  const white = keep(new THREE.MeshStandardMaterial({ color: 0xa2a2a6, metalness: 0.05, roughness: 0.7 }));
  const metal = keep(new THREE.MeshStandardMaterial({ color: 0x8c8c92, metalness: 0.85, roughness: 0.45 }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.5, roughness: 0.55 }));
  const cells = keep(new THREE.MeshStandardMaterial({ map: keep(cellTexture(tall ? 8 : 6, tall ? 11 : 4)), metalness: 0.55, roughness: 0.26 }));
  const beacon = keep(new THREE.MeshBasicMaterial({ color: 0x000000 }));

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = group): THREE.Mesh => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const beam = (from: THREE.Vector3, to: THREE.Vector3, r: number, parent: THREE.Object3D = group) => {
    const m = add(new THREE.CylinderGeometry(r, r, from.distanceTo(to), 10), metal, 0, 0, 0, parent);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  };

  // Base: an equipment box on three outriggers
  add(new THREE.BoxGeometry(0.9, 0.42, 0.9), foil, 0, 0.5, 0);
  add(new THREE.BoxGeometry(0.96, 0.04, 0.96), white, 0, 0.73, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const foot = new THREE.Vector3(Math.cos(a) * 1.45, 0.05, Math.sin(a) * 1.45);
    add(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 18), metal, foot.x, 0.04, foot.z);
    beam(new THREE.Vector3(Math.cos(a) * 0.42, 0.62, Math.sin(a) * 0.42), foot, 0.03);
    beam(new THREE.Vector3(Math.cos(a) * 0.42, 0.32, Math.sin(a) * 0.42), foot, 0.018);
  }

  // Telescoping mast up to the bottom of the array
  const top = Math.max(0.78, centre - panelH / 2 + 0.1);
  const sections = Math.max(1, Math.round((top - 0.75) / 2.2));
  for (let k = 0; k < sections; k++) {
    const y0 = 0.75 + ((top - 0.75) * k) / sections;
    const y1 = 0.75 + ((top - 0.75) * (k + 1)) / sections;
    const r = 0.07 - (0.035 * k) / sections;
    add(new THREE.CylinderGeometry(r * 0.86, r, y1 - y0, 14), k % 2 ? metal : white, 0, (y0 + y1) / 2, 0);
    add(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.05, 14), metal, 0, y0 + 0.02, 0);
  }

  // The array turns about the mast to face the Sun
  const head = new THREE.Group();
  head.position.set(0, centre, 0);
  group.add(head);
  add(new THREE.BoxGeometry(panelW, panelH, 0.035), white, 0, 0, -0.03, head);
  add(new THREE.PlaneGeometry(panelW - 0.08, panelH - 0.08), cells, 0, 0, -0.01, head);
  add(new THREE.BoxGeometry(panelW + 0.04, 0.05, 0.06), metal, 0, panelH / 2, -0.03, head);
  add(new THREE.BoxGeometry(panelW + 0.04, 0.05, 0.06), metal, 0, -panelH / 2, -0.03, head);
  add(new THREE.SphereGeometry(0.035, 12, 8), beacon, 0, panelH / 2 + 0.09, -0.03, head);

  // Dish on a side arm, at the height of the array
  const arm = new THREE.Group();
  arm.position.set(0, Math.max(0.95, centre - panelH / 2 - 0.1), 0);
  group.add(arm);
  beam(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.55, 0.12, 0), 0.02, arm);
  const dish = new THREE.Group();
  dish.position.set(0.55, 0.2, 0);
  arm.add(dish);
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = (0.36 * i) / 12;
    profile.push(new THREE.Vector2(r, (r * r) / (4 * 0.3)));
  }
  const bowl = add(new THREE.LatheGeometry(profile, 40), white, 0, 0, 0, dish);
  (bowl.material as THREE.Material).side = THREE.DoubleSide;
  bowl.rotation.x = Math.PI / 2; // the axis of the bowl along +Z
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    beam(new THREE.Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.075), new THREE.Vector3(0, 0, 0.3), 0.006, dish);
  }
  add(new THREE.SphereGeometry(0.03, 10, 8), dark, 0, 0, 0.3, dish);

  // Symbolic radio link: a thin beam of pulses from the dish towards the Earth
  const linkMat = keep(
    new THREE.ShaderMaterial({ vertexShader: LINK_VERT, fragmentShader: LINK_FRAG, uniforms: { uTime: { value: 0 }, uOn: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const linkGeo = keep(new THREE.CylinderGeometry(0.02, 0.02, 320, 6, 1, true));
  linkGeo.translate(0, 160, 0);
  linkGeo.rotateX(Math.PI / 2); // along +Z, starting at the dish
  const link = new THREE.Mesh(linkGeo, linkMat);
  link.frustumCulled = false;
  link.position.set(0, 0, 0.3);
  dish.add(link);
  link.userData.noShadow = true;

  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  let linkLevel = 0;
  let hasPower = false;
  let hasLink = false;
  return {
    group,
    update(sunYaw, earthDir, powered, linked, timeS) {
      head.rotation.y = sunYaw - group.rotation.y;
      const local = earthDir.clone().applyAxisAngle(up, -group.rotation.y).normalize();
      dish.quaternion.setFromUnitVectors(forward, local);
      hasPower = powered > 0.5;
      hasLink = linked;
      this.animate(timeS);
    },
    animate(timeS) {
      linkLevel += ((hasLink ? 1 : 0) - linkLevel) * 0.12;
      linkMat.uniforms.uOn.value = linkLevel;
      linkMat.uniforms.uTime.value = timeS;
      link.visible = linkLevel > 0.01;
      // A beacon that blinks once every two seconds while the array has power.
      const blink = hasPower && timeS % 2 < 0.12 ? 1 : 0;
      beacon.color.setScalar(blink * 6);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
