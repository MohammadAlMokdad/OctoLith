// Procedural geometry for section 3, the rings (our own shapes, sized like
// igloo's entry scene so its camera path and shader numbers carry over).
import { BufferAttribute, BufferGeometry, CylinderGeometry, Vector3 } from 'three';

// Small seeded PRNG (mulberry32): the same rings on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.extra = {}; // name -> { size, data }
    this.index = [];
  }

  vertex(p, n, uv, extra = {}) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    for (const [name, v] of Object.entries(extra)) {
      const arr = Array.isArray(v) ? v : [v];
      (this.extra[name] ??= { size: arr.length, data: [] }).data.push(...arr);
    }
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    this.index.push(a, b, c);
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    for (const [name, { size, data }] of Object.entries(this.extra)) {
      g.setAttribute(name, new BufferAttribute(new Float32Array(data), size));
    }
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.index), 1) : this.index);
    g.computeBoundingSphere();
    return g;
  }
}

// A rounded rectangle in (r, z), counter-clockwise, with outward normals.
function profile(r0, r1, z0, z1, bevel, steps = 4) {
  const pts = [];
  const corners = [
    [r1 - bevel, z0 + bevel, -Math.PI / 2], // outer bottom
    [r1 - bevel, z1 - bevel, 0], // outer top
    [r0 + bevel, z1 - bevel, Math.PI / 2], // inner top
    [r0 + bevel, z0 + bevel, Math.PI], // inner bottom
  ];
  for (const [cr, cz, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      const nr = Math.cos(a);
      const nz = Math.sin(a);
      pts.push({ r: cr + nr * bevel, z: cz + nz * bevel, nr, nz });
    }
  }
  return pts;
}

// A flat ring (inner..outer radius, z0..z1 thick, in its local XY plane like
// igloo's: lay it horizontal with rotation.x = -PI/2) broken into `shards`
// arcs of uneven size. The cut between two shards is jagged (it wanders in
// angle with radius and height) and the neighbours share it exactly, so the
// pieces close into a whole ring when the shader pulls them together.
// Per-vertex attributes:
//   centr  the shard's centroid x 3.38 (igloo's scale: the shader pivots on
//          centr * 0.3 and pushes shards out by centr * 0.075..0.15)
//   rand   3 random numbers per shard
//   cut    1 on the broken faces (they glow as seams), 0 elsewhere
export function shatteredRing({
  inner = 0.279,
  outer = 0.401,
  z0 = -0.014,
  z1 = 0.117,
  shards = 6,
  seed = 1,
  segments = 128,
  bevel = 0.016,
} = {}) {
  const rand = rng(seed);
  const prof = profile(inner, outer, z0, z1, bevel);
  // cut angles: uneven arcs, rotated at random
  const w = Array.from({ length: shards }, () => 0.55 + rand() * 0.9);
  const sum = w.reduce((a, b) => a + b, 0);
  const start = rand() * Math.PI * 2;
  const base = [start];
  for (let i = 0; i < shards; i++) base.push(base[i] + (w[i] / sum) * Math.PI * 2);
  const jag = Array.from({ length: shards }, () => [rand() * 6.28, rand() * 6.28, 0.5 + rand()]);
  // cut k at profile point P: its angle (cut `shards` is cut 0 one turn on)
  const cutAngle = (k, P) => {
    const [a, b, s] = jag[k % shards];
    const j = 0.045 * s * Math.sin(P.r * 70 + a) + 0.03 * Math.sin(P.z * 110 + b) + 0.018 * Math.sin(P.r * 190 + P.z * 60 + a * 2);
    return base[k] + j;
  };

  const out = new Builder();
  const v = new Vector3();
  const n = new Vector3();
  for (let s = 0; s < shards; s++) {
    const span = base[s + 1] - base[s];
    const steps = Math.max(6, Math.round((segments * span) / (Math.PI * 2)));
    const shardRand = [rand(), rand(), rand()];
    // centroid (mid-radius, mid-height, mid-angle)
    const am = (base[s] + base[s + 1]) / 2;
    const rm = (inner + outer) / 2;
    const centr = [Math.cos(am) * rm * 3.38, Math.sin(am) * rm * 3.38, ((z0 + z1) / 2) * 3.38];
    const attrs = (cut) => ({ centr, rand: shardRand, cut });

    // the swept surface (top, walls, bottom)
    const first = out.pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      for (let j = 0; j < prof.length; j++) {
        const P = prof[j];
        const a = cutAngle(s, P) + (cutAngle(s + 1, P) - cutAngle(s, P)) * f;
        v.set(Math.cos(a) * P.r, Math.sin(a) * P.r, P.z);
        n.set(Math.cos(a) * P.nr, Math.sin(a) * P.nr, P.nz);
        out.vertex(v, n, [(a * rm) / 0.4, j / (prof.length - 1)], attrs(0));
      }
    }
    const m = prof.length;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m;
        const a = first + i * m + j;
        const b = first + (i + 1) * m + j;
        const c = first + (i + 1) * m + j2;
        const d = first + i * m + j2;
        out.tri(a, b, c);
        out.tri(a, c, d);
      }
    }

    // the two broken faces: fans over the (jagged) profile, flat-shaded facets
    for (const [k, sign] of [
      [s, -1],
      [s + 1, 1],
    ]) {
      const ring = prof.map((P) => {
        const a = cutAngle(k, P);
        return new Vector3(Math.cos(a) * P.r, Math.sin(a) * P.r, P.z);
      });
      const centre = ring.reduce((acc, p) => acc.add(p), new Vector3()).multiplyScalar(1 / ring.length);
      // the face looks along the ring: back at the shard's start, on at its end
      const a = Math.atan2(centre.y, centre.x);
      const facing = new Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(sign);
      for (let j = 0; j < m; j++) {
        let A = ring[j];
        let B = ring[(j + 1) % m];
        let fn = new Vector3().subVectors(A, centre).cross(new Vector3().subVectors(B, centre));
        if (fn.dot(facing) < 0) [A, B] = [B, A];
        fn = new Vector3().subVectors(A, centre).cross(new Vector3().subVectors(B, centre)).normalize();
        const i0 = out.vertex(centre, fn, [0.5, 0.5], attrs(1));
        const i1 = out.vertex(A, fn, [0, 0], attrs(1));
        const i2 = out.vertex(B, fn, [1, 0], attrs(1));
        out.tri(i0, i1, i2);
      }
    }
  }
  return out.build();
}

// A flat, gently domed annulus in XZ (y up): uv.x = radial (r0 -> r1 mapped
// to u0 -> 1), uv.y = around. The plasma halos and the ground smoke.
export function domedAnnulus({ r0 = 0.21, r1 = 0.62, y0 = 0.094, y1 = 0.2, u0 = 0.333, radial = 16, around = 96 } = {}) {
  const out = new Builder();
  const v = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i <= radial; i++) {
    const f = i / radial;
    const r = r0 + (r1 - r0) * f;
    const y = y0 + (y1 - y0) * Math.sin(Math.PI * f);
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      v.set(Math.cos(a) * r, y, Math.sin(a) * r);
      out.vertex(v, up, [u0 + (1 - u0) * f, j / around]);
    }
  }
  const row = around + 1;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * row + j;
      out.tri(a, a + row, a + row + 1);
      out.tri(a, a + row + 1, a + 1);
    }
  }
  return out.build();
}

// A curved arm of smoke spiralling out from a ring: a strip whose centre line
// runs from radius 0.2 to 1.48 while rising from -0.08 to 0.28, widening as it
// goes. uv.x = across the strip, uv.y = along it (radial).
export function smokeArm({ turn = 2.4, along = 48, across = 6 } = {}) {
  const out = new Builder();
  const v = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i <= along; i++) {
    const s = i / along;
    const r = 0.2 + 1.28 * s;
    const a = s * turn;
    const y = -0.08 + 0.36 * s;
    const width = 0.06 + 0.5 * s;
    // across the strip: radial direction, so the arm is a curved band
    for (let j = 0; j <= across; j++) {
      const t = j / across - 0.5;
      const rr = r + t * width;
      v.set(Math.cos(a) * rr, y + t * 0.04, Math.sin(a) * rr);
      out.vertex(v, up, [j / across, s]);
    }
  }
  const row = across + 1;
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * row + j;
      out.tri(a, a + row, a + row + 1);
      out.tri(a, a + row + 1, a + 1);
    }
  }
  return out.build();
}

// The tiered floor of the room at the bottom of the shaft (local, scaled 0.73
// in the scene like igloo's): a static centre, four rings that wobble
// (animationmask 1, iteration 0..3) and a static outer apron, with sunken
// grooves between them (origY low: the shader lights them).
export function tieredFloor({ around = 160 } = {}) {
  const out = new Builder();
  const edges = [0.2, 0.39, 0.56, 0.74, 0.92, 1.09, 1.8];
  const top = 0.087;
  const grooveY = -0.1;
  const groove = 0.012;
  const v = new Vector3();
  const n = new Vector3();
  const ringAt = (k) => (k >= 1 && k <= 4 ? [1, k - 1] : [0, 0]);
  const strip = (rA, yA, rB, yB, nr, ny, k) => {
    const [mask, iteration] = ringAt(k);
    const first = out.pos.length / 3;
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const [r, y] of [
        [rA, yA],
        [rB, yB],
      ]) {
        v.set(c * r, y, s * r);
        n.set(c * nr, ny, s * nr).normalize();
        out.vertex(v, n, [0.5 + (c * r) / 3.6, 0.5 + (s * r) / 3.6], { animationmask: mask, iteration, origY: y });
      }
    }
    for (let j = 0; j < around; j++) {
      const a = first + j * 2;
      out.tri(a, a + 2, a + 3);
      out.tri(a, a + 3, a + 1);
    }
  };
  for (let k = 0; k < edges.length - 1; k++) {
    const r0 = edges[k] + (k > 0 ? groove : 0);
    const r1 = edges[k + 1] - (k < edges.length - 2 ? groove : 0);
    const y = k === edges.length - 2 ? top - 0.03 : top;
    strip(r0, y, r1, y, 0, 1, k); // top
    strip(r1, y, r1, grooveY, 1, 0, k); // outer wall down into the groove
    strip(r0, grooveY, r0, y, -1, 0, k); // inner wall
    if (k < edges.length - 2) strip(r1, grooveY, edges[k + 1] + groove, grooveY, 0, 1, k); // groove bottom
  }
  // the centre cap
  strip(0, top, edges[0], top, 0, 1, 0);
  return out.build();
}

// An open cylinder (radius 1, height 0..h) cut into `panels` vertical panels:
// attribute `rand` per panel (for the glyph columns' flicker).
export function panelCylinder({ height = 1.2, panels = 28, rows = 8, seed = 3 } = {}) {
  const r = rng(seed);
  const out = new Builder();
  const v = new Vector3();
  const n = new Vector3();
  const per = 3;
  for (let p = 0; p < panels; p++) {
    const pr = r();
    const first = out.pos.length / 3;
    for (let j = 0; j <= per; j++) {
      const a = ((p + j / per) / panels) * Math.PI * 2;
      for (let i = 0; i <= rows; i++) {
        const y = (i / rows) * height;
        v.set(Math.cos(a), y, Math.sin(a));
        n.set(-Math.cos(a), 0, -Math.sin(a));
        out.vertex(v, n, [(p + j / per) / panels, i / rows], { rand: pr });
      }
    }
    const row = rows + 1;
    for (let j = 0; j < per; j++) {
      for (let i = 0; i < rows; i++) {
        const a = first + j * row + i;
        out.tri(a, a + row, a + row + 1);
        out.tri(a, a + row + 1, a + 1);
      }
    }
  }
  return out.build();
}

// The shaft's dust wall: an open cylinder seen from inside.
export function insideCylinder(radius, height, around = 64, rows = 32) {
  const g = new CylinderGeometry(radius, radius, height, around, rows, true);
  g.translate(0, -height / 2, 0); // top at y = 0
  g.scale(-1, 1, 1); // inside faces forward
  return g;
}
