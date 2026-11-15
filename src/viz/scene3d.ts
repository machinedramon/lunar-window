// First-person 3D view from the landing site.
//
// What is real: the terrain (NASA LOLA elevation, three nested grids with the curvature of the
// Moon built in), the skyline (the same horizon profile the planner uses), the directions and
// angular sizes of the Sun and the Earth, the phase and the face of the Earth, and the shadows
// (marched through the elevation data towards the Sun, with the penumbra of a 0.53 degree disc).
// The stars are the Yale Bright Star Catalogue at their true positions.
// What is illustrative: surface relief finer than the terrain model, the rocks, the vehicles and
// the clouds on the Earth.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EYE_MIN_M } from './eye';
import { triangleHeight } from './rest';
import { createProps, PROP_LAYER, type Props } from './props';

export const TERRAIN_N = 257;
export const TERRAIN_LEVELS = 4;
export const TERRAIN_HALF_M = [640, 6400, 51200, 307200];
export const TERRAIN_UNIT_M = [0.0625, 0.25, 0.5, 2.5];
const SHADOW_N = 512;
const FAR_M = 400000;
const SKY_M = 380000;
const D2R = Math.PI / 180;

export interface SceneSky {
  sunAz: number;
  sunEl: number;
  sunRadius: number;
  /** Visible fraction of the solar disc, 0 to 1 (drives the glare). */
  sunFrac: number;
  /** Fraction of the Sun hidden by the Earth. */
  eclipse: number;
  /** True when the Earth is above the terrain: a direct radio link exists. */
  linked: boolean;
  earthAz: number;
  earthEl: number;
  earthRadius: number;
  /** Unit vectors of the Earth's north pole and Greenwich meridian in the local frame: [east, north, up]. */
  earthNorth: [number, number, number];
  earthGreenwich: [number, number, number];
  /** Local east, north and up of the site in J2000 equatorial coordinates, to place the stars. */
  starAxes: { east: readonly number[]; north: readonly number[]; up: readonly number[]; planets?: { name: string; dir: readonly number[]; mag: number }[] };
}

/** Planets drawn among the stars: Mercury, Venus, Mars, Jupiter, Saturn. */
const PLANETS = 5;
const PLANET_TINT: Record<string, [number, number, number]> = {
  Mercury: [1, 0.95, 0.88],
  Venus: [1, 1, 0.94],
  Mars: [1, 0.72, 0.5],
  Jupiter: [1, 0.95, 0.84],
  Saturn: [1, 0.92, 0.74],
};

/** How a point of light of a given visual magnitude is drawn: diameter in pixels, intensity, and a halo for the brightest. */
function starLook(mag: number): { size: number; gain: number; halo: number } {
  const halo = Math.max(0, Math.min(1, (1.6 - mag) / 2.4));
  return {
    size: Math.max(2.4, 7.4 - 1.25 * (mag + 1.5)) * (1 + 0.9 * halo),
    gain: Math.max(0.17, Math.min(3.2, 1.8 * Math.pow(10, -0.4 * mag * 0.55))),
    halo,
  };
}

/** Colour of a black body, roughly, kept pale: on screen the Earth remains the only strong colour. */
function starTint(kelvin: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (kelvin - 3000) / 9000));
  const warm: [number, number, number] = [1, 0.78, 0.58];
  const white: [number, number, number] = [1, 0.97, 0.93];
  const blue: [number, number, number] = [0.74, 0.83, 1];
  const mixTo = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  return t < 0.33 ? mixTo(warm, white, t / 0.33) : mixTo(white, blue, (t - 0.33) / 0.67);
}

const STAR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 tint;
attribute float size;
attribute float halo;
uniform float uDpr;
varying vec3 vTint;
varying float vHalo;
void main() {
  vTint = tint;
  vHalo = halo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uDpr;
  #include <logdepthbuf_vertex>
}`;
// Stars do not twinkle on the Moon: there is no air. Each one is a steady round point.
const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
uniform float uGain;
varying vec3 vTint;
varying float vHalo;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float sharp = mix(4.5, 18.0, vHalo);
  float light = exp(-r2 * sharp) + vHalo * 0.05 * exp(-r2 * 3.0) * (1.0 - r2);
  gl_FragColor = vec4(vTint * light * uOpacity * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const GALAXY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
// NASA's Deep Star Map is a plate carrée in J2000: centred on 0 h of right ascension, which grows to the left.
const GALAXY_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform sampler2D uFine;
uniform float uFineOn;
uniform float uOpacity;
uniform float uGain;
varying vec3 vDir;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  vec2 uv = vec2(0.5 - atan(d.y, d.x) / (2.0 * PI), 0.5 + asin(clamp(d.z, -1.0, 1.0)) / PI);
  vec3 c = texture2D(uMap, uv).rgb;
  if (uFineOn > 0.5) {
    // The brightness comes from the 8192-pixel map, the colour from the smaller one. The longitude jumps by a
    // whole turn at one meridian: the size of a pixel on the map is measured on whichever side has no jump.
    vec2 other = vec2(fract(uv.x + 0.5), uv.y);
    bool jump = fwidth(uv.x) > fwidth(other.x);
    vec2 gx = jump ? dFdx(other) : dFdx(uv);
    vec2 gy = jump ? dFdy(other) : dFdy(uv);
    float fine = pow(textureGrad(uFine, uv, gx, gy).r, 2.2);
    float coarse = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = fine * clamp(c / max(coarse, 0.02), 0.5, 1.8);
  }
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.4);
  c = pow(c, vec3(1.3));
  gl_FragColor = vec4(c * uOpacity * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Direction in scene coordinates (x east, y up, z south) of an azimuth and elevation in degrees. */
export function direction(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = az * D2R;
  const e = el * D2R;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

const HEIGHTS = /* glsl */ `
uniform sampler2D tH0;
uniform sampler2D tH1;
uniform sampler2D tH2;
uniform sampler2D tH3;
const vec4 HALF = vec4(640.0, 6400.0, 51200.0, 307200.0);
const float GN = 257.0;
float texH(sampler2D t, vec2 p, float halfSize) {
  vec2 uv = (p / halfSize * 0.5 + 0.5) * ((GN - 1.0) / GN) + 0.5 / GN;
  return texture2D(t, uv).r;
}
float blendAt(float m, float halfSize) {
  return smoothstep(0.84 * halfSize, 0.97 * halfSize, m);
}
// Ground height (metres above the plane tangent at the site) at a point given as (east, north).
// The finest grid that contains the point is used, blended into the next one near its edge.
float heightAt(vec2 p) {
  float m = max(abs(p.x), abs(p.y));
  float h = texH(tH3, clamp(p, -HALF.w, HALF.w), HALF.w);
  if (m < HALF.z) {
    h = mix(texH(tH2, p, HALF.z), h, blendAt(m, HALF.z));
    if (m < HALF.y) {
      h = mix(texH(tH1, p, HALF.y), h, blendAt(m, HALF.y));
      if (m < HALF.x) h = mix(texH(tH0, p, HALF.x), h, blendAt(m, HALF.x));
    }
  }
  return h;
}
`;

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 x, out vec2 g);
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
// One size class of small craters (illustrative: they are below the resolution of the data).
// Adds their slopes to grad and multiplies lit by the shadow that the sunward rim casts in each bowl.
void craters(vec2 p, float cell, float density, float weight, float tanSun, vec2 sunDir, inout vec2 grad, inout float lit) {
  vec2 ip = floor(p / cell);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = ip + vec2(float(i), float(j));
      vec3 r = hash32(c + cell * 3.7);
      if (r.z > density) continue;
      vec2 q = p - (c + 0.5 + (r.xy - 0.5) * 0.62) * cell;
      float k = fract(r.z * 7.31);
      float radius = cell * (0.10 + 0.26 * k * k);
      // No lunar crater is a perfect circle: bend the outline a little.
      vec2 wg;
      float bend = vnoise(q / radius * 1.3 + r.xy * 40.0, wg);
      q *= 1.0 + 0.22 * (bend - 0.5);
      float d2 = dot(q, q);
      float rr = sqrt(d2) / radius;
      if (rr > 2.2) continue;
      // Depth to diameter from 0.03 (old, worn) to 0.2 (fresh); most small lunar craters are worn.
      float fresh = fract(r.z * 13.7);
      float depth = radius * (0.035 + 0.36 * fresh * fresh * fresh * fresh);
      float rim = depth * 0.16;
      float dz = rr < 1.0 ? 2.0 * depth * rr * (1.0 - 0.35 * rr * rr) : -rim / 0.7 * exp(-(rr - 1.0) / 0.7);
      grad += weight * (dz / radius) * q / max(1e-4, sqrt(d2));
      if (rr < 1.0) {
        float b = dot(q, sunDir);
        float toRim = -b + sqrt(max(0.0, b * b - (d2 - radius * radius)));
        float below = depth * (1.0 - rr * rr);
        float clearance = (toRim * tanSun - below) / max(toRim, 1e-3);
        lit *= mix(1.0, smoothstep(-0.006, 0.006, clearance), weight);
      }
    }
  }
}
// Boulders (illustrative): a small bright dome and the long shadow it throws when the Sun is low.
void boulders(vec2 p, float cell, float weight, float tanSun, vec2 sunDir, inout vec2 grad, inout float lit) {
  vec2 ip = floor(p / cell);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = ip + vec2(float(i), float(j));
      vec3 r = hash32(c + cell * 11.3 + 71.0);
      if (r.z > 0.34) continue;
      vec2 q = p - (c + 0.5 + (r.xy - 0.5) * 0.8) * cell;
      float size = cell * (0.012 + 0.05 * r.x * r.y);
      float height = size * (0.7 + 0.8 * fract(r.z * 9.1));
      float rr = length(q) / size;
      if (rr < 1.0) grad += weight * (-2.2 * height * rr / size) * q / max(1e-4, length(q));
      float reach = min(height / max(tanSun, 0.012), cell * 1.35);
      float along = -dot(q, sunDir);
      float across = abs(q.x * sunDir.y - q.y * sunDir.x);
      // The shadow of a small stone under a low Sun: long, narrowing, and dissolving in its own penumbra
      // (the Sun is a disc), not a dark shape with corners.
      float far = clamp(along / reach, 0.0, 1.0);
      float half_ = size * (1.0 - 0.5 * far) + along * 0.0047;
      float inShadow = smoothstep(0.0, size * 0.6, along) * (1.0 - smoothstep(0.35, 1.0, far)) * (1.0 - smoothstep(half_ * 0.35, half_ * 1.15, across));
      lit *= 1.0 - weight * 0.8 * inShadow;
    }
  }
}
// Value noise and its gradient.
float vnoise(vec2 x, out vec2 g) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  g = du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
`;

const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${HEIGHTS}
uniform float uHalf;
varying vec3 vPos;
void main() {
  vec2 p = position.xy * 2.0 * uHalf;
  vPos = vec3(p.x, heightAt(p), -p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const TERRAIN_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
${HEIGHTS}
${NOISE}
uniform sampler2D tRegA;
uniform sampler2D tRegN;
uniform float uRegOn;
uniform sampler2D tProp;
uniform mat4 uPropMatrix;
uniform float uPropOn;
// Where the vehicle and the mast stand: east, north, radius (0: none).
uniform vec3 uStand[2];
uniform sampler2D tS0;
uniform sampler2D tS1;
uniform sampler2D tS2;
uniform sampler2D tS3;
uniform float uInner;
uniform float uFine;
uniform vec3 uSun;
uniform float uSunPower;
uniform vec3 uEarth;
uniform float uEarthshine;
varying vec3 vPos;

vec2 slopeOf(sampler2D t, vec2 p, float halfSize, float e) {
  return vec2(texH(t, p + vec2(e, 0.0), halfSize) - texH(t, p - vec2(e, 0.0), halfSize),
              texH(t, p + vec2(0.0, e), halfSize) - texH(t, p - vec2(0.0, e), halfSize)) / (2.0 * e);
}
float texS(sampler2D t, vec2 p, float halfSize) {
  return texture2D(t, p / halfSize * 0.5 + 0.5).r;
}
// Height of the finest grid through a cubic filter (four bilinear taps): a surface without creases, for shading.
float heightSmooth(vec2 p) {
  vec2 st = (p / HALF.x * 0.5 + 0.5) * (GN - 1.0);
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (3.0 * f * f * f - 6.0 * f * f + 4.0) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / GN;
  vec2 h1 = (i + 1.5 + w3 / g1) / GN;
  return g0.y * (g0.x * texture2D(tH0, vec2(h0.x, h0.y)).r + g1.x * texture2D(tH0, vec2(h1.x, h0.y)).r) +
    g1.y * (g0.x * texture2D(tH0, vec2(h0.x, h1.y)).r + g1.x * texture2D(tH0, vec2(h1.x, h1.y)).r);
}
// Slope of that smooth surface. With the Sun a couple of degrees up, the line between lit and unlit ground is
// where the slope equals the Sun's height: on a creased surface that line is a polygon; on this one it curves.
vec2 slopeSmooth(vec2 p, float e) {
  return vec2(heightSmooth(p + vec2(e, 0.0)) - heightSmooth(p - vec2(e, 0.0)), heightSmooth(p + vec2(0.0, e)) - heightSmooth(p - vec2(0.0, e))) / (2.0 * e);
}
// The finest shadow map read through a cubic filter (four bilinear taps): its 2.5 m squares do not show as steps.
float texSmooth(sampler2D t, vec2 p, float halfSize) {
  const float N = 512.0;
  vec2 st = (p / halfSize * 0.5 + 0.5) * N - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (3.0 * f * f * f - 6.0 * f * f + 4.0) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / N;
  vec2 h1 = (i + 1.5 + w3 / g1) / N;
  return g0.y * (g0.x * texture2D(t, vec2(h0.x, h0.y)).r + g1.x * texture2D(t, vec2(h1.x, h0.y)).r) +
    g1.y * (g0.x * texture2D(t, vec2(h0.x, h1.y)).r + g1.x * texture2D(t, vec2(h1.x, h1.y)).r);
}
float shadowAt(vec2 p) {
  float m = max(abs(p.x), abs(p.y));
  float s = texS(tS3, clamp(p, -HALF.w, HALF.w), HALF.w);
  if (m < HALF.z) {
    s = mix(texS(tS2, p, HALF.z), s, blendAt(m, HALF.z));
    if (m < HALF.y) {
      s = mix(texS(tS1, p, HALF.y), s, blendAt(m, HALF.y));
      if (m < HALF.x) s = mix(texSmooth(tS0, p, HALF.x), s, blendAt(m, HALF.x));
    }
  }
  return s;
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vec2(vPos.x, -vPos.z);
  float m = max(abs(p.x), abs(p.y));
  if (m < uInner) discard;

  // Slope of the real terrain, from the finest grid available here. The slopes of two grids are
  // blended where they meet (blending the heights would add a false slope there).
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  vec2 slope = slopeOf(tH3, clamp(p, -HALF.w, HALF.w), HALF.w, max(1900.0, 1.5 * footprint));
  if (m < HALF.z) {
    slope = mix(slopeOf(tH2, p, HALF.z, max(320.0, 1.5 * footprint)), slope, blendAt(m, HALF.z));
    if (m < HALF.y) {
      slope = mix(slopeOf(tH1, p, HALF.y, max(40.0, 1.5 * footprint)), slope, blendAt(m, HALF.y));
      if (m < HALF.x) slope = mix(slopeSmooth(p, max(2.5, 1.5 * footprint)), slope, blendAt(m, HALF.x));
    }
  }
  float dE = slope.x;
  float dN = slope.y;

  vec3 nMacro = normalize(vec3(-dE, 1.0, dN));
  float muMacro = dot(nMacro, uSun);
  float tanSun = muMacro / sqrt(max(1e-4, 1.0 - muMacro * muMacro));
  vec2 sunDir = normalize(vec2(uSun.x, -uSun.z) + 1e-6);

  // Relief below the resolution of the data: illustrative, faded out before it can alias.
  vec2 micro = vec2(0.0);
  float craterLit = 1.0;
  // Under a wheel or a footpad the ground is drawn as the data gives it: an invented bowl there would look
  // like the wheel floating over it or sunk into it.
  float plain = 1.0;
  for (int k = 0; k < 2; k++) {
    if (uStand[k].z > 0.0) plain *= smoothstep(uStand[k].z * 0.75, uStand[k].z * 1.5, distance(p, uStand[k].xy));
  }
  // With a 5 m model the real craters down to about 15 m are in the geometry; only smaller ones are invented.
  float cell = m < HALF.x * 0.9 ? mix(46.0, 9.0, uFine) : 46.0;
  // Share of a bowl that its own rim shadows, for craters too small to resolve at this distance.
  float hidden = clamp(1.0 - 6.0 * max(tanSun, 0.0), 0.0, 1.0);
  for (int o = 0; o < 6; o++) {
    float density = o < 2 ? 0.2 : 0.36;
    float w = plain * smoothstep(0.42 * cell, 0.12 * cell, footprint);
    if (w > 0.002) craters(p, cell, density, w, tanSun, sunDir, micro, craterLit);
    craterLit *= 1.0 - (1.0 - w) * 0.05 * hidden;
    cell *= 0.4;
  }
  float block = 30.0;
  for (int o = 0; o < 4; o++) {
    float w = plain * smoothstep(0.03 * block, 0.008 * block, footprint);
    if (w > 0.002) boulders(p, block, w, tanSun, sunDir, micro, craterLit);
    block *= 0.34;
  }
  // Weights of the photographed regolith: only where a pixel is small enough to show it.
  float wA = uRegOn * smoothstep(0.045, 0.006, footprint);
  float wB = uRegOn * smoothstep(0.2, 0.03, footprint);
  float albedoNoise = 0.0;
  float lambda = 34.0;
  float amp = 0.005;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  vec2 pr = p;
  for (int o = 0; o < 7; o++) {
    float w = smoothstep(1.6 * footprint, 5.0 * footprint, lambda);
    if (w > 0.0) {
      vec2 g;
      float v = vnoise(pr / lambda + float(o) * 19.7, g);
      micro += w * amp * (g * turn) * (1.0 - 0.7 * wB);
      if (o < 3) albedoNoise += w * (v - 0.5) * 0.2;
    }
    pr = turn * pr;
    turn = turn * mat2(0.8, 0.6, -0.6, 0.8);
    lambda *= 0.41;
    amp *= 1.32;
  }
  // Photographed regolith (Poly Haven "moon dusted", CC0) for the grain near the camera, at two scales
  // turned against each other so that the repetition does not show.
  vec2 uvA = p / 2.9;
  vec2 uvB = vec2(0.7071 * p.x - 0.7071 * p.y, 0.7071 * p.x + 0.7071 * p.y) / 13.0 + 0.37;
  vec3 nA = texture2D(tRegN, uvA).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(tRegN, uvB).xyz * 2.0 - 1.0;
  float aA = texture2D(tRegA, uvA).r;
  float aB = texture2D(tRegA, uvB).r;
  micro += wA * 0.85 * nA.xy / max(0.35, nA.z) + wB * 0.55 * vec2(0.7071 * (nB.x + nB.y), 0.7071 * (nB.y - nB.x)) / max(0.35, nB.z);
  albedoNoise += wA * (aA - 0.5) * 0.7 + wB * (aB - 0.5) * 0.5;

  vec3 n = normalize(vec3(-(dE + micro.x), 1.0, dN + micro.y));
  vec3 v = normalize(cameraPosition - vPos);

  // Lunar-Lambert photometry: the Moon has no limb darkening, grazing ground stays bright.
  float mu0 = dot(n, uSun);
  float mu = max(dot(n, v), 0.0);
  float direct = 0.0;
  if (mu0 > 0.0) direct = 0.72 * 2.0 * mu0 / (mu0 + mu + 1e-4) + 0.28 * mu0;
  // Regolith scatters light back towards the Sun: bright down-Sun, dim when looking into the Sun.
  float cosPhase = dot(v, uSun);
  float phase = 0.22 + 0.78 * pow(0.5 + 0.5 * cosPhase, 1.5) + 0.35 * exp(-acos(clamp(cosPhase, -1.0, 1.0)) / 0.09);
  float shadow = shadowAt(p) * craterLit;
  // Shadows of the rocks and the lander: a depth map seen from the Sun.
  if (uPropOn > 0.5 && m < 260.0) {
    vec4 lp = uPropMatrix * vec4(vPos, 1.0);
    vec3 q = lp.xyz / lp.w * 0.5 + 0.5;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && q.z < 1.0) {
      // The Sun is a disc, not a point: the edge of a shadow is a penumbra that widens with the distance from
      // what casts it (0.0093 m per metre). A thin thing casts a sharp shadow at its foot and none far away.
      // The map is 190 m wide and 24 m high, and 699 m deep.
      const vec2 PER_M = vec2(1.0 / 190.0, 1.0 / 24.0);
      float blockers = 0.0;
      float depth = 0.0;
      for (int k = 0; k < 9; k++) {
        float a = float(k) * 2.399963;
        vec2 o = sqrt((float(k) + 0.5) / 9.0) * 0.7 * vec2(cos(a), sin(a));
        float z = unpackRGBAToDepth(texture2D(tProp, q.xy + o * PER_M));
        if (z < q.z - 0.00016) {
          blockers += 1.0;
          depth += z;
        }
      }
      if (blockers > 0.0) {
        float away = max(0.0, q.z - depth / blockers) * 699.0;
        float radius = clamp(away * 0.00465, 0.05, 1.6);
        float lit = 0.0;
        for (int k = 0; k < 16; k++) {
          float a = float(k) * 2.399963 + 0.7;
          vec2 o = sqrt((float(k) + 0.5) / 16.0) * radius * vec2(cos(a), sin(a));
          lit += step(q.z - 0.00016, unpackRGBAToDepth(texture2D(tProp, q.xy + o * PER_M)));
        }
        shadow *= lit / 16.0;
      }
    }
  }

  float albedo = 0.125 * (1.0 + albedoNoise);
  vec3 col = vec3(albedo) * (7.5 * direct * phase * shadow * uSunPower);
  col += vec3(0.80, 0.88, 1.0) * albedo * uEarthshine * (0.35 + 0.65 * max(dot(n, uEarth), 0.0));
  // In shadow the ground still receives the light scattered by the sunlit ground around: dark, not a hole.
  col += vec3(albedo) * 0.034 * uSunPower;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SHADOW_FRAG = /* glsl */ `
${HEIGHTS}
uniform vec3 uSun;
uniform float uHalfLevel;
uniform float uStart;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * uHalfLevel;
  float h = heightAt(p) + 0.6;
  float flat_ = max(1e-5, length(uSun.xz));
  vec2 dir = vec2(uSun.x, -uSun.z) / flat_;
  float slope = uSun.y / flat_;
  float t = uStart;
  float clearance = 1.0;
  for (int i = 0; i < 80; i++) {
    vec2 q = p + dir * t;
    if (max(abs(q.x), abs(q.y)) > HALF.w) break;
    clearance = min(clearance, (h + t * slope - heightAt(q)) / t);
    t *= 1.135;
  }
  // The Sun is a disc 0.266 degrees in radius: the shadow edge is a penumbra that wide.
  float s = smoothstep(-0.00465, 0.00465, clearance);
  gl_FragColor = vec4(s, s, s, 1.0);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SKYLINE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const SKYLINE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun;
uniform float uSunPower;
varying vec3 vPos;
void main() {
  #include <logdepthbuf_fragment>
  // Distant ridges: lit when the Sun is behind the viewer, a dark silhouette against the Sun.
  vec2 toRidge = normalize(vPos.xz);
  vec2 toSun = normalize(uSun.xz + 1e-6);
  float facing = smoothstep(-0.15, 0.75, -dot(toRidge, toSun));
  float up = smoothstep(-0.02, 0.02, uSun.y);
  vec3 col = vec3(0.125) * (0.006 + 2.6 * facing * up * uSunPower);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const EARTH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vNormalO;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalO = normal;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const EARTH_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform vec3 uSun;
uniform float uGain;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vNormalO;
varying vec3 vPosW;
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    s += a * noise3(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return s;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float ndl = dot(n, uSun);
  float day = smoothstep(-0.10, 0.22, ndl);
  vec3 base = texture2D(map, vUv).rgb;
  // Clouds are procedural (illustrative): swirls stretched along latitude.
  vec3 q = normalize(vNormalO);
  float swirl = fbm(vec3(q.x * 3.2, q.y * 5.5, q.z * 3.2) + fbm(q * 2.1) * 1.6);
  float cloud = smoothstep(0.50, 0.74, swirl) * 0.92;
  vec3 col = mix(base, vec3(0.95), cloud);
  vec3 lit = col * (0.06 + 0.94 * max(ndl, 0.0)) * day * 1.9;
  // Sunlight glinting off open water.
  float water = smoothstep(0.02, 0.10, base.b - max(base.r, base.g) * 0.92) * (1.0 - cloud);
  float glint = pow(max(dot(n, normalize(uSun + v)), 0.0), 70.0);
  lit += vec3(1.0, 0.97, 0.90) * glint * water * day * 2.6;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  lit += vec3(0.20, 0.46, 1.0) * rim * day * 1.25;
  lit += col * 0.0012;
  gl_FragColor = vec4(lit * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// One invalid or absurdly bright pixel (a mirror-like facet of the vehicle catching the Sun) would be
// spread by the bloom over a whole block of the picture, which then turns black for a frame. Every
// pixel is brought back to a number the rest of the chain can deal with.
const CLEAN_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  // max() then min(): an invalid number falls to zero, an infinite one to the ceiling.
  vec3 c = min(max(texture2D(tDiffuse, vUv).rgb, vec3(0.0)), vec3(64.0));
  gl_FragColor = vec4(c, 1.0);
}`;

const FINISH_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uAspect;
uniform vec2 uSunAt;
uniform float uSunVis;
varying vec2 vUv;
float h(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// The Sun is drawn as it is: a disc of its true size and the veiling glare around it. No starburst,
// no reflections between lens elements: those belong to a camera, not to the sky.
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(1.05, 0.25, length(d));
  c.rgb *= mix(0.72, 1.0, vig);
  c.rgb += (h(gl_FragCoord.xy) - 0.5) * 0.012;
  gl_FragColor = c;
}
`;

function glareTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    // Smooth fall-off, as the veiling glare of a lens: no visible ring.
    g.addColorStop(t, `rgba(255,255,255,${(Math.pow(1 - t, 3.2) * 0.9).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // A faint horizontal streak, as a real lens gives.
  const s = ctx.createLinearGradient(0, 0, size, 0);
  s.addColorStop(0, 'rgba(255,255,255,0)');
  s.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = s;
  ctx.fillRect(0, size / 2 - 1.5, size, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LunarScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 2, 0.12, FAR_M);
  private readonly tele = new THREE.PerspectiveCamera(5, 1, 0.4, FAR_M);
  /**
   * The telephoto windows show the scene from where the camera stands, so they only change when the sky,
   * the terrain or the vehicles do, not when the camera turns. Each is kept as a small picture of its own
   * and redrawn when its content changes, instead of drawing the whole scene three times per frame.
   */
  private readonly teleShots = [0, 1].map(() => {
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: target.texture, depthTest: false, depthWrite: false, fog: false })));
    return { target, scene, key: '', at: -1e9 };
  });
  private readonly flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Counts every change of what the scene shows (sky, terrain, vehicles), whatever the camera does. */
  private version = 0;
  private shadowMapAt = 0;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;
  private readonly heightTex: THREE.DataTexture[] = [];
  private readonly shadowTargets: THREE.WebGLRenderTarget[] = [];
  private readonly shadowScene = new THREE.Scene();
  private readonly shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly shadowMat: THREE.ShaderMaterial;
  private readonly terrainMats: THREE.ShaderMaterial[] = [];
  private readonly skylineMat: THREE.ShaderMaterial;
  private skyline: THREE.Mesh | null = null;
  private readonly sun: THREE.Mesh;
  private readonly sunMat: THREE.ShaderMaterial;
  private readonly glare: THREE.Sprite;
  private readonly earth: THREE.Mesh;
  private readonly earthMat: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.ShaderMaterial;
  private starCount = 0;
  private readonly galaxy: THREE.Mesh;
  private readonly galaxyMat: THREE.ShaderMaterial;
  private readonly sunDir = new THREE.Vector3(0, 0.02, -1);
  private readonly shadowSun = new THREE.Vector3();
  private shadowsDirty = true;
  private readonly fine = { value: 0 };
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private readonly bounce = new THREE.HemisphereLight(0x000000, 0xa8a8a8, 0);
  private readonly earthLight = new THREE.DirectionalLight(0xbdd4ff, 0);
  private readonly propCam = new THREE.OrthographicCamera(-95, 95, 16, -8, 1, 700);
  private readonly propTarget = new THREE.WebGLRenderTarget(2048, 512, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private readonly propDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private readonly propUniforms = {
    tProp: { value: null as THREE.Texture | null },
    uPropMatrix: { value: new THREE.Matrix4() },
    uPropOn: { value: 0 },
    uStand: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  };
  private props: Props | null = null;
  private propsKey = '';
  private propsDirty = false;
  private lastSky: SceneSky | null = null;
  /** Seconds since the scene started. */
  clock = 0;
  private eye = 2;
  /** Where the eye is going: a change of antenna height is a move, not a jump. */
  private eyeGoal = 2;
  private mastShown = 2;
  private mastGoal = 2;
  /** Where the camera looks: azimuth and pitch in degrees, vertical field of view in degrees. */
  look = { az: 0, pitch: 4, fov: 46 };

  constructor(canvas: HTMLCanvasElement) {
    // The recording tool asks for a picture that stays in the canvas after it is shown, so that a frame grab never finds it empty.
    const keep = Boolean((globalThis as { __lwPreserve?: boolean }).__lwPreserve);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: keep });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 1);
    const linear = this.renderer.extensions.has('OES_texture_float_linear');

    for (let i = 0; i < TERRAIN_LEVELS; i++) {
      const tex = new THREE.DataTexture(new Float32Array(TERRAIN_N * TERRAIN_N), TERRAIN_N, TERRAIN_N, THREE.RedFormat, THREE.FloatType);
      tex.minFilter = tex.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      this.heightTex.push(tex);
      this.shadowTargets.push(new THREE.WebGLRenderTarget(SHADOW_N, SHADOW_N, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    const heights = { tH0: { value: this.heightTex[0] }, tH1: { value: this.heightTex[1] }, tH2: { value: this.heightTex[2] }, tH3: { value: this.heightTex[3] } };
    const shadows = { tS0: { value: this.shadowTargets[0].texture }, tS1: { value: this.shadowTargets[1].texture }, tS2: { value: this.shadowTargets[2].texture }, tS3: { value: this.shadowTargets[3].texture } };
    const light = { uSun: { value: this.sunDir }, uSunPower: { value: 1 }, uEarth: { value: new THREE.Vector3(0, 0.1, -1) }, uEarthshine: { value: 0.012 }, uFine: this.fine };
    const texLoader = new THREE.TextureLoader();
    const regolith = { tRegA: { value: null as THREE.Texture | null }, tRegN: { value: null as THREE.Texture | null }, uRegOn: { value: 0 } };
    let loadedMaps = 0;
    const tile = (file: string, slot: { value: THREE.Texture | null }) => {
      const t = texLoader.load(`${import.meta.env.BASE_URL}textures/regolith/${file}`, () => {
        if (++loadedMaps === 2) regolith.uRegOn.value = 1;
        this.onChange?.();
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      slot.value = t;
    };
    tile('albedo.jpg', regolith.tRegA);
    tile('normal.jpg', regolith.tRegN);
    this.propUniforms.tProp.value = this.propTarget.texture;

    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { ...heights, uSun: { value: this.shadowSun }, uHalfLevel: { value: 1 }, uStart: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.shadowScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMat));

    const grid = new THREE.PlaneGeometry(1, 1, TERRAIN_N - 1, TERRAIN_N - 1);
    for (let i = 0; i < TERRAIN_LEVELS; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: TERRAIN_VERT,
        fragmentShader: TERRAIN_FRAG,
        uniforms: { ...heights, ...shadows, ...light, ...regolith, ...this.propUniforms, uHalf: { value: TERRAIN_HALF_M[i] }, uInner: { value: i ? TERRAIN_HALF_M[i - 1] * 0.985 : 0 } },
        side: THREE.DoubleSide,
        polygonOffset: i > 0,
        polygonOffsetFactor: i,
        polygonOffsetUnits: i,
      });
      const mesh = new THREE.Mesh(grid, mat);
      mesh.frustumCulled = false;
      this.terrainMats.push(mat);
      this.scene.add(mesh);
    }

    this.skylineMat = new THREE.ShaderMaterial({ vertexShader: SKYLINE_VERT, fragmentShader: SKYLINE_FRAG, uniforms: { uSun: light.uSun, uSunPower: light.uSunPower }, side: THREE.DoubleSide });

    this.sunMat = new THREE.ShaderMaterial({
      uniforms: { uGain: { value: 60 } },
      vertexShader: `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vDisc;
void main() {
  vDisc = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,
      fragmentShader: `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uGain;
varying vec2 vDisc;
void main() {
  #include <logdepthbuf_fragment>
  // Limb darkening of the photosphere.
  float mu = sqrt(max(0.0, 1.0 - dot(vDisc, vDisc)));
  gl_FragColor = vec4(vec3(uGain * (0.4 + 0.6 * mu)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(1, 96), this.sunMat);
    this.sun.frustumCulled = false;
    this.scene.add(this.sun);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTexture(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 2.2, 2.15) }));
    this.glare.renderOrder = 10;
    this.scene.add(this.glare);

    const earthMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth.jpg`, () => this.onChange?.());
    earthMap.colorSpace = THREE.SRGBColorSpace;
    earthMap.anisotropy = 4;
    this.earthMat = new THREE.ShaderMaterial({ vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG, uniforms: { map: { value: earthMap }, uSun: light.uSun, uGain: { value: 1 } } });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), this.earthMat);
    this.earth.frustumCulled = false;
    this.scene.add(this.earth);
    // The atmosphere seen edge-on: a thin blue line just outside the limb, on the sunlit side.
    const air = new THREE.Mesh(
      new THREE.SphereGeometry(1.022, 96, 48),
      new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT,
        fragmentShader: `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float edge = pow(1.0 - abs(dot(n, v)), 5.0);
  float day = smoothstep(-0.25, 0.35, dot(n, uSun));
  gl_FragColor = vec4(vec3(0.30, 0.56, 1.0) * edge * day * 2.2, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
        uniforms: { uSun: light.uSun },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    air.frustumCulled = false;
    this.earth.add(air);

    // Stars: the Yale Bright Star Catalogue at the true positions for the site and the moment.
    // They show only when the Sun is hidden, as for a dark-adapted eye or a long exposure.
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uOpacity: { value: 0 }, uGain: { value: 1 }, uDpr: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.matrixAutoUpdate = false;
    this.stars.visible = false;
    this.scene.add(this.stars);
    // The Milky Way: NASA's Deep Star Map (Gaia, Hipparcos and Tycho stars), in the same frame as the catalogue.
    this.galaxyMat = new THREE.ShaderMaterial({
      vertexShader: GALAXY_VERT,
      fragmentShader: GALAXY_FRAG,
      uniforms: { uMap: { value: null }, uFine: { value: null }, uFineOn: { value: 0 }, uOpacity: { value: 0 }, uGain: { value: 1 } },
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.galaxy = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.galaxyMat);
    this.galaxy.frustumCulled = false;
    this.galaxy.matrixAutoUpdate = false;
    this.galaxy.visible = false;
    this.galaxy.renderOrder = -2;
    this.scene.add(this.galaxy);
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/milkyway.jpg`, (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.RepeatWrapping;
      map.generateMipmaps = false;
      map.minFilter = THREE.LinearFilter;
      this.galaxyMat.uniforms.uMap.value = map;
      this.galaxy.visible = true;
      this.onChange?.();
    });
    // The Milky Way at 8192 pixels, brightness only: four times the detail. It is large, so it is fetched after
    // the first picture, and only where the graphics card takes a texture of that size on a screen that shows it.
    const roomy = this.renderer.capabilities.maxTextureSize >= 8192 && window.innerWidth >= 1100 && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) >= 4;
    if (roomy)
      window.setTimeout(() => {
        new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/milkyway-8k.webp`, (fine) => {
          fine.format = THREE.RedFormat;
          fine.colorSpace = THREE.NoColorSpace;
          fine.wrapS = THREE.RepeatWrapping;
          fine.anisotropy = 4;
          this.renderer.initTexture(fine);
          this.galaxyMat.uniforms.uFine.value = fine;
          this.galaxyMat.uniforms.uFineOn.value = 1;
          this.onChange?.();
        });
      }, 9000);
    void fetch(`${import.meta.env.BASE_URL}data/stars.json`)
      .then((r) => r.json() as Promise<{ stars: number[] }>)
      .then((doc) => {
        const count = doc.stars.length / 4;
        // The planets take the last places of the same buffers; they move, so they are filled at each moment.
        const pos = new Float32Array((count + PLANETS) * 3);
        const col = new Float32Array((count + PLANETS) * 3);
        const size = new Float32Array(count + PLANETS);
        const halo = new Float32Array(count + PLANETS);
        this.starCount = count;
        for (let i = 0; i < count; i++) {
          const ra = doc.stars[i * 4] * D2R;
          const dec = doc.stars[i * 4 + 1] * D2R;
          const mag = doc.stars[i * 4 + 2];
          const kelvin = doc.stars[i * 4 + 3];
          // Unit vector in J2000 equatorial coordinates; the object's matrix turns it into the local sky.
          pos.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], i * 3);
          const look = starLook(mag);
          const tint = starTint(kelvin);
          col.set([tint[0] * look.gain, tint[1] * look.gain, tint[2] * look.gain], i * 3);
          size[i] = look.size;
          halo[i] = look.halo;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        starGeo.setAttribute('tint', new THREE.BufferAttribute(col, 3));
        starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
        starGeo.setAttribute('halo', new THREE.BufferAttribute(halo, 1));
        this.stars.visible = true;
        if (this.lastSky) this.setSky(this.lastSky);
        this.onChange?.();
      })
      .catch((err) => console.warn('star catalogue unavailable:', err));

    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(new THREE.ShaderMaterial({ vertexShader: QUAD_VERT.replace('vec4(position.xy, 0.0, 1.0)', 'projectionMatrix * modelViewMatrix * vec4(position, 1.0)'), fragmentShader: CLEAN_FRAG, uniforms: { tDiffuse: { value: null } } })));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.55, 0.7, 2.4);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(new THREE.ShaderMaterial({ vertexShader: QUAD_VERT.replace('vec4(position.xy, 0.0, 1.0)', 'projectionMatrix * modelViewMatrix * vec4(position, 1.0)'), fragmentShader: FINISH_FRAG, uniforms: { tDiffuse: { value: null }, uAspect: { value: 2 }, uSunAt: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 } } }));
    // Tone mapping first, then the vignette and grain in display space.
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.finish);
    this.camera.rotation.order = 'YXZ';

    // Lights for the lander and the rocks (the terrain has its own shading).
    this.camera.layers.enable(PROP_LAYER);
    this.tele.layers.enable(PROP_LAYER);
    this.propCam.layers.set(PROP_LAYER);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The shadows of the vehicles change with the Sun, not with the camera: drawn when needed, not every frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 1024);
    const sc = this.sunLight.shadow.camera;
    sc.left = -95;
    sc.right = 95;
    sc.top = 16;
    sc.bottom = -8;
    sc.near = 1;
    sc.far = 700;
    sc.layers.set(PROP_LAYER);
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight, this.sunLight.target, this.bounce, this.earthLight, this.earthLight.target);
    // What a mirror-like surface sees: black sky above, sunlit ground below.
    const envScene = new THREE.Scene();
    envScene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'varying vec3 vP; void main() { float y = normalize(vP).y; gl_FragColor = vec4(vec3(mix(0.55, 0.0, smoothstep(-0.12, 0.05, y))), 1.0); }',
        }),
      ),
    );
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
  }

  /** Height of the ground (m) at a point east and north of the site, from the terrain grids. */
  groundAt(east: number, north: number): number {
    for (let level = 0; level < TERRAIN_LEVELS; level++) {
      const half = TERRAIN_HALF_M[level];
      if (Math.max(Math.abs(east), Math.abs(north)) >= half * 0.98 && level < TERRAIN_LEVELS - 1) continue;
      const data = this.heightTex[level].image.data as Float32Array;
      const fx = Math.max(0, Math.min(TERRAIN_N - 1.001, ((east / half) * 0.5 + 0.5) * (TERRAIN_N - 1)));
      const fy = Math.max(0, Math.min(TERRAIN_N - 1.001, ((north / half) * 0.5 + 0.5) * (TERRAIN_N - 1)));
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const a = fx - i;
      const b = fy - j;
      const at = (ii: number, jj: number) => data[jj * TERRAIN_N + ii];
      return at(i, j) * (1 - a) * (1 - b) + at(i + 1, j) * a * (1 - b) + at(i, j + 1) * (1 - a) * b + at(i + 1, j + 1) * a * b;
    }
    return 0;
  }

  /**
   * Prepares the picture before it is shown: the programs of every material are compiled without stopping the
   * page, and one frame is drawn so that textures and shadow maps are in place. What follows has nothing new to pay.
   */
  async warm(): Promise<void> {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* compiled at the first frame instead */
    }
    this.render([]);
  }

  /**
   * Height of the ground as it is drawn: the finest grid is a mesh of triangles, and between samples the picture
   * follows those triangles. Things that stand on the ground are placed on this surface, so that what touches in
   * the computation touches in the picture.
   */
  surfaceAt(east: number, north: number): number {
    const half = TERRAIN_HALF_M[0];
    if (Math.max(Math.abs(east), Math.abs(north)) >= half * 0.8) return this.groundAt(east, north);
    const data = this.heightTex[0].image.data as Float32Array;
    const fx = ((east / half) * 0.5 + 0.5) * (TERRAIN_N - 1);
    const fy = ((north / half) * 0.5 + 0.5) * (TERRAIN_N - 1);
    return triangleHeight((i, j) => data[j * TERRAIN_N + i], fx, fy);
  }

  /**
   * Places the rocks and the vehicle. Safe to call again with the same arguments.
   * @param key        identifies the arrangement (site and mast height)
   * @param vehicleAz  azimuth at which the lander stands, degrees
   */
  async setProps(key: string, seed: number, vehicleAz: number, vehicleKind: 'rover' | 'apollo' | 'mast' | 'none', mastM: number): Promise<void> {
    if (key === this.propsKey) return;
    this.propsKey = key;
    try {
      const made = await createProps((e, n) => this.surfaceAt(e, n), seed, vehicleAz, vehicleKind, mastM);
      if (this.propsKey !== key) {
        made.dispose();
        return;
      }
      if (this.props) {
        this.scene.remove(this.props.group);
        this.props.dispose();
      }
      this.props = made;
      // No invented crater or boulder under a wheel or a footpad: the ground there is drawn as the data gives it.
      this.propUniforms.uStand.value.forEach((v, i) => {
        const at = made.stands[i];
        if (at) v.set(at.e, at.n, at.r);
        else v.set(0, 0, 0);
      });
      this.scene.add(made.group);
      this.propsDirty = true;
      if (this.lastSky) this.setSky(this.lastSky);
      this.onChange?.();
    } catch (err) {
      console.warn('3D props unavailable:', err);
    }
  }

  private renderPropShadows(): void {
    // An orthographic view from the Sun: wide, low and long, because the light is nearly horizontal.
    this.propCam.position.copy(this.sunDir).multiplyScalar(300).add(this.camera.position);
    this.propCam.up.set(0, 1, 0);
    this.propCam.lookAt(this.camera.position);
    this.propCam.updateMatrixWorld();
    this.propCam.updateProjectionMatrix();
    this.propUniforms.uPropMatrix.value.multiplyMatrices(this.propCam.projectionMatrix, this.propCam.matrixWorldInverse);
    const r = this.renderer;
    const clear = new THREE.Color();
    r.getClearColor(clear);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.propTarget);
    r.setClearColor(0xffffff, 1);
    r.clear();
    this.scene.overrideMaterial = this.propDepth;
    r.render(this.scene, this.propCam);
    this.scene.overrideMaterial = null;
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    this.propUniforms.uPropOn.value = this.props ? 1 : 0;
    this.propsDirty = false;
    r.shadowMap.needsUpdate = true;
    this.version++;
  }

  /** Called when something loaded asynchronously and the picture should be redrawn. */
  onChange: (() => void) | null = null;

  /**
   * @param tiles    the four grids of public/data/terrain/<id>.bin, or null for a smooth sphere
   * @param fineReal true when the finest grid comes from a 5 m site model (and not from the 80 m one)
   * @param profile  horizon elevation in degrees per azimuth step, for the current observer height
   * @param distKm   distance of the terrain point that sets the horizon, same indexing; null for a sphere
   */
  setTerrain(tiles: Int16Array | null, fineReal: boolean, profile: ArrayLike<number> | null, distKm: ArrayLike<number> | null, stepDeg: number, eyeM: number): void {
    const n2 = TERRAIN_N * TERRAIN_N;
    this.fine.value = fineReal ? 1 : 0;
    for (let level = 0; level < TERRAIN_LEVELS; level++) {
      const data = this.heightTex[level].image.data as Float32Array;
      if (tiles) {
        const unit = TERRAIN_UNIT_M[level];
        for (let i = 0; i < n2; i++) data[i] = tiles[level * n2 + i] * unit;
      } else {
        // Smooth sphere: only the curvature of the Moon.
        const spacing = (TERRAIN_HALF_M[level] * 2) / (TERRAIN_N - 1);
        for (let j = 0; j < TERRAIN_N; j++) {
          for (let i = 0; i < TERRAIN_N; i++) {
            const x = (i - 128) * spacing;
            const y = (j - 128) * spacing;
            data[j * TERRAIN_N + i] = 1737400 * (Math.cos(Math.hypot(x, y) / 1737400) - 1);
          }
        }
      }
      this.heightTex[level].needsUpdate = true;
    }
    this.eye = this.eyeGoal = Math.max(EYE_MIN_M, eyeM);
    this.mastShown = this.mastGoal = eyeM;
    this.camera.position.set(0, this.eye, 0);
    this.buildSkyline(profile, distKm, stepDeg);
    this.shadowsDirty = true;
  }

  /**
   * The same place seen from another height: the far skyline of that height is drawn, and the eye and the mast
   * travel to it over the next frames (see `step`). Nothing else is rebuilt.
   */
  setEye(profile: ArrayLike<number> | null, distKm: ArrayLike<number> | null, stepDeg: number, eyeM: number): void {
    this.eyeGoal = Math.max(EYE_MIN_M, eyeM);
    this.mastGoal = eyeM;
    this.buildSkyline(profile, distKm, stepDeg);
  }

  /** Moves the eye and the mast towards their heights. Returns true while something is still moving. */
  step(dt: number): boolean {
    let moving = false;
    const dEye = this.eyeGoal - this.eye;
    const dMast = this.mastGoal - this.mastShown;
    if (Math.abs(dEye) < 0.002 && Math.abs(dMast) < 0.002) {
      if (dEye !== 0 || dMast !== 0) {
        this.eye = this.eyeGoal;
        this.mastShown = this.mastGoal;
        this.placeEye();
      }
    } else {
      // Quick to start, soft to arrive.
      const k = 1 - Math.exp(-dt * 3.2);
      this.eye += dEye * k;
      this.mastShown += dMast * k;
      this.placeEye();
      moving = true;
    }
    // The camera adapts to the light as an eye does: over a second or so, never in one frame.
    if (Math.abs(this.exposureGoal - this.exposureNow) > 0.004 || Math.abs(this.darkGoal - this.darkNow) > 0.004) {
      this.adapt(1 - Math.exp(-dt * 2.6));
      this.version++;
      moving = true;
    }
    return moving;
  }

  private exposureGoal = 1;
  private exposureNow = 1;
  private darkGoal = 0;
  private darkNow = 0;
  private adapted = false;
  /** Share of the Sun's disc the eye sees over the drawn terrain, from where it stands now. */
  private sunVisible = 1;

  /** Moves the exposure and the night sky a step towards what the light asks for (k = 1: all the way). */
  private adapt(k: number): void {
    this.exposureNow += (this.exposureGoal - this.exposureNow) * k;
    this.darkNow += (this.darkGoal - this.darkNow) * k;
    this.renderer.toneMappingExposure = this.exposureNow;
    this.earthMat.uniforms.uGain.value = 1 / Math.sqrt(this.exposureNow);
    // Stars and Milky Way show only when the Sun is hidden, as for a dark-adapted eye or a long exposure;
    // their brightness does not follow the exposure, or every star would burn to the same white.
    this.starMat.uniforms.uOpacity.value = this.darkNow;
    this.starMat.uniforms.uGain.value = 4.0 / this.exposureNow;
    this.galaxyMat.uniforms.uOpacity.value = this.darkNow * this.darkNow;
    this.galaxyMat.uniforms.uGain.value = 1.5 / this.exposureNow;
  }

  /** Elevation, degrees, of the highest terrain the eye sees in a direction: the skyline of the picture itself. */
  private skylineAt(azDeg: number): number {
    const sin = Math.sin(azDeg * D2R);
    const cos = Math.cos(azDeg * D2R);
    let best = -90;
    // 2 m steps near the eye, 2% of the distance further out, as far as the terrain goes
    for (let d = 3; d < 300000; d += Math.max(2, d * 0.02)) {
      const el = Math.atan2((d < 500 ? this.surfaceAt(sin * d, cos * d) : this.groundAt(sin * d, cos * d)) - this.eye, d) / D2R;
      if (el > best) best = el;
    }
    return best;
  }

  /**
   * Share of the Sun's disc that clears the terrain as it is drawn, seen from the eye. The light, the exposure and
   * the stars of the picture follow this, so the picture always shows what a camera at that height would see;
   * the figures beside it are the planner's, for the antenna height that was chosen.
   */
  private sunSeen(s: SceneSky): number {
    const COLUMNS = 9;
    let seen = 0;
    let total = 0;
    for (let c = 0; c < COLUMNS; c++) {
      const u = ((c + 0.5) / COLUMNS) * 2 - 1;
      const chord = Math.sqrt(1 - u * u);
      const skyline = this.skylineAt(s.sunAz + (u * s.sunRadius) / Math.max(0.05, Math.cos(s.sunEl * D2R)));
      const top = s.sunEl + chord * s.sunRadius;
      seen += Math.max(0, Math.min(1, (top - skyline) / (2 * chord * s.sunRadius))) * chord;
      total += chord;
    }
    return total ? seen / total : 0;
  }

  private placeEye(): void {
    this.camera.position.set(0, this.eye, 0);
    if (this.skyline) this.skyline.position.y = this.eye;
    this.props?.mast?.setHeight(this.mastShown);
    if (this.lastSky) this.setSky(this.lastSky);
  }

  /** The far skyline of the horizon profile, as a thin band; its heights are relative to the eye. */
  private buildSkyline(profile: ArrayLike<number> | null, distKm: ArrayLike<number> | null, stepDeg: number): void {
    if (this.skyline) {
      this.scene.remove(this.skyline);
      this.skyline.geometry.dispose();
      this.skyline = null;
    }
    if (profile && distKm) {
      const count = profile.length;
      const verts = new Float32Array(count * 6);
      const d = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        const dist = Math.max(60, distKm[i] * 1000) * 1.004;
        direction(i * stepDeg, profile[i], d);
        const range = dist / Math.max(0.2, Math.cos(profile[i] * D2R));
        const lower = direction(i * stepDeg, profile[i] - 0.45, new THREE.Vector3()).multiplyScalar(range);
        // Where the skyline is set by ground a short way off, the terrain that is drawn is that skyline, seen from
        // wherever the eye stands; a band drawn for one height would float over it from another.
        if (distKm[i] < 1.5) verts.set([d.x * range, d.y * range, d.z * range, d.x * range, d.y * range, d.z * range], i * 6);
        else verts.set([d.x * range, d.y * range, d.z * range, lower.x, lower.y, lower.z], i * 6);
      }
      const index: number[] = [];
      for (let i = 0; i < count; i++) {
        const a = i * 2;
        const b = ((i + 1) % count) * 2;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(index);
      this.skyline = new THREE.Mesh(geo, this.skylineMat);
      this.skyline.frustumCulled = false;
      this.skyline.position.y = this.eye;
      this.scene.add(this.skyline);
    }
    this.shadowsDirty = true;
  }

  setSky(s: SceneSky): void {
    this.lastSky = s;
    this.version++;
    direction(s.sunAz, s.sunEl, this.sunDir);
    const power = 1 - s.eclipse;
    // Lander and rocks: the Sun as far as it clears the terrain, light bounced off the sunlit ground, earthshine.
    this.sunVisible = this.sunSeen(s);
    const reach = power * this.sunVisible;
    this.sunLight.position.copy(this.sunDir).multiplyScalar(300).add(this.camera.position);
    this.sunLight.target.position.copy(this.camera.position);
    this.sunLight.intensity = 7.5 * reach;
    this.bounce.intensity = 0.22 * reach + 0.01;
    const earthDir = direction(s.earthAz, s.earthEl, new THREE.Vector3());
    this.earthLight.position.copy(earthDir).multiplyScalar(300).add(this.camera.position);
    this.earthLight.target.position.copy(this.camera.position);
    this.earthLight.intensity = s.earthEl > -1 ? 0.035 : 0;
    this.scene.environmentIntensity = 0.03 + 0.3 * reach;
    this.props?.mast?.update(Math.atan2(this.sunDir.x, this.sunDir.z), earthDir, reach, s.linked);
    this.propsDirty = true;
    for (const m of this.terrainMats) {
      m.uniforms.uSunPower.value = power;
      direction(s.earthAz, s.earthEl, m.uniforms.uEarth.value as THREE.Vector3);
      m.uniforms.uEarthshine.value = s.earthEl > -1 ? 0.012 : 0.002;
    }
    this.skylineMat.uniforms.uSunPower.value = power;
    if (this.sunDir.angleTo(this.shadowSun) > 0.00012) this.shadowsDirty = true;

    this.sun.position.copy(this.sunDir).multiplyScalar(SKY_M * 0.96).add(this.camera.position);
    this.sun.scale.setScalar(SKY_M * 0.96 * Math.tan(s.sunRadius * D2R));
    this.sun.lookAt(this.camera.position);
    this.sun.visible = power > 0.001;
    this.glare.position.copy(this.sun.position);
    const visible = this.sunVisible;
    this.glare.scale.setScalar(SKY_M * 0.96 * Math.tan(4.5 * D2R) * 2 * (0.55 + 0.45 * visible));
    (this.glare.material as THREE.SpriteMaterial).userData.base = Math.min(1, visible * 1.4) * 0.8;
    this.glare.visible = visible > 0.002;

    const e = direction(s.earthAz, s.earthEl, new THREE.Vector3());
    this.earth.position.copy(e).multiplyScalar(SKY_M * 0.9).add(this.camera.position);
    this.earth.scale.setScalar(SKY_M * 0.9 * Math.tan(s.earthRadius * D2R));
    // Texture: Greenwich meridian on +X of the sphere, north on +Y.
    const toScene = (v: [number, number, number]) => new THREE.Vector3(v[0], v[2], -v[1]);
    const y = toScene(s.earthNorth).normalize();
    const x = toScene(s.earthGreenwich).normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    this.earth.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));

    // Exposure opens up when the Sun is hidden, as a camera (or an eye) would, so that earthshine shows.
    this.exposureGoal = 1.0 + 5.0 * Math.pow(1 - Math.min(1, visible * power), 3);
    this.darkGoal = Math.max(0, 1 - visible * power * 6);
    // The first picture, and every frame of a recording, are fully adapted; otherwise the change is gradual (see `step`).
    this.adapt(!this.adapted || (globalThis as { __lwPreserve?: boolean }).__lwPreserve ? 1 : 0);
    this.adapted = true;
    const planets = s.starAxes.planets;
    if (planets && this.starCount) {
      const g = this.stars.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const tint = g.getAttribute('tint') as THREE.BufferAttribute;
      const size = g.getAttribute('size') as THREE.BufferAttribute;
      const halo = g.getAttribute('halo') as THREE.BufferAttribute;
      planets.slice(0, PLANETS).forEach((p, i) => {
        const at = this.starCount + i;
        const look = starLook(p.mag);
        const c = PLANET_TINT[p.name] ?? [1, 1, 1];
        pos.setXYZ(at, p.dir[0], p.dir[1], p.dir[2]);
        tint.setXYZ(at, c[0] * look.gain, c[1] * look.gain, c[2] * look.gain);
        size.setX(at, look.size);
        halo.setX(at, look.halo);
      });
      pos.needsUpdate = tint.needsUpdate = size.needsUpdate = halo.needsUpdate = true;
    }
    // J2000 direction -> scene (x east, y up, z south), scaled out to the sky and centred on the camera.
    const ax = s.starAxes;
    const k = SKY_M * 0.985;
    this.stars.matrix.set(
      ax.east[0] * k, ax.east[1] * k, ax.east[2] * k, this.camera.position.x,
      ax.up[0] * k, ax.up[1] * k, ax.up[2] * k, this.camera.position.y,
      -ax.north[0] * k, -ax.north[1] * k, -ax.north[2] * k, this.camera.position.z,
      0, 0, 0, 1,
    );
    this.stars.matrixWorldNeedsUpdate = true;
    this.galaxy.matrix.copy(this.stars.matrix);
    this.galaxy.matrixWorldNeedsUpdate = true;
  }

  /** Share of the full resolution to draw at: lowered on slow graphics to keep the motion fluid. */
  quality = 1;

  resize(width: number, height: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.quality;
    this.renderer.setPixelRatio(dpr);
    this.starMat.uniforms.uDpr.value = dpr;
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    (this.finish.material as THREE.ShaderMaterial).uniforms.uAspect.value = width / height;
  }

  private renderShadows(): void {
    this.shadowSun.copy(this.sunDir);
    const starts = [2.4, 22, 180, 1100];
    for (let level = 0; level < TERRAIN_LEVELS; level++) {
      this.shadowMat.uniforms.uHalfLevel.value = TERRAIN_HALF_M[level];
      this.shadowMat.uniforms.uStart.value = starts[level];
      this.renderer.setRenderTarget(this.shadowTargets[level]);
      this.renderer.render(this.shadowScene, this.shadowCamera);
    }
    this.renderer.setRenderTarget(null);
    this.shadowsDirty = false;
    this.version++;
  }

  /**
   * @param insets  telephoto windows drawn over the picture: position in CSS pixels from the top left
   *                of the canvas, and the direction and field of view (degrees) of each lens
   */
  render(insets: { x: number; y: number; size: number; az: number; el: number; fov: number }[] = []): void {
    if (this.shadowsDirty) this.renderShadows();
    if (this.propsDirty) this.renderPropShadows();
    const now = performance.now();
    // A model or a texture may arrive late: the shadow map is also refreshed once a second.
    if (now - this.shadowMapAt > 1000) this.renderer.shadowMap.needsUpdate = true;
    if (this.renderer.shadowMap.needsUpdate) this.shadowMapAt = now;
    this.props?.mast?.animate();
    this.camera.fov = this.look.fov;
    this.camera.rotation.set(this.look.pitch * D2R, -this.look.az * D2R, 0);
    this.camera.updateProjectionMatrix();
    // Where the Sun falls on the picture, for the lens flare; it fades as the Sun leaves the frame or the terrain covers it.
    const fu = (this.finish.material as THREE.ShaderMaterial).uniforms;
    const at = this.lastSky ? this.project(this.lastSky.sunAz, this.lastSky.sunEl) : null;
    // Through a long lens the Sun is shot as it would be with a solar filter: a clean disc against the
    // ridge, without the glare and flare that would wash the frame out.
    const long = 1 - Math.max(0, Math.min(1, (this.look.fov - 8) / 20));
    if (at && this.lastSky) {
      (fu.uSunAt.value as THREE.Vector2).set(at.x, 1 - at.y);
      const off = Math.max(Math.abs(at.x - 0.5), Math.abs(at.y - 0.5));
      fu.uSunVis.value = this.sunVisible * (1 - this.lastSky.eclipse) * Math.max(0, Math.min(1, (0.62 - off) / 0.14)) * (1 - long);
    } else fu.uSunVis.value = 0;
    this.sunMat.uniforms.uGain.value = 60 + (2.4 - 60) * long;
    this.bloom.strength = 0.55 * (1 - 0.8 * long);
    const glareMat = this.glare.material as THREE.SpriteMaterial;
    const glareBase = glareMat.userData.base as number | undefined;
    if (glareBase !== undefined) glareMat.opacity = glareBase * (1 - long);
    this.composer.render();
    const count = Math.min(insets.length, this.teleShots.length);
    if (!count) return;
    const r = this.renderer;
    const height = r.domElement.clientHeight;

    // Which windows show something that changed since they were drawn. One is redrawn per frame, the one
    // waiting longest first, so a flowing clock costs one extra view per frame rather than two; a window
    // never drawn is drawn at once, and all are refreshed twice a second for the small animations.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let due = -1;
    for (let i = 0; i < count; i++) {
      const inset = insets[i];
      const shot = this.teleShots[i];
      const px = Math.max(8, Math.round(inset.size * dpr));
      if (shot.target.width !== px) {
        shot.target.setSize(px, px);
        shot.key = '';
      }
      const key = `${this.version}|${inset.az.toFixed(4)}|${inset.el.toFixed(4)}|${inset.fov}`;
      const changed = shot.key !== key || now - shot.at > 500;
      if (!changed) continue;
      if (!shot.key) this.drawTele(i, inset, key, now);
      else if (due < 0 || shot.at < this.teleShots[due].at) due = i;
    }
    if (due >= 0) this.drawTele(due, insets[due], `${this.version}|${insets[due].az.toFixed(4)}|${insets[due].el.toFixed(4)}|${insets[due].fov}`, now);

    // Put the pictures on the screen, through the same tone curve as the main view.
    const exposure = r.toneMappingExposure;
    r.toneMappingExposure = Math.min(exposure, 1.6);
    r.autoClear = false;
    for (let i = 0; i < count; i++) {
      const inset = insets[i];
      r.setViewport(inset.x, height - inset.y - inset.size, inset.size, inset.size);
      r.render(this.teleShots[i].scene, this.flat);
    }
    r.setViewport(0, 0, r.domElement.clientWidth, height);
    r.autoClear = true;
    r.toneMappingExposure = exposure;
  }

  /** Draws one telephoto window into its own picture: the Sun as through a filter, without glare. */
  private drawTele(i: number, inset: { az: number; el: number; fov: number }, key: string, now: number): void {
    const r = this.renderer;
    const shot = this.teleShots[i];
    const glareWas = this.glare.visible;
    const gainWas = this.sunMat.uniforms.uGain.value as number;
    this.glare.visible = false;
    this.sunMat.uniforms.uGain.value = 2.2;
    this.tele.fov = inset.fov;
    this.tele.position.copy(this.camera.position);
    this.tele.lookAt(direction(inset.az, inset.el, new THREE.Vector3()).multiplyScalar(1000).add(this.camera.position));
    this.tele.updateProjectionMatrix();
    r.setRenderTarget(shot.target);
    r.render(this.scene, this.tele);
    r.setRenderTarget(null);
    this.glare.visible = glareWas;
    this.sunMat.uniforms.uGain.value = gainWas;
    shot.key = key;
    shot.at = now;
  }

  /** 0 to 1: how much of the night sky shows (none while the Sun is up). */
  get starLevel(): number {
    return this.stars.visible ? (this.starMat.uniforms.uOpacity.value as number) : 0;
  }

  /** Screen position (0 to 1, origin top left) of a direction, or null when it is behind the camera. */
  project(az: number, el: number): { x: number; y: number } | null {
    const v = direction(az, el, new THREE.Vector3()).multiplyScalar(1000).add(this.camera.position);
    this.camera.updateMatrixWorld();
    v.project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  dispose(): void {
    this.renderer.dispose();
    for (const t of this.heightTex) t.dispose();
    for (const t of this.shadowTargets) t.dispose();
    this.propTarget.dispose();
    for (const s of this.teleShots) s.target.dispose();
    this.props?.dispose();
  }
}
