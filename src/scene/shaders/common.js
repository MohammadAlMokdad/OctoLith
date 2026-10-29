// Shared GLSL snippets.
import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, UnsignedByteType, Vector2 } from 'three';

// Value noise + fbm (cheap, deterministic, no textures).
export const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
`;

// Live detail layers (see blender/scripts/13_detail_textures.py): bakes hold the
// low frequencies, these high-pass textures add grains/specks/cracks.
// colour = bake * 2 * detail, which averages back to the bake with distance.
export const DETAIL_GLSL = /* glsl */ `
  uniform sampler2D uSandDetail, uStoneDetail;
  vec3 sandDetail(vec2 p) {
    vec3 a = texture2D(uSandDetail, p / 1.6).rgb;
    vec3 b = texture2D(uSandDetail, mat2(0.8, -0.6, 0.6, 0.8) * p / 2.6 + vec2(0.37, 0.61)).rgb;
    return mix(a, b, smoothstep(0.35, 0.65, vnoise(p * 0.08))) * 2.0;
  }
  vec3 stoneDetail(vec3 pos, vec3 nrm, float rnd) {
    vec3 w = pow(abs(nrm), vec3(4.0));
    w /= dot(w, vec3(1.0));
    vec3 q = pos / 0.9 + vec3(13.7, 7.1, 3.3) * rnd;
    return (texture2D(uStoneDetail, q.zy).rgb * w.x + texture2D(uStoneDetail, q.xz).rgb * w.y
          + texture2D(uStoneDetail, q.xy).rgb * w.z) * 2.0;
  }
`;

// Per-block motion written by BlockMotion: 3 texels per block, read by _blockid.
//   0: rotation quaternion   1: (push, travel, -, -)   2: (centroid xyz, -)
// push drives the shading; travel = push * cfg.blocks.travel is how far the
// block has moved out along its centroid (igloo: centroid * (1 + push)).
// blockMove() takes a rest-space point of a block to where the block is now:
// rotated about its centroid, then moved out.
export const BLOCK_GLSL = /* glsl */ `
  uniform highp sampler2D uBlockState;
  vec4 blockTexel(float id, int k) {
    int i = int(id + 0.5) * 3 + k;
    int w = textureSize(uBlockState, 0).x;
    return texelFetch(uBlockState, ivec2(i % w, i / w), 0);
  }
  vec3 quatRotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  vec3 blockMove(vec3 p, float id) {
    vec4 q = blockTexel(id, 0);
    vec3 c = blockTexel(id, 2).xyz;
    return c * (1.0 + blockTexel(id, 1).y) + quatRotate(q, p - c);
  }
`;

// Phase E reveal mask: quantised cells + fbm give a stepped, irregular blob that
// grows from the pyramid. Returns the signed distance behind the front
// (> 0 revealed). Uses world xz.
// uRevealDone = 1 once the front has passed everything: skips the fbm per pixel.
export const REVEAL_GLSL = /* glsl */ `
  uniform float uReveal, uCellSize, uNoiseAmt, uNoiseScale, uBandWidth, uPop, uRevealDone;
  float revealBehind(vec2 xz) {
    if (uRevealDone > 0.5) return 1e4;
    vec2 cell = (floor(xz / uCellSize) + 0.5) * uCellSize;
    float m = length(cell) + fbm(cell * uNoiseScale) * uNoiseAmt;
    return uReveal - m;
  }
`;

// Low dust blowing over the desert (SandWind sets these; shared by every
// material that includes HAZE_GLSL). It is applied by the world's own
// materials (terrain, distant pyramids, sky, the sand drift), never
// the hero pyramid, so the pyramid's colours stay exactly as they are.
export const HAZE_UNIFORMS = {
  uHazeNoise: { value: null }, // hazeNoiseTexture(), set by SandWind
  uHazeTime: { value: 0 },
  uHazeOn: { value: 0 }, // 0..1, follows the sand's intensity
  uHazeDensity: { value: 0 },
  uHazeHeight: { value: 1.4 },
  uHazeSpeed: { value: 4.5 },
  uHazeWind: { value: new Vector2(1, 0) },
  uHazeColor: { value: new Color() },
};

// The haze's fbm, precomputed: the same 4-octave value noise as fbm() in
// NOISE_GLSL, but periodic over HAZE_TILE noise units so it tiles (~355 m
// downwind, ~270 m across at the haze's scale). Evaluating fbm() per pixel
// cost ~100 hash/sin calls (half the frame on integrated GPUs); this is 3
// texture reads per hazePatches().
const HAZE_TILE = 16;
let hazeNoise = null;
export function hazeNoiseTexture(size = 512) {
  if (hazeNoise) return hazeNoise;
  const hash = (x, y, o) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(o + 1, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      let a = 0.5;
      for (let o = 0; o < 4; o++) {
        const period = HAZE_TILE << o; // integer lattice period per octave -> seamless
        const x = (i / size) * period + o * 7.31; // per-octave offset: lattices don't line up
        const y = (j / size) * period + o * 3.17;
        const X = Math.floor(x);
        const Y = Math.floor(y);
        const ux = fade(x - X);
        const uy = fade(y - Y);
        const w = (k) => ((k % period) + period) % period;
        const h00 = hash(w(X), w(Y), o);
        const h10 = hash(w(X + 1), w(Y), o);
        const h01 = hash(w(X), w(Y + 1), o);
        const h11 = hash(w(X + 1), w(Y + 1), o);
        s += a * (h00 + (h10 - h00) * ux + (h01 - h00 + (h11 - h10 - h01 + h00) * ux) * uy);
        a *= 0.5;
      }
      data[j * size + i] = Math.round(s * 255);
    }
  }
  hazeNoise = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  hazeNoise.wrapS = hazeNoise.wrapT = RepeatWrapping;
  hazeNoise.magFilter = LinearFilter;
  hazeNoise.minFilter = LinearMipmapLinearFilter;
  hazeNoise.generateMipmaps = true;
  hazeNoise.needsUpdate = true;
  return hazeNoise;
}

// dustHaze(col, world): the dust between the camera and the surface at
// 'world' (pass a point ~300 m out for the sky). Density falls off with height,
// exp(-y / H), integrated along the line of sight, so it gathers near the
// ground and toward the horizon, in gusty patches drifting downwind.
export const HAZE_GLSL = /* glsl */ `
  uniform sampler2D uHazeNoise;
  uniform float uHazeTime, uHazeOn, uHazeDensity, uHazeHeight, uHazeSpeed;
  uniform vec2 uHazeWind;
  uniform vec3 uHazeColor;
  float hazeFbm(vec2 p) { return texture2D(uHazeNoise, p * ${(1 / HAZE_TILE).toFixed(6)}).r; }
  float hazePatches(vec2 xz, float t) {
    float u = dot(xz, uHazeWind);
    float v = dot(xz, vec2(-uHazeWind.y, uHazeWind.x));
    vec2 q = vec2((u - t * uHazeSpeed) * 0.045, v * 0.06);
    q += 0.8 * vec2(hazeFbm(q * 1.3 + vec2(t * 0.03, 0.0)), hazeFbm(q * 1.3 + vec2(4.1, -t * 0.025))) - 0.4;
    return smoothstep(0.38, 0.78, hazeFbm(q));
  }
  vec3 dustHaze(vec3 col, vec3 world) {
    if (uHazeOn < 0.001 || uHazeDensity <= 0.0) return col;
    vec3 ray = world - cameraPosition;
    float d = min(length(ray), 300.0);
    vec3 dir = ray / max(length(ray), 1e-4);
    float k = dir.y * d / uHazeHeight;
    float path = exp(-cameraPosition.y / uHazeHeight) * d * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
    float n = 0.6 * hazePatches((cameraPosition + dir * d).xz, uHazeTime)
            + 0.4 * hazePatches((cameraPosition + dir * d * 0.55).xz, uHazeTime + 7.0);
    float gusts = 0.7 + 0.3 * sin(uHazeTime * 0.31) * sin(uHazeTime * 0.17 + 2.0);
    float amount = 1.0 - exp(-uHazeDensity * path * (0.06 + 2.2 * n * n) * gusts);
    return mix(col, uHazeColor, min(amount, 0.7) * uHazeOn);
  }
`;
