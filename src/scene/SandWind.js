// Wind-blown sand drifting left -> right across the hero view:
//   wisps  - soft sheets of moving sand flowing over the ground, with finer
//            tendrils, gusting: an overlay on the terrain mesh that veils the
//            ripples, lit by the terrain's own bake
//   haze   - low dust hugging the ground, drifting across the landscape in
//            gusty patches. Applied by the world's materials (HAZE_GLSL), never
//            the hero pyramid, whose colours must not change
//   grains - airborne grains drawn as short motion streaks: most hop low over
//            the sand (saltation), the rest float higher as dust; never drawn
//            over the pyramid
// Stateless: positions are a function of time in the shaders, so the wind
// costs no CPU per frame. Grains follow the ground through a small height map
// rasterised from the terrain at start-up.
import {
  Color,
  DataTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NormalBlending,
  RedFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  Vector2,
  Vector3,
  BufferAttribute,
} from 'three';
import { HAZE_GLSL, HAZE_UNIFORMS, NOISE_GLSL, REVEAL_GLSL, hazeNoiseTexture } from './shaders/common.js';

const HEIGHT_RES = 128;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SandWind {
  constructor(assets, cfg, { mobile = false, reducedMotion = false, reveal } = {}) {
    this.cfg = cfg;
    const s = cfg.sand;
    const ground = assets.models.terrain.getObjectByName('DUNE_Base');

    // Wind heading: the hero camera's screen-right, plus an optional yaw.
    const az = ((cfg.camera.hero.azimuth + s.windYaw) * Math.PI) / 180;
    const wind = new Vector2(Math.sin(az), -Math.cos(az)).normalize();

    this.heights = rasterHeights(ground);
    this.uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uWind: { value: wind },
      uColor: { value: new Color(cfg.colors.sand) },
    };

    // The dust haze lives in the world's materials; these drive it.
    const hz = HAZE_UNIFORMS;
    hz.uHazeNoise.value = hazeNoiseTexture();
    hz.uHazeDensity.value = reducedMotion ? 0 : s.haze;
    hz.uHazeHeight.value = s.hazeHeight;
    hz.uHazeSpeed.value = s.hazeSpeed;
    hz.uHazeWind.value.copy(wind);
    hz.uHazeColor.value.set(cfg.colors.haze);

    this.wisps = this.buildWisps(ground, assets.bakes.ground, reveal, mobile);
    this.grains = this.buildGrains(mobile ? s.grainsMobile : s.grains, assets.bakes.ground, planarUvMap(ground));
    this.enabled = !reducedMotion; // ambient motion: off for prefers-reduced-motion
    this.intensity = 0;
    this.base = {
      haze: hz.uHazeDensity.value,
      hazeColor: hz.uHazeColor.value.clone(),
      stormHaze: new Color(cfg.colors.stormHaze),
      wisps: this.wisps.material.uniforms.uStrength.value,
      grains: this.grains.material.uniforms.uOpacity.value,
    };
    this._storm = 0;
  }

  // 0..1 as the sandstorm closes in (the pull-back into section 2): more dust
  // in the air, browner haze, stronger drift and grains. Only densities and
  // strengths change: speeds would make the time-based motion jump.
  get storm() {
    return this._storm;
  }

  set storm(k) {
    this._storm = k;
    const b = this.base;
    const up = this.cfg.transition.windUp;
    const hz = HAZE_UNIFORMS;
    hz.uHazeDensity.value = b.haze * (1 + up.haze * k);
    hz.uHazeColor.value.lerpColors(b.hazeColor, b.stormHaze, k);
    this.wisps.material.uniforms.uStrength.value = b.wisps * (1 + up.wisps * k);
    this.grains.material.uniforms.uOpacity.value = b.grains * (1 + up.grains * k);
  }

  // ---------------------------------------------------------------- wisps
  buildWisps(ground, bake, reveal, mobile) {
    const uniforms = UniformsUtils.merge([UniformsLib.fog]);
    Object.assign(uniforms, this.uniforms, reveal, HAZE_UNIFORMS, {
      uBake: { value: bake },
      uStrength: { value: this.cfg.sand.wisps },
      uSpeed: { value: this.cfg.sand.wispSpeed },
    });
    const mesh = new Mesh(
      ground.geometry,
      new ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        fog: true,
        polygonOffset: true, // same surface as the terrain: always win the depth test
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        defines: { OCTAVES: mobile ? 2 : 4 },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          #include <fog_pars_vertex>
          void main() {
            vUv = uv;
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            vec4 mvPosition = viewMatrix * world;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          ${NOISE_GLSL}
          ${REVEAL_GLSL}
          ${HAZE_GLSL}
          uniform sampler2D uBake;
          uniform vec2 uWind;
          uniform vec3 uColor;
          uniform float uTime, uIntensity, uStrength, uSpeed;
          varying vec2 vUv;
          varying vec3 vWorld;
          #include <fog_pars_fragment>
          float fbmN(vec2 p) {
            float a = 0.5, s = 0.0;
            for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
            return s;
          }
          void main() {
            // Cheapest tests first: most of the tile is clear sand between the
            // sheets, and those pixels skip the noise, the haze and the blend.
            float camDist = distance(cameraPosition, vWorld);
            // Fade toward the terrain tile's edge and far away (fine detail aliases).
            float edge = 1.0 - smoothstep(22.0, 29.0, max(abs(vWorld.x), abs(vWorld.z)));
            float far = 1.0 - smoothstep(24.0, 42.0, camDist);
            float fade = edge * far * uStrength * uIntensity;
            if (fade < 0.001 || revealBehind(vWorld.xz) < 0.0) discard;
            // Wind-aligned coordinates: u along the wind, v across it.
            float u = dot(vWorld.xz, uWind);
            float v = dot(vWorld.xz, vec2(-uWind.y, uWind.x));
            float t = uTime;
            // Streams: broad soft sheets of moving sand that meander and change
            // shape as they flow. Wide across the wind, since perspective
            // already squashes that direction on screen.
            vec2 q = vec2((u - t * uSpeed * 0.75) * 0.1, v * 0.2);
            q += 0.9 * vec2(vnoise(q * 0.8 + vec2(0.0, t * 0.05)), vnoise(q * 0.8 + vec2(3.3, -t * 0.04))) - 0.45;
            float streams = smoothstep(0.42, 0.75, fbmN(q));
            if (streams <= 0.0) discard;
            // Gusts: big slow patches travelling downwind, and the wind as a
            // whole picking up and dying down.
            float gust = smoothstep(0.25, 0.75, vnoise(vec2((u - t * uSpeed * 0.8) * 0.03, v * 0.05) + 3.7));
            float swell = 0.55 + 0.45 * (sin(t * 0.37) * 0.5 + 0.5) * (sin(t * 0.23 + 1.3) * 0.5 + 0.5) * 1.6;
            // Tendrils: faster, finer filaments inside the sheets that wriggle
            // (only near the camera; beyond 24 m they'd alias).
            float tendrils = 0.0;
            if (camDist < 24.0) {
              vec2 r = vec2((u - t * uSpeed) * 0.45, v * 1.1);
              r.y += 1.2 * (vnoise(vec2(u * 0.35 - t * uSpeed * 0.3, v * 0.5)) - 0.5);
              tendrils = smoothstep(0.48, 0.85, fbmN(r)) * (1.0 - smoothstep(10.0, 24.0, camDist));
            }
            float drift = streams * (0.5 + 0.5 * tendrils) * (0.3 + 0.7 * gust) * swell;
            float alpha = clamp(drift * fade, 0.0, 0.75);
            if (alpha < 1.0 / 1024.0) discard;
            // Moving sand veils the ripples under it: a flat, slightly paler take
            // on the lit ground.
            vec3 col = dustHaze(texture2D(uBake, vUv).rgb * 1.3 + uColor * 0.05, vWorld);
            gl_FragColor = vec4(col, alpha);
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      }),
    );
    mesh.name = 'SandWisps';
    mesh.renderOrder = 1;
    return mesh;
  }

  // ---------------------------------------------------------------- grains
  // bake + uvMap: grains take their light from the ground bake under them
  // (so they darken in the pyramid's shadow); uvMap null = flat colour.
  buildGrains(count, bake, uvMap) {
    const s = this.cfg.sand;
    const geo = new InstancedBufferGeometry();
    // One quad per grain: x = across the streak (-1..1), y = tail (0) -> head (1).
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const rand = mulberry32(4242);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;

    const h = this.heights;
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      defines: { BAKE_LIGHT: uvMap ? 1 : 0 },
      uniforms: {
        ...this.uniforms,
        uBake: { value: bake },
        uUvU: { value: new Vector3(...(uvMap?.u ?? [0, 0, 0])) },
        uUvV: { value: new Vector3(...(uvMap?.v ?? [0, 0, 0])) },
        uHeight: { value: h.texture },
        uHeightRange: { value: new Vector2(h.min, h.max) },
        uHeightHalf: { value: h.half },
        uCenter: { value: new Vector3(0, 0, 0) },
        uBox: { value: new Vector2(...s.box) },
        uSpeed: { value: s.speed },
        uSaltation: { value: s.saltation },
        uHop: { value: new Vector2(...s.hop) },
        uHopRate: { value: new Vector2(...s.hopRate) },
        uDust: { value: new Vector2(...s.dust) },
        uSize: { value: new Vector2(...s.size) },
        uTrail: { value: s.trail },
        uOpacity: { value: s.opacity },
        uResolution: { value: new Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uPyrCone: { value: new Vector2(3.8, 4.3) }, // around the pyramid and its moving blocks: base radius, height (m)
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform sampler2D uHeight, uBake;
        uniform vec2 uHeightRange, uBox, uHop, uHopRate, uDust, uSize, uWind, uResolution, uPyrCone;
        uniform vec3 uCenter, uColor, uUvU, uUvV;
        uniform float uHeightHalf, uTime, uSpeed, uSaltation, uTrail, uPixelRatio, uIntensity;
        varying vec2 vQuad;
        varying float vAlpha;
        varying vec3 vColor;

        float groundY(vec2 xz) {
          vec2 uv = xz / (2.0 * uHeightHalf) + 0.5;
          return mix(uHeightRange.x, uHeightRange.y, texture2D(uHeight, uv).r);
        }

        // Position of this grain for a given distance travelled along the wind
        // (no wrapping here, so the head and tail of a streak stay together).
        vec3 grainAt(float along, float across, float t, bool dust, vec4 r) {
          vec2 w = uWind;
          vec2 xz = uCenter.xz + w * along + vec2(-w.y, w.x) * across;
          float y;
          if (dust) {
            y = mix(uDust.x, uDust.y, r.z) + 0.25 * sin(t * 0.6 + r.x * 40.0) * r.y;
          } else {
            // Saltation: long, flat hops. Steep take-off, shallow landing.
            float freq = mix(uHopRate.x, uHopRate.y, fract(r.y * 7.13));
            float height = mix(uHop.x, uHop.y, pow(fract(r.z * 13.7), 3.0));
            float ph = pow(fract(t * freq + r.w * 11.0), 0.6);
            y = height * 4.0 * ph * (1.0 - ph);
          }
          return vec3(xz.x, groundY(xz) + y + 0.01, xz.y);
        }

        void main() {
          vec4 r = aSeed;
          bool dust = r.w > uSaltation;
          float speed = uSpeed * mix(0.55, 1.45, r.y) * (dust ? 0.8 : 1.0);
          float L = uBox.x;
          float along = mod(r.x * 2.0 * L + speed * uTime, 2.0 * L) - L;
          float across = (r.z - 0.5) * 2.0 * uBox.y;
          vec3 head = grainAt(along, across, uTime, dust, r);
          vec3 tail = grainAt(along - speed * uTrail, across, uTime - uTrail, dust, r);

          // Never over the pyramid: drop a grain whose line of sight runs on
          // into it (a cone around the pyramid and its moving blocks).
          vec3 sight = normalize(head - cameraPosition);
          bool overPyramid = false;
          for (int i = 1; i <= 16; i++) {
            vec3 sp = head + sight * (float(i) * 1.5);
            float rr = uPyrCone.x * (1.0 - sp.y / uPyrCone.y);
            if (sp.y > -0.2 && sp.y < uPyrCone.y && dot(sp.xz, sp.xz) < rr * rr) overPyramid = true;
          }

          vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);
          vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
          if (ch.w < 0.1 || ct.w < 0.1 || uIntensity < 0.001 || overPyramid) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off screen
            return;
          }
          // Screen-space streak from tail to head, 'width' px wide, round-ish ends.
          vec2 sh = ch.xy / ch.w * uResolution * 0.5;
          vec2 st = ct.xy / ct.w * uResolution * 0.5;
          vec2 d = sh - st;
          float len = length(d);
          d = len > 1e-3 ? d / len : vec2(1.0, 0.0);
          vec2 n = vec2(-d.y, d.x);
          float width = mix(uSize.x, uSize.y, r.x * r.x) * uPixelRatio;
          vec4 clip = mix(ct, ch, position.y);
          vec2 offPx = n * position.x * width * 0.5 + d * (position.y * 2.0 - 1.0) * width * 0.5;
          clip.xy += offPx / (uResolution * 0.5) * clip.w;
          gl_Position = clip;

          // Fades: box ends, near/far, inside the pyramid, gusts travelling downwind.
          float a = (1.0 - smoothstep(L * 0.75, L, abs(along))) * (1.0 - smoothstep(uBox.y * 0.7, uBox.y, abs(across)));
          float camDist = distance(cameraPosition, head);
          a *= smoothstep(3.0, 8.0, camDist);
          vec2 q = abs(head.xz);
          a *= smoothstep(-0.1, 0.35, max(q.x, q.y) - 2.35 * (1.0 - head.y / 2.9));
          a *= 0.45 + 0.55 * smoothstep(-0.3, 0.6, sin(along * 0.12 - uTime * 0.55 + r.y * 1.2));
          a *= dust ? 0.55 * (1.0 - 0.5 * r.z) : 1.0;
          vAlpha = a * uIntensity;
          // Light: the ground's baked light under the grain (sun or shadow),
          // lifted a little; dust higher up keeps more of the flat sand colour.
          vec3 col = uColor;
          #if BAKE_LIGHT
            vec3 xz1 = vec3(head.x, head.z, 1.0);
            vec3 lit = texture2D(uBake, vec2(dot(uUvU, xz1), dot(uUvV, xz1))).rgb * 1.6;
            col = mix(lit, uColor * dot(lit, vec3(0.8)), dust ? 0.35 : 0.0);
          #endif
          vColor = col * mix(0.85, 1.1, fract(r.w * 31.7));
          vQuad = position.xy;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vQuad;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float across = 1.0 - smoothstep(0.35, 1.0, abs(vQuad.x));
          float along = mix(0.3, 1.0, vQuad.y); // fainter tail
          float a = across * along * vAlpha * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new Mesh(geo, material);
    mesh.name = 'SandGrains';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  // ---------------------------------------------------------------- module API
  get intensity() {
    return this.uniforms.uIntensity.value;
  }

  set intensity(v) {
    const on = this.enabled ? v : 0;
    this.uniforms.uIntensity.value = on;
    HAZE_UNIFORMS.uHazeOn.value = on;
    this.wisps.visible = this.grains.visible = on > 0.001;
  }

  objects() {
    return [this.wisps, this.grains];
  }

  update(time) {
    this.uniforms.uTime.value = time;
    HAZE_UNIFORMS.uHazeTime.value = time;
  }

  resize(w, h, dpr) {
    const u = this.grains.material.uniforms;
    u.uResolution.value.set(w * dpr, h * dpr);
    u.uPixelRatio.value = dpr;
  }

  dispose() {
    this.grains.geometry.dispose();
    this.grains.material.dispose();
    this.wisps.material.dispose();
    this.heights.texture.dispose();
  }
}


// The terrain's UVs as a linear function of world xz (u = a.x + b.z + c, same
// for v), fitted by least squares; null when the mapping isn't planar.
function planarUvMap(mesh) {
  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return null;
  const step = Math.max(1, Math.floor(pos.count / 2000));
  const p = new Vector3();
  const rows = [];
  for (let i = 0; i < pos.count; i += step) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    rows.push([p.x, p.z, uv.getX(i), uv.getY(i)]);
  }
  const solve = (k) => {
    // Normal equations for [a, b, c] . [x, z, 1] = uv[k].
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = [0, 0, 0];
    for (const row of rows) {
      const v = [row[0], row[1], 1];
      for (let i = 0; i < 3; i++) {
        r[i] += v[i] * row[2 + k];
        for (let j = 0; j < 3; j++) m[i * 3 + j] += v[i] * v[j];
      }
    }
    const det = (a) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    const d = det(m);
    if (Math.abs(d) < 1e-9) return null;
    return [0, 1, 2].map((c) => det(m.map((val, idx) => (idx % 3 === c ? r[Math.floor(idx / 3)] : val))) / d);
  };
  const u = solve(0);
  const v = solve(1);
  if (!u || !v) return null;
  const off = (f, row, k) => Math.abs(f[0] * row[0] + f[1] * row[1] + f[2] - row[2 + k]);
  const err = Math.max(...rows.map((row) => Math.max(off(u, row, 0), off(v, row, 1))));
  return err < 0.005 ? { u, v } : null;
}

// Height map of the terrain around the pyramid (the whole DUNE_Base tile),
// rasterised on the CPU: HEIGHT_RES^2 samples, 8-bit over the tile's height range.
function rasterHeights(mesh) {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  geo.computeBoundingBox();
  const bb = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  const half = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z));
  const n = HEIGHT_RES;
  const cell = (2 * half) / (n - 1);
  const heights = new Float32Array(n * n).fill(NaN);
  const v = [new Vector3(), new Vector3(), new Vector3()];
  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      v[k].fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(mesh.matrixWorld);
    }
    const [a, b, c] = v;
    const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) + half) / cell));
    const i1 = Math.min(n - 1, Math.floor((Math.max(a.x, b.x, c.x) + half) / cell));
    const j0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) + half) / cell));
    const j1 = Math.min(n - 1, Math.floor((Math.max(a.z, b.z, c.z) + half) / cell));
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = j0; j <= j1; j++) {
      const z = -half + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * cell;
        const w0 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
        const w1 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        heights[j * n + i] = w0 * a.y + w1 * b.y + w2 * c.y;
      }
    }
  }
  // Cells no triangle covers (the terrain is trimmed to what the cameras see,
  // tools/trim-world.mjs) take their neighbours' height, so grains near the
  // edge of the kept ground don't sink.
  for (let pass = 0, open = true; open && pass < n; pass++) {
    open = false;
    const prev = heights.slice();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(prev[j * n + i])) continue;
        let sum = 0;
        let cnt = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const h = prev[jj * n + ii];
          if (!Number.isNaN(h)) {
            sum += h;
            cnt++;
          }
        }
        if (cnt) heights[j * n + i] = sum / cnt;
        else open = true;
      }
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const h of heights) {
    if (Number.isNaN(h)) continue;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  if (!Number.isFinite(min)) min = max = 0;
  const range = Math.max(1e-3, max - min);
  const data = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const h = Number.isNaN(heights[i]) ? min : heights[i];
    data[i] = Math.round(((h - min) / range) * 255);
  }
  const texture = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return { texture, min, max, half };
}
