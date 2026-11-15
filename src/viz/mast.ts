// A vertical solar array on a mast, with a dish on top: the piece of hardware that the "panel and
// antenna height" requirement is about. The panel stands at the chosen height and turns to the
// Sun; the dish points at the Earth, and a fine steady line marks the line of sight when the Earth is in view.
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
   */
  update(sunYaw: number, earthDir: THREE.Vector3, powered: number, linked: boolean): void;
  /** Eases the line of sight in and out, every frame. Nothing here blinks or pulses. */
  animate(): void;
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

// The line of sight from the dish to the Earth. Radio is invisible: this is a drawing aid, and it is drawn
// like one, as a steady hairline. It is a ribbon that always faces the camera and keeps the same width on
// screen at any distance, with a soft edge, so it neither shimmers nor breaks up far away.
const LINK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float side;
uniform float uHeight;
uniform float uWidth;
varying float vAlong;
varying float vSide;
void main() {
  vAlong = position.z;
  vSide = side;
  vec4 axis = modelViewMatrix * vec4(0.0, 0.0, position.z, 1.0);
  vec3 along = normalize(mat3(modelViewMatrix) * vec3(0.0, 0.0, 1.0));
  vec3 across = normalize(cross(along, axis.xyz));
  // Half the width, in metres, that covers uWidth pixels at this distance.
  float half_ = uWidth * max(0.05, -axis.z) / (projectionMatrix[1][1] * uHeight);
  gl_Position = projectionMatrix * vec4(axis.xyz + across * side * half_, 1.0);
  #include <logdepthbuf_vertex>
}`;
const LINK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uOn;
varying float vAlong;
varying float vSide;
void main() {
  #include <logdepthbuf_fragment>
  float edge = 1.0 - smoothstep(0.25, 1.0, abs(vSide));
  float fade = exp(-vAlong * 0.011);
  gl_FragColor = vec4(vec3(0.49, 0.72, 1.0) * 0.62 * edge * fade * uOn, 1.0);
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
  // Nothing may cross anything else while the array turns: the deck is low, the array starts above
  // it, and the dish stands on the axis of rotation, above the sweep of the array.
  const DECK = 0.5;
  const centre = Math.max(DECK + 0.14 + panelH / 2, mastM);

  const foil = keep(new THREE.MeshStandardMaterial({ color: 0xb9b9bd, metalness: 0.85, roughness: 0.42, normalMap: keep(foilNormals()), normalScale: new THREE.Vector2(0.32, 0.32) }));
  const white = keep(new THREE.MeshStandardMaterial({ color: 0xa2a2a6, metalness: 0.05, roughness: 0.7 }));
  const metal = keep(new THREE.MeshStandardMaterial({ color: 0x8c8c92, metalness: 0.85, roughness: 0.45 }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.5, roughness: 0.55 }));
  const cells = keep(new THREE.MeshStandardMaterial({ map: keep(cellTexture(tall ? 8 : 6, tall ? 11 : 4)), metalness: 0.55, roughness: 0.26 }));

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

  // Base: a low equipment box on three outriggers
  add(new THREE.BoxGeometry(0.9, 0.3, 0.9), foil, 0, 0.33, 0);
  add(new THREE.BoxGeometry(0.96, 0.04, 0.96), white, 0, DECK, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const foot = new THREE.Vector3(Math.cos(a) * 1.45, 0.05, Math.sin(a) * 1.45);
    add(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 18), metal, foot.x, 0.04, foot.z);
    beam(new THREE.Vector3(Math.cos(a) * 0.42, 0.44, Math.sin(a) * 0.42), foot, 0.03);
    beam(new THREE.Vector3(Math.cos(a) * 0.42, 0.24, Math.sin(a) * 0.42), foot, 0.018);
  }

  // Telescoping mast from the deck up to the bottom of the array
  const foot = DECK + 0.02;
  const top = centre - panelH / 2 - 0.03;
  const sections = Math.max(1, Math.round((top - foot) / 2.2));
  for (let k = 0; k < sections; k++) {
    const y0 = foot + ((top - foot) * k) / sections;
    const y1 = foot + ((top - foot) * (k + 1)) / sections;
    const r = 0.07 - (0.035 * k) / sections;
    add(new THREE.CylinderGeometry(r * 0.86, r, y1 - y0, 14), k % 2 ? metal : white, 0, (y0 + y1) / 2, 0);
    add(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.04, 14), metal, 0, y0 + 0.02, 0);
  }

  // The array turns about the mast to face the Sun
  const head = new THREE.Group();
  head.position.set(0, centre, 0);
  group.add(head);
  add(new THREE.BoxGeometry(panelW, panelH, 0.035), white, 0, 0, -0.03, head);
  add(new THREE.PlaneGeometry(panelW - 0.08, panelH - 0.08), cells, 0, 0, -0.01, head);
  add(new THREE.BoxGeometry(panelW + 0.04, 0.05, 0.06), metal, 0, panelH / 2, -0.03, head);
  add(new THREE.BoxGeometry(panelW + 0.04, 0.05, 0.06), metal, 0, -panelH / 2, -0.03, head);
  // Stiffeners on the back of the array, so that it reads as a structure from behind as well
  for (const x of [-panelW / 3, 0, panelW / 3]) add(new THREE.BoxGeometry(0.035, panelH - 0.06, 0.03), metal, x, 0, -0.062, head);
  const rows = tall ? 5 : 2;
  for (let i = 1; i <= rows; i++) add(new THREE.BoxGeometry(panelW - 0.04, 0.025, 0.022), metal, 0, -panelH / 2 + (panelH * i) / (rows + 1), -0.058, head);
  add(new THREE.BoxGeometry(0.22, 0.16, 0.07), foil, 0, -panelH / 2 + 0.14, -0.1, head); // drive and harness box
  // Dish on a post above the array, on the axis the array turns about: the two can never meet.
  const DISH_R = 0.36;
  const dishY = centre + panelH / 2 + 0.03 + DISH_R + 0.2;
  const postFoot = centre + panelH / 2 + 0.025;
  add(new THREE.CylinderGeometry(0.02, 0.028, dishY - postFoot, 12), metal, 0, (dishY + postFoot) / 2, 0);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), metal, 0, postFoot + 0.015, 0);
  add(new THREE.SphereGeometry(0.055, 14, 10), dark, 0, dishY, 0);
  const dish = new THREE.Group();
  dish.position.set(0, dishY, 0);
  group.add(dish);
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = (DISH_R * i) / 12;
    profile.push(new THREE.Vector2(r, (r * r) / (4 * 0.3)));
  }
  const bowl = add(new THREE.LatheGeometry(profile, 40), white, 0, 0, 0.05, dish);
  (bowl.material as THREE.Material).side = THREE.DoubleSide;
  bowl.rotation.x = Math.PI / 2; // the axis of the bowl along +Z
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    beam(new THREE.Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.125), new THREE.Vector3(0, 0, 0.35), 0.006, dish);
  }
  add(new THREE.SphereGeometry(0.03, 10, 8), dark, 0, 0, 0.35, dish);

  // Line of sight to the Earth: a ribbon from the feed of the dish, 320 m long, fading with distance.
  const linkMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: LINK_VERT,
      fragmentShader: LINK_FRAG,
      uniforms: { uOn: { value: 0 }, uHeight: { value: 800 }, uWidth: { value: 2.6 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const linkGeo = keep(new THREE.BufferGeometry());
  const LINK_M = 320;
  linkGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, LINK_M, 0, 0, LINK_M], 3));
  linkGeo.setAttribute('side', new THREE.Float32BufferAttribute([-1, 1, -1, 1], 1));
  linkGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const link = new THREE.Mesh(linkGeo, linkMat);
  link.frustumCulled = false;
  link.position.set(0, 0, 0.35);
  dish.add(link);
  link.userData.noShadow = true;
  // The width is counted in pixels of whichever picture is being drawn: the main view or a telephoto window.
  const viewport = new THREE.Vector4();
  link.onBeforeRender = (renderer) => {
    renderer.getViewport(viewport);
    linkMat.uniforms.uHeight.value = Math.max(1, viewport.w);
  };

  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  let linkLevel = 0;
  let hasLink = false;
  return {
    group,
    update(sunYaw, earthDir, _powered, linked) {
      head.rotation.y = sunYaw - group.rotation.y;
      const local = earthDir.clone().applyAxisAngle(up, -group.rotation.y).normalize();
      dish.quaternion.setFromUnitVectors(forward, local);
      hasLink = linked;
      this.animate();
    },
    animate() {
      linkLevel += ((hasLink ? 1 : 0) - linkLevel) * 0.12;
      linkMat.uniforms.uOn.value = linkLevel;
      link.visible = linkLevel > 0.01;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
