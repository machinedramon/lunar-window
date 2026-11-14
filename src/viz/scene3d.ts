// First-person 3D view from the landing site.
//
// What is real: the terrain (NASA LOLA elevation, three nested grids with the curvature of the
// Moon built in), the skyline (the same horizon profile the planner uses), the directions and
// angular sizes of the Sun and the Earth, the phase and the face of the Earth, and the shadows
// (marched through the elevation data towards the Sun, with the penumbra of a 0.53 degree disc).
// What is illustrative: surface relief finer than the 50 m grid, the clouds on the Earth and
// the stars.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
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
}

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
      float taper = size * (1.0 - 0.55 * clamp(along / reach, 0.0, 1.0));
      float inShadow = smoothstep(0.0, size * 0.5, along) * (1.0 - smoothstep(reach * 0.82, reach, along)) * (1.0 - smoothstep(taper * 0.7, taper, across));
      lit *= 1.0 - weight * inShadow;
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
float shadowAt(vec2 p) {
  float m = max(abs(p.x), abs(p.y));
  float s = texS(tS3, clamp(p, -HALF.w, HALF.w), HALF.w);
  if (m < HALF.z) {
    s = mix(texS(tS2, p, HALF.z), s, blendAt(m, HALF.z));
    if (m < HALF.y) {
      s = mix(texS(tS1, p, HALF.y), s, blendAt(m, HALF.y));
      if (m < HALF.x) s = mix(texS(tS0, p, HALF.x), s, blendAt(m, HALF.x));
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
      if (m < HALF.x) slope = mix(slopeOf(tH0, p, HALF.x, max(4.0, 1.5 * footprint)), slope, blendAt(m, HALF.x));
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
  // With a 5 m model the real craters down to about 15 m are in the geometry; only smaller ones are invented.
  float cell = m < HALF.x * 0.9 ? mix(46.0, 9.0, uFine) : 46.0;
  // Share of a bowl that its own rim shadows, for craters too small to resolve at this distance.
  float hidden = clamp(1.0 - 6.0 * max(tanSun, 0.0), 0.0, 1.0);
  for (int o = 0; o < 6; o++) {
    float density = o < 2 ? 0.2 : 0.36;
    float w = smoothstep(0.42 * cell, 0.12 * cell, footprint);
    if (w > 0.002) craters(p, cell, density, w, tanSun, sunDir, micro, craterLit);
    craterLit *= 1.0 - (1.0 - w) * 0.05 * hidden;
    cell *= 0.4;
  }
  float block = 30.0;
  for (int o = 0; o < 4; o++) {
    float w = smoothstep(0.03 * block, 0.008 * block, footprint);
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
      vec2 texel = vec2(1.0 / 2048.0, 1.0 / 512.0);
      float lit = 0.0;
      lit += step(q.z - 0.00016, unpackRGBAToDepth(texture2D(tProp, q.xy)));
      lit += step(q.z - 0.00016, unpackRGBAToDepth(texture2D(tProp, q.xy + texel * vec2(0.8, 0.8))));
      lit += step(q.z - 0.00016, unpackRGBAToDepth(texture2D(tProp, q.xy + texel * vec2(-0.8, 0.8))));
      lit += step(q.z - 0.00016, unpackRGBAToDepth(texture2D(tProp, q.xy + texel * vec2(0.8, -0.8))));
      lit += step(q.z - 0.00016, unpackRGBAToDepth(texture2D(tProp, q.xy + texel * vec2(-0.8, -0.8))));
      shadow *= lit / 5.0;
    }
  }

  float albedo = 0.125 * (1.0 + albedoNoise);
  vec3 col = vec3(albedo) * (7.5 * direct * phase * shadow * uSunPower);
  col += vec3(0.80, 0.88, 1.0) * albedo * uEarthshine * (0.35 + 0.65 * max(dot(n, uEarth), 0.0));
  col += vec3(albedo) * 0.012 * uSunPower;
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
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

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
float ghost(vec2 uv, vec2 at, float radius, float ring) {
  float r = length((uv - at) * vec2(uAspect, 1.0)) / radius;
  float disc = smoothstep(1.0, 0.82, r);
  return disc * mix(1.0, smoothstep(0.55, 1.0, r), ring);
}
// What a real lens does with a point as bright as the Sun: diffraction spikes from the
// aperture blades, a horizontal streak, and faint reflections between the glass elements.
vec3 flare(vec2 uv) {
  vec2 d = (uv - uSunAt) * vec2(uAspect, 1.0);
  float r = length(d);
  float a = atan(d.y, d.x);
  float spikes = 0.6 * pow(abs(cos(a * 4.0 + 0.35)), 70.0) + 0.3 * pow(abs(cos(a * 3.0 - 0.6)), 110.0);
  float star = spikes * smoothstep(0.5, 0.0, r) / (1.0 + r * 26.0);
  float streak = exp(-abs(d.y) * 190.0) * smoothstep(0.9, 0.0, abs(d.x)) * 0.2;
  vec2 axis = vec2(0.5) - uSunAt;
  vec3 g = vec3(0.0);
  g += vec3(0.80, 0.90, 1.00) * ghost(uv, uSunAt + axis * 0.62, 0.030, 0.0) * 0.050;
  g += vec3(1.00, 0.96, 0.88) * ghost(uv, uSunAt + axis * 1.18, 0.018, 0.0) * 0.060;
  g += vec3(0.78, 0.88, 1.00) * ghost(uv, uSunAt + axis * 1.55, 0.070, 1.0) * 0.040;
  g += vec3(0.92, 0.95, 1.00) * ghost(uv, uSunAt + axis * 1.90, 0.036, 0.0) * 0.035;
  g += vec3(0.75, 0.86, 1.00) * ghost(uv, uSunAt + axis * 2.35, 0.120, 1.0) * 0.028;
  return (vec3(star + streak) + g) * uSunVis;
}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(1.05, 0.25, length(d));
  c.rgb *= mix(0.72, 1.0, vig);
  if (uSunVis > 0.001) c.rgb += flare(vUv);
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
  private readonly camera = new THREE.PerspectiveCamera(45, 2, 0.4, FAR_M);
  private readonly tele = new THREE.PerspectiveCamera(5, 1, 0.4, FAR_M);
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
  private readonly propUniforms = { tProp: { value: null as THREE.Texture | null }, uPropMatrix: { value: new THREE.Matrix4() }, uPropOn: { value: 0 } };
  private props: Props | null = null;
  private propsKey = '';
  private propsDirty = false;
  private lastSky: SceneSky | null = null;
  /** Seconds since the scene started: drives the small animations (beacon, radio link). */
  clock = 0;
  private eye = 2;
  /** Where the camera looks: azimuth and pitch in degrees, vertical field of view in degrees. */
  look = { az: 0, pitch: 4, fov: 46 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
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
    this.earthMat = new THREE.ShaderMaterial({ vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG, uniforms: { map: { value: earthMap }, uSun: light.uSun } });
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

    // Stars: illustrative, and only visible when the Sun is hidden, as for a dark-adapted eye.
    const count = 2600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(a) * SKY_M, z * SKY_M, r * Math.sin(a) * SKY_M], i * 3);
      const b = 0.25 + 0.75 * Math.pow(rnd(), 5);
      col.set([b, b, b * (0.92 + 0.16 * rnd())], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
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
   * Places the rocks and the vehicle. Safe to call again with the same arguments.
   * @param key        identifies the arrangement (site and mast height)
   * @param vehicleAz  azimuth at which the lander stands, degrees
   */
  async setProps(key: string, seed: number, vehicleAz: number, apollo: boolean, mastM: number): Promise<void> {
    if (key === this.propsKey) return;
    this.propsKey = key;
    try {
      const made = await createProps((e, n) => this.groundAt(e, n), seed, vehicleAz, apollo, mastM);
      if (this.propsKey !== key) {
        made.dispose();
        return;
      }
      if (this.props) {
        this.scene.remove(this.props.group);
        this.props.dispose();
      }
      this.props = made;
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
    this.eye = Math.max(1.6, eyeM);
    this.camera.position.set(0, this.eye, 0);

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
        verts.set([d.x * range, this.eye + d.y * range, d.z * range, lower.x, this.eye + lower.y, lower.z], i * 6);
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
      this.scene.add(this.skyline);
    }
    this.shadowsDirty = true;
  }

  setSky(s: SceneSky): void {
    this.lastSky = s;
    direction(s.sunAz, s.sunEl, this.sunDir);
    const power = 1 - s.eclipse;
    // Lander and rocks: the Sun as far as it clears the terrain, light bounced off the sunlit ground, earthshine.
    const reach = power * s.sunFrac;
    this.sunLight.position.copy(this.sunDir).multiplyScalar(300).add(this.camera.position);
    this.sunLight.target.position.copy(this.camera.position);
    this.sunLight.intensity = 7.5 * reach;
    this.bounce.intensity = 0.22 * reach + 0.01;
    const earthDir = direction(s.earthAz, s.earthEl, new THREE.Vector3());
    this.earthLight.position.copy(earthDir).multiplyScalar(300).add(this.camera.position);
    this.earthLight.target.position.copy(this.camera.position);
    this.earthLight.intensity = s.earthEl > -1 ? 0.035 : 0;
    this.scene.environmentIntensity = 0.03 + 0.3 * reach;
    this.props?.mast?.update(Math.atan2(this.sunDir.x, this.sunDir.z), earthDir, reach, s.linked, this.clock);
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
    const visible = s.sunFrac;
    this.glare.scale.setScalar(SKY_M * 0.96 * Math.tan(4.5 * D2R) * 2 * (0.55 + 0.45 * visible));
    (this.glare.material as THREE.SpriteMaterial).opacity = Math.min(1, visible * 1.4) * 0.8;
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
    this.renderer.toneMappingExposure = 1.0 + 5.0 * Math.pow(1 - Math.min(1, visible * power), 3);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - visible * 6) * 0.9;
    this.stars.position.copy(this.camera.position);
  }

  /** Share of the full resolution to draw at: lowered on slow graphics to keep the motion fluid. */
  quality = 1;

  resize(width: number, height: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.quality;
    this.renderer.setPixelRatio(dpr);
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
  }

  /**
   * @param insets  telephoto windows drawn over the picture: position in CSS pixels from the top left
   *                of the canvas, and the direction and field of view (degrees) of each lens
   */
  render(insets: { x: number; y: number; size: number; az: number; el: number; fov: number }[] = []): void {
    if (this.shadowsDirty) this.renderShadows();
    if (this.propsDirty) this.renderPropShadows();
    this.camera.fov = this.look.fov;
    this.camera.rotation.set(this.look.pitch * D2R, -this.look.az * D2R, 0);
    this.camera.updateProjectionMatrix();
    // Where the Sun falls on the picture, for the lens flare; it fades as the Sun leaves the frame or the terrain covers it.
    const fu = (this.finish.material as THREE.ShaderMaterial).uniforms;
    const at = this.lastSky ? this.project(this.lastSky.sunAz, this.lastSky.sunEl) : null;
    if (at && this.lastSky) {
      (fu.uSunAt.value as THREE.Vector2).set(at.x, 1 - at.y);
      const off = Math.max(Math.abs(at.x - 0.5), Math.abs(at.y - 0.5));
      fu.uSunVis.value = this.lastSky.sunFrac * (1 - this.lastSky.eclipse) * Math.max(0, Math.min(1, (0.62 - off) / 0.14));
    } else fu.uSunVis.value = 0;
    this.composer.render();
    if (!insets.length) return;
    const r = this.renderer;
    const height = r.domElement.clientHeight;
    const glareWas = this.glare.visible;
    this.glare.visible = false;
    this.sunMat.uniforms.uGain.value = 2.2;
    const exposure = r.toneMappingExposure;
    r.toneMappingExposure = Math.min(exposure, 1.6);
    r.autoClear = false;
    r.setScissorTest(true);
    for (const inset of insets) {
      const y = height - inset.y - inset.size;
      r.setViewport(inset.x, y, inset.size, inset.size);
      r.setScissor(inset.x, y, inset.size, inset.size);
      r.clear(true, true, false);
      this.tele.fov = inset.fov;
      this.tele.position.copy(this.camera.position);
      this.tele.lookAt(direction(inset.az, inset.el, new THREE.Vector3()).multiplyScalar(1000).add(this.camera.position));
      this.tele.updateProjectionMatrix();
      r.render(this.scene, this.tele);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.clientWidth, height);
    r.autoClear = true;
    r.toneMappingExposure = exposure;
    this.sunMat.uniforms.uGain.value = 60;
    this.glare.visible = glareWas;
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
    this.props?.dispose();
  }
}
