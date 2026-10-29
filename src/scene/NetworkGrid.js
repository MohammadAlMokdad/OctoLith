// Phase C: the line network spreading out from the pyramid during the scan.
// Two layouts (cfg.network.layout):
//   cage   igloo's intro cage: lines on a 3D lattice, grown out of the
//          pyramid's base (runs along the ground, triangles standing on them
//          like tents, a few climbs and squares), every piece twinkling on
//          its own. Small numbers tick at some of its corners
//          as the wave passes (igloo's intro particles): blank, "+", a run of
//          counting two-digit numbers, "+", then gone.
//   walks  the earlier flat circuit: seeded random walks on a square grid
//          (right angles, zigzags, open squares, branches), some lifted into
//          the air, with node dots.
// Revealed with the same progress band as the wireframe (aDist = distance
// from the centre / radius), fading with distance, and fading out where the
// world reveal passes underneath.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Points,
  ShaderMaterial,
} from 'three';
import { createDrawLines } from './shaders/drawLines.js';
import { NOISE_GLSL, REVEAL_GLSL } from './shaders/common.js';

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

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

// Returns { segments: [[x0,y0,z0,x1,y1,z1], ...], nodes: Map(key -> [x,y,z]) }.
export function generateNetwork({ segments: target, radius, grid, maxLift, liftChance, seed = 7, footprint = 2.75 }) {
  const rand = mulberry32(seed);
  const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const segs = [];
  const seen = new Set();
  const nodes = new Map();
  const key = (x, y, z) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;

  const inside = (x, z) => Math.abs(x) < footprint && Math.abs(z) < footprint;
  const out = (x, z) => Math.hypot(x, z) > radius;
  const add = (a, b) => {
    const k1 = key(...a) + '|' + key(...b);
    const k2 = key(...b) + '|' + key(...a);
    if (seen.has(k1) || seen.has(k2)) return false;
    seen.add(k1);
    segs.push([...a, ...b]);
    nodes.set(key(...a), a);
    nodes.set(key(...b), b);
    return true;
  };

  // Walkers start on the pyramid's base perimeter, heading outward.
  const walkers = [];
  const perimeterCells = Math.round((footprint * 2) / grid);
  for (let side = 0; side < 4; side++) {
    const [nx, nz] = DIRS[side];
    for (let i = 0; i <= perimeterCells; i += randInt(2, 4)) {
      const t = -footprint + i * grid;
      const x = nx !== 0 ? nx * footprint : t;
      const z = nz !== 0 ? nz * footprint : t;
      walkers.push({ x: Math.round(x / grid) * grid, z: Math.round(z / grid) * grid, dir: side, depth: 0 });
    }
  }
  // Shuffle so the four sides grow evenly.
  for (let i = walkers.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [walkers[i], walkers[j]] = [walkers[j], walkers[i]];
  }

  const outwardTurn = (x, z, dir) => {
    // Prefer the 90 deg turn that points more away from the centre.
    const left = (dir + 1) % 4;
    const right = (dir + 3) % 4;
    const dl = DIRS[left][0] * x + DIRS[left][1] * z;
    const dr = DIRS[right][0] * x + DIRS[right][1] * z;
    const better = dl > dr ? left : right;
    return rand() < 0.72 ? better : better === left ? right : left;
  };

  let guard = 0;
  while (segs.length < target && walkers.length && guard++ < 20000) {
    const w = walkers.shift();
    const lifted = w.depth > 0 && rand() < liftChance;
    const y = lifted ? +(0.3 + rand() * (maxLift - 0.3)).toFixed(2) : 0;
    let { x, z, dir } = w;
    if (lifted && rand() < 0.6) add([x, 0, z], [x, y, z]); // vertical riser
    const zigzag = rand() < 0.25;
    let zigSide = 1;
    const steps = randInt(3, 12);
    for (let s = 0; s < steps && segs.length < target; s++) {
      const len = (zigzag || rand() < 0.7 ? 1 : randInt(2, 3)) * grid;
      const nx = +(x + DIRS[dir][0] * len).toFixed(2);
      const nz = +(z + DIRS[dir][1] * len).toFixed(2);
      if (inside(nx, nz) || out(nx, nz)) break;
      add([x, y, z], [nx, y, nz]);
      x = nx;
      z = nz;

      const r = rand();
      if (r < 0.12) {
        // Open square: three sides of a small square hanging off this node.
        const side = (dir + (rand() < 0.5 ? 1 : 3)) % 4;
        const sz = randInt(1, 2) * grid;
        const p1 = [x + DIRS[side][0] * sz, y, z + DIRS[side][1] * sz];
        const p2 = [p1[0] + DIRS[dir][0] * sz, y, p1[2] + DIRS[dir][1] * sz];
        const p3 = [x + DIRS[dir][0] * sz, y, z + DIRS[dir][1] * sz];
        if (!out(p2[0], p2[2]) && !inside(p2[0], p2[2])) {
          add([x, y, z], p1.map((v) => +v.toFixed(2)));
          add(p1.map((v) => +v.toFixed(2)), p2.map((v) => +v.toFixed(2)));
          add(p2.map((v) => +v.toFixed(2)), p3.map((v) => +v.toFixed(2)));
        }
      } else if (r < 0.3 && w.depth < 6) {
        walkers.push({ x, z, dir: (dir + (rand() < 0.5 ? 1 : 3)) % 4, depth: w.depth + 1 });
      }
      if (zigzag) {
        dir = (dir + (zigSide > 0 ? 1 : 3)) % 4;
        zigSide = -zigSide;
      } else if (rand() < 0.5) {
        dir = outwardTurn(x, z, dir);
      }
    }
    // Keep growing from where this walk ended.
    if (w.depth < 8 && rand() < 0.75) walkers.push({ x, z, dir: outwardTurn(x, z, dir), depth: w.depth + 1 });
  }
  return { segments: segs, nodes };
}

// igloo's intro cage, grown out of the pyramid. A lattice whose cell is half
// the pyramid's half-width, so the base's edges lie on lattice lines, is
// walked outward from every lattice point on the base's perimeter: each line
// links back to the pyramid through others. A walker runs along the ground
// layer, now and then raising a tent (a diagonal up, a leg back down: a
// triangle standing on its line), climbing or dropping a level, or (rarely)
// closing a square; it branches as it goes. Mostly open lines and triangles,
// few boxes. Vertex (i, j, k) sits at (i, j, k) * cell. Returns segments
// [x0,y0,z0,x1,y1,z1, faceSeed] and the corners they use.
export function generateCage({ segments: target, radius, cell, levels, half = 2.5, seed = 11 }) {
  const rand = mulberry32(seed);
  const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const F = Math.round(half / cell); // the base's half-width in cells
  const segs = [];
  const seen = new Set();
  const corners = new Map();
  const degree = new Map();
  const key = (v) => v.join(',');
  const onBase = (v) => Math.max(Math.abs(v[0]), Math.abs(v[2])) === F;
  const valid = (v) =>
    !(Math.abs(v[0]) < F && Math.abs(v[2]) < F) && // not under the pyramid
    Math.hypot(v[0], v[2]) * cell <= radius &&
    v[1] >= levels[0] &&
    v[1] <= levels[1];
  const add = (a, b, face) => {
    // nothing along the base's own edges (that would box the pyramid in)
    if (!valid(a) || !valid(b) || (onBase(a) && onBase(b))) return false;
    const ka = key(a);
    const kb = key(b);
    const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (seen.has(k) || (degree.get(kb) ?? 0) >= 4) return false;
    seen.add(k);
    degree.set(ka, (degree.get(ka) ?? 0) + 1);
    degree.set(kb, (degree.get(kb) ?? 0) + 1);
    const pa = a.map((x) => x * cell);
    const pb = b.map((x) => x * cell);
    segs.push([...pa, ...pb, face]);
    corners.set(ka, pa);
    corners.set(kb, pb);
    return true;
  };
  const step = (v, dir, dj = 0) => [v[0] + DIRS[dir][0], v[1] + dj, v[2] + DIRS[dir][1]];
  // the 90 degree turn that points more away from the centre (most of the time)
  const outwardTurn = (v, dir) => {
    const left = (dir + 1) % 4;
    const right = (dir + 3) % 4;
    const dl = DIRS[left][0] * v[0] + DIRS[left][1] * v[2];
    const dr = DIRS[right][0] * v[0] + DIRS[right][1] * v[2];
    const better = dl > dr ? left : right;
    return rand() < 0.75 ? better : better === left ? right : left;
  };

  // One walker per lattice point on the base's perimeter, heading outward.
  const walkers = [];
  for (let side = 0; side < 4; side++) {
    const [nx, nz] = DIRS[side];
    for (let t = -F; t <= F; t++) walkers.push({ v: [nx ? nx * F : t, 0, nz ? nz * F : t], dir: side, depth: 0 });
  }
  for (let i = walkers.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [walkers[i], walkers[j]] = [walkers[j], walkers[i]];
  }

  let guard = 0;
  while (segs.length < target && walkers.length && guard++ < 20000) {
    const w = walkers.shift();
    let { v, dir } = w;
    const steps = randInt(3, 9);
    for (let s = 0; s < steps && segs.length < target; s++) {
      // every run from the base leaves it with a straight line outward
      const r = w.depth === 0 && s === 0 ? 1 : rand();
      const face = rand();
      let next = null;
      if (r < 0.1 && v[1] < levels[1]) {
        // a tent: up the diagonal, then the leg down and/or the floor under it
        const top = step(v, dir, 1);
        const foot = step(v, dir);
        if (add(v, top, face)) {
          if (rand() < 0.8) add(top, foot, face);
          if (rand() < 0.7) add(v, foot, face);
          next = rand() < 0.65 ? foot : top;
        }
      } else if (r < 0.14) {
        // climb or drop a level (back toward the ground more often)
        const dj = v[1] > 0 ? (rand() < 0.7 ? -1 : 1) : v[1] < 0 ? 1 : rand() < 0.8 ? 1 : -1;
        const nv = [v[0], v[1] + dj, v[2]];
        if (add(v, nv, face)) next = nv;
      } else if (r < 0) {
        // (off) a closed square standing on the line
        const a = step(v, dir);
        const b = [a[0], a[1] + 1, a[2]];
        const c = [v[0], v[1] + 1, v[2]];
        if (add(v, a, face)) {
          add(a, b, face);
          add(b, c, face);
          add(c, v, face);
          next = a;
        }
      } else {
        // a flat step along the line, sometimes turning first
        if (r < 1 && rand() < 0.3) dir = outwardTurn(v, dir);
        const nv = step(v, dir);
        if (add(v, nv, face)) next = nv;
      }
      if (!next) break;
      v = next;
      // branch, more often close to the pyramid so it stays well tied in
      const near = Math.max(0, 1 - (Math.hypot(v[0], v[2]) * cell) / 8);
      if (rand() < 0.22 + 0.3 * near && w.depth < 7) walkers.push({ v, dir: (dir + (rand() < 0.5 ? 1 : 3)) % 4, depth: w.depth + 1 });
    }
    // keep growing from where this run ended
    if (w.depth < 10 && rand() < 0.8) walkers.push({ v, dir: outwardTurn(v, dir), depth: w.depth + 1 });
  }
  return { segments: segs, corners: [...corners.values()] };
}

// The numbers' spritesheet: 32 square cells top to bottom, each a short label
// in the UI's mono font. A corner steps through them as the wave passes:
// blank, "+", "+", a run of counting two-digit numbers, "+", "+".
const CELLS = 32;

function numberLabels(seed) {
  const rand = mulberry32(seed);
  const labels = ['', '', '', '', '', '', '+', '+'];
  let v = Math.floor(rand() * 10);
  while (labels.length < CELLS - 2) {
    labels.push(String(v).padStart(2, '0'));
    v = (v + 3 + Math.floor(rand() * 7)) % 100;
  }
  return [...labels, '+', '+'];
}

function numberAtlas(seed, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size * CELLS;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  const labels = numberLabels(seed);
  const font = `500 ${Math.round(size * 0.7)}px "IBM Plex Mono"`;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${font}, ui-monospace, Menlo, Consolas, monospace`;
    labels.forEach((t, i) => ctx.fillText(t, size / 2, size * (i + 0.5)));
    texture.needsUpdate = true;
  };
  draw();
  // the webfont may still be loading: draw again in it once it's there
  document.fonts?.load(font).then(draw, () => {});
  return texture;
}

export class NetworkGrid {
  constructor(cfg, { mobile = false, reveal = null } = {}) {
    const n = cfg.network;
    const cage = n.layout === 'cage';
    const L = cage ? n.cage : n.walks;
    const rand = mulberry32(99);
    const [a0, a1] = L.alpha;
    // the cage's wave is a sphere (igloo's length(worldPos)); the walks' a disc
    const distOf = (x, y, z) => (cage ? Math.hypot(x, y, z) : Math.hypot(x, z)) / L.radius;

    let segments;
    let nodes;
    if (cage) {
      const out = generateCage({
        segments: mobile ? L.segmentsMobile : L.segments,
        radius: L.radius,
        cell: L.cell,
        levels: L.levels,
      });
      segments = out.segments;
      nodes = out.corners;
    } else {
      const out = generateNetwork({
        segments: mobile ? L.segmentsMobile : L.segments,
        radius: L.radius,
        grid: L.grid,
        maxLift: L.maxLift,
        liftChance: L.liftChance,
      });
      segments = out.segments;
      nodes = [...out.nodes.values()];
    }

    // Lines. Every cage face twinkles, as one (igloo's per-face pulse); the
    // walks twinkle here and there.
    const positions = new Float32Array(segments.length * 6);
    const per = new Float32Array(segments.length * 4);
    segments.forEach((s, i) => {
      positions.set(s.slice(0, 6), i * 6);
      per[i * 4] = distOf(s[0], s[1], s[2]);
      per[i * 4 + 1] = distOf(s[3], s[4], s[5]);
      per[i * 4 + 2] = a0 + rand() * (a1 - a0);
      per[i * 4 + 3] = cage ? 0.02 + s[6] * 0.98 : rand() < L.twinkleChance ? rand() : 0;
    });
    this.lines = createDrawLines(positions, per, {
      color: cfg.colors.line,
      linewidth: n.lineWidth,
      headWidth: 0.04,
      headBoost: 2.5,
      intensity: L.intensity,
      distanceFade: L.distanceFade,
      twinkleDepth: L.twinkleDepth,
      reveal,
    });
    this.parts = [this.lines];

    if (cage) {
      // Numbers at some of the corners, just beside the corner.
      const N = n.numbers;
      const pick = nodes.slice();
      for (let i = pick.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [pick[i], pick[j]] = [pick[j], pick[i]];
      }
      pick.length = Math.min(pick.length, mobile ? N.countMobile : N.count);
      const pos = new Float32Array(pick.length * 3);
      const jitter = new Float32Array(pick.length);
      pick.forEach((p, i) => {
        pos.set([p[0] + N.offset, p[1] + N.offset, p[2]], i * 3);
        jitter[i] = Math.floor(rand() * 3);
      });
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('aJitter', new BufferAttribute(jitter, 1));
      this.numbers = new Points(geo, createNumberMaterial(cfg, L, reveal));
      this.numbers.frustumCulled = false;
      this.parts.push(this.numbers);
    } else {
      // Node dots.
      const pos = new Float32Array(nodes.length * 3);
      const attr = new Float32Array(nodes.length * 3); // dist, alpha, twinkle
      nodes.forEach((p, i) => {
        pos.set(p, i * 3);
        attr[i * 3] = distOf(p[0], p[1], p[2]);
        attr[i * 3 + 1] = a0 + rand() * (a1 - a0);
        attr[i * 3 + 2] = rand() < L.twinkleChance * 2 ? rand() : 0;
      });
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('aData', new BufferAttribute(attr, 3));
      this.points = new Points(geo, createNodeMaterial(cfg, L, reveal));
      this.points.frustumCulled = false;
      this.parts.push(this.points);
    }
    this.segmentCount = segments.length;
    this.nodeCount = nodes.length;
  }

  objects() {
    return this.parts;
  }

  // Sets a uniform on every part that has it.
  setUniform(name, v) {
    for (const o of this.parts) if (o.material.uniforms[name]) o.material.uniforms[name].value = v;
  }

  get progress() {
    return this.lines.material.uniforms.uProgress.value;
  }

  set progress(v) {
    this.setUniform('uProgress', v);
  }

  // The numbers' count: the spritesheet cell shown at the centre; a corner
  // d metres out is d * perMeter cells behind. Driven by the intro timeline.
  get ticks() {
    return this.numbers?.material.uniforms.uTicks.value ?? 0;
  }

  set ticks(v) {
    this.setUniform('uTicks', v);
  }

  get fade() {
    return this.lines.material.uniforms.uFade.value;
  }

  set fade(v) {
    this.setUniform('uFade', v);
    const visible = v > 0.001;
    for (const o of this.parts) o.visible = visible;
  }

  update(time) {
    this.setUniform('uTime', time);
  }

  resize(w, h, dpr) {
    this.lines.material.resolution.set(w, h);
    this.setUniform('uPixelRatio', dpr);
    this.setUniform('uViewHeight', h * dpr);
  }

  dispose() {
    for (const o of this.parts) {
      o.geometry.dispose();
      o.material.uniforms.tAtlas?.value.dispose();
      o.material.dispose();
    }
  }
}

// igloo's intro numbers: each corner shows cell floor(ticks - d * perMeter)
// of the spritesheet (d: its distance from the centre), so the counting
// ripples outward behind the lines' drawing front and every corner ends blank.
function createNumberMaterial(cfg, L, reveal) {
  const N = cfg.network.numbers;
  const uniforms = {
    tAtlas: { value: numberAtlas(5) },
    uProgress: { value: 0 },
    uTicks: { value: 0 },
    uFade: { value: 1 },
    uRadius: { value: L.radius },
    uPerMeter: { value: N.perMeter },
    uSize: { value: N.size },
    uViewHeight: { value: 900 },
    uAlpha: { value: N.alpha },
    uDistFade: { value: L.distanceFade },
    uColor: { value: new Color(cfg.colors.line) },
  };
  if (reveal) Object.assign(uniforms, reveal);
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    defines: { USE_REVEAL_FADE: reveal ? 1 : 0, CELLS: CELLS.toFixed(1) },
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aJitter;
      uniform float uTicks, uPerMeter, uSize, uViewHeight;
      varying float vCell, vDist;
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vDist = length(position);
        vCell = floor(uTicks - vDist * uPerMeter + aJitter);
        gl_PointSize = uSize * uViewHeight;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tAtlas;
      uniform float uProgress, uRadius, uFade, uAlpha;
      uniform vec2 uDistFade;
      uniform vec3 uColor;
      varying float vCell, vDist;
      varying vec3 vWorld;
      #if USE_REVEAL_FADE
        ${NOISE_GLSL}
        ${REVEAL_GLSL}
      #endif
      void main() {
        if (vCell < 0.0 || vCell >= CELLS) discard;
        // only where the lines are already drawn
        float a = 1.0 - smoothstep(uProgress * uRadius - 1.5, uProgress * uRadius, vDist);
        vec2 uv = vec2(gl_PointCoord.x, 1.0 - (vCell + gl_PointCoord.y) / CELLS);
        a *= texture2D(tAtlas, uv).a * uAlpha * uFade;
        a *= 1.0 - smoothstep(uDistFade.x, uDistFade.y, vDist / uRadius);
        #if USE_REVEAL_FADE
          a *= 1.0 - smoothstep(0.0, 2.5, revealBehind(vWorld.xz));
        #endif
        if (a <= 0.001) discard;
        gl_FragColor = vec4(uColor * 1.6, a);
      }`,
  });
}

function createNodeMaterial(cfg, L, reveal) {
  const uniforms = {
    uProgress: { value: 0 },
    uFade: { value: 1 },
    uTime: { value: 0 },
    uSize: { value: L.nodeSize },
    uPixelRatio: { value: 1 },
    uColor: { value: new Color(cfg.colors.line) },
  };
  if (reveal) Object.assign(uniforms, reveal);
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    defines: { USE_REVEAL_FADE: reveal ? 1 : 0 },
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aData;
      uniform float uProgress, uSize, uPixelRatio;
      varying vec3 vData;
      varying vec3 vWorld;
      varying float vHead;
      void main() {
        vData = aData;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vHead = smoothstep(uProgress - 0.04, uProgress, aData.x);
        gl_PointSize = uSize * uPixelRatio * (1.0 + vHead * 1.5);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uProgress, uFade, uTime;
      uniform vec3 uColor;
      varying vec3 vData;
      varying vec3 vWorld;
      varying float vHead;
      #if USE_REVEAL_FADE
        ${NOISE_GLSL}
        ${REVEAL_GLSL}
      #endif
      void main() {
        if (vData.x > uProgress) discard;
        vec2 d = gl_PointCoord - 0.5;
        float disc = 1.0 - smoothstep(0.35, 0.5, length(d));
        float tw = vData.z > 0.0 ? 0.35 + 0.65 * abs(sin(uTime * (2.0 + vData.z * 6.0) + vData.z * 30.0)) : 1.0;
        float a = disc * vData.y * uFade * tw * (1.0 - smoothstep(0.3, 1.0, vData.x));
        #if USE_REVEAL_FADE
          a *= 1.0 - smoothstep(0.0, 2.5, revealBehind(vWorld.xz));
        #endif
        gl_FragColor = vec4(uColor * (1.6 + vHead * 3.0), a);
      }`,
  });
}
