// The shapes the room's particle sculpture takes, one per link (igloo's
// "volumes"): a signed distance field in a 64³ RGBA8 cube, the layout of
// igloo's baked VDBs, which its particle simulation reads as
//   rgb  the outward surface direction, x 0.5 + 0.5
//   a    the signed distance in volume units (the cube is 1 across), stored as
//        (d + 2) / 4: 0.5 is the surface, below it is inside.
// igloo bakes its shapes offline (a penguin, an X, an M). Ours are drawn here
// at load as flat 2D glyphs (the octopus mark and the Instagram, WhatsApp and
// mail glyphs), turned into a 2D distance field (an exact Euclidean distance
// transform of the drawing) and extruded with rounded edges, like igloo's
// letters. Each shape also gets its particles' homes, spread evenly over its
// surface. The worker (volumeWorker.js) runs this off the main thread.
//
// Drawing space: the cube's front face, x right and y up, -0.5..0.5. The
// sculpture faces the room's camera this way round half a turn after a link
// change (ParticleSculpture spins it).

// brand/octopus-mark.svg (viewBox 256)
const OCTOPUS =
  'M243.08,119.55h-72.62l58.26-58.26c3.51-3.51,3.51-9.21,0-12.73-3.52-3.51-9.21-3.51-12.73,0l-34.63,34.63c.87-4.77,1.33-9.95,1.33-15.58,0-12.75-2.19-23.26-6.56-31.53-4.37-8.27-10.64-14.43-18.81-18.49-8.17-4.05-17.94-6.08-29.32-6.08s-21.02,2.03-29.24,6.08c-8.22,4.06-14.51,10.22-18.88,18.49-4.37,8.27-6.56,18.78-6.56,31.53,0,5.63.46,10.8,1.32,15.58l-34.63-34.63c-3.51-3.51-9.21-3.51-12.73,0s-3.52,9.21,0,12.73l58.26,58.26H12.92c-4.97,0-9,4.03-9,9s4.03,9,9,9h82.81l-58.26,58.26c-3.52,3.51-3.52,9.21,0,12.73,1.76,1.76,4.06,2.64,6.36,2.64s4.61-.88,6.36-2.64l68.8-68.8v97.21c0,4.97,4.03,9,9,9s9-4.03,9-9v-97.21l68.8,68.8c1.76,1.76,4.06,2.64,6.36,2.64s4.61-.88,6.36-2.64c3.51-3.51,3.51-9.21,0-12.73l-58.26-58.26h82.81c4.97,0,9-4.03,9-9s-4.03-9-9-9ZM94.5,66.04c0-6.11.71-11.48,2.13-16.12,1.42-4.64,3.56-8.51,6.4-11.62,2.84-3.11,6.35-5.45,10.51-7.03,4.16-1.58,8.98-2.37,14.46-2.37s10.3.79,14.46,2.37c4.16,1.58,7.67,3.93,10.51,7.03,2.84,3.11,5,6.98,6.48,11.62,1.47,4.64,2.21,10.01,2.21,16.12v3.48c0,6-.74,11.3-2.21,15.88-1.48,4.58-3.63,8.43-6.48,11.54-2.84,3.11-6.35,5.45-10.51,7.03-4.16,1.58-8.98,2.37-14.46,2.37s-10.3-.79-14.46-2.37c-4.16-1.58-7.67-3.92-10.51-7.03-2.84-3.11-4.98-6.95-6.4-11.54-1.42-4.58-2.13-9.88-2.13-15.88v-3.48Z';

// Each shape: draw(ctx) in drawing space; depth: the extrusion's thickness,
// round: its edge radius, grow: how far the drawing is thickened first
// (volume units; round must stay under half the thinnest stroke, or that
// stroke vanishes). Strokes are about as heavy as igloo's letters (~0.1),
// with flat faces and small bevels like them.
export const SHAPES = {
  octopus: {
    depth: 0.16,
    round: 0.024,
    grow: 0.014,
    draw(g) {
      // the mark's box is x 3.9..252.1, y 10.5..252 (y down): centre it, 0.86 across
      const k = 0.86 / 248.2;
      g.transform(k, 0, 0, -k, -128 * k, 131.2 * k);
      g.fill(new Path2D(OCTOPUS));
    },
  },
  instagram: {
    depth: 0.16,
    round: 0.025,
    grow: 0,
    draw(g) {
      g.lineWidth = 0.1;
      g.beginPath();
      g.roundRect(-0.37, -0.37, 0.74, 0.74, 0.21);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 0.165, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0.2, 0.2, 0.06, 0, Math.PI * 2);
      g.fill();
    },
  },
  whatsapp: {
    depth: 0.16,
    round: 0.024,
    grow: 0,
    draw(g) {
      // the speech bubble: a ring with a tail at its lower left
      const r = 0.39;
      const cy = 0.025;
      const at = (deg) => [Math.cos((deg * Math.PI) / 180) * r, cy + Math.sin((deg * Math.PI) / 180) * r];
      g.beginPath();
      g.arc(0, cy, r, 0, Math.PI * 2);
      g.moveTo(...at(203));
      g.lineTo(-0.44, -0.44);
      g.lineTo(...at(247));
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(0, cy, r - 0.09, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      // the handset: a curved grip bowing to the lower left, from the earpiece
      // (upper left) to the mouthpiece (lower right), each a lump on the
      // grip's inner side
      const E = [-0.13, 0.155];
      const M = [0.155, -0.13];
      const C = [-0.245, -0.245];
      g.lineWidth = 0.085;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(...E);
      g.quadraticCurveTo(...C, ...M);
      g.stroke();
      for (const [end, ctrl] of [[E, C], [M, C]]) {
        const tx = end[0] - ctrl[0];
        const ty = end[1] - ctrl[1];
        const len = Math.hypot(tx, ty);
        let nx = -ty / len;
        let ny = tx / len;
        if (nx * -end[0] + ny * -end[1] < 0) [nx, ny] = [-nx, -ny]; // towards the bubble's middle
        g.save();
        g.translate(end[0] + nx * 0.036 - (tx / len) * 0.012, end[1] + ny * 0.036 - (ty / len) * 0.012);
        g.rotate(Math.atan2(ty, tx));
        g.beginPath();
        g.roundRect(-0.075, -0.075, 0.15, 0.15, 0.05);
        g.fill();
        g.restore();
      }
    },
  },
  email: {
    depth: 0.16,
    round: 0.024,
    grow: 0,
    draw(g) {
      g.lineWidth = 0.095;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      g.roundRect(-0.4, -0.27, 0.8, 0.54, 0.06);
      g.stroke();
      g.beginPath();
      g.moveTo(-0.35, 0.22);
      g.lineTo(0, -0.05);
      g.lineTo(0.35, 0.22);
      g.stroke();
    },
  },
};

const INF = 1e20;

// Felzenszwalb & Huttenlocher's 1D squared distance transform of f (n values)
// into d; v, z are scratch.
function edt1d(f, d, n, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    do {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Squared distance (pixels) from every pixel to the nearest pixel where
// feature[] is true, in place over grid (n x n).
function edt2d(grid, n) {
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = grid[y * n + x];
    edt1d(f, d, n, v, z);
    for (let y = 0; y < n; y++) grid[y * n + x] = d[y];
  }
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) f[x] = grid[row + x];
    edt1d(f, d, n, v, z);
    for (let x = 0; x < n; x++) grid[row + x] = d[x];
  }
}

function canvas(n) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(n, n);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

// The drawing's signed distance (volume units, negative inside) on an n x n
// grid over the front face, row 0 at the top.
function field2d(shape, n) {
  const c = canvas(n);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = g.strokeStyle = '#fff';
  g.setTransform(n, 0, 0, -n, n / 2, n / 2); // drawing space: -0.5..0.5, y up
  shape.draw(g);
  const px = g.getImageData(0, 0, n, n).data;
  const inside = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) inside[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  const toIn = new Float64Array(n * n); // outside pixels: distance to the shape
  const toOut = new Float64Array(n * n); // inside pixels: distance to the outside
  for (let i = 0; i < n * n; i++) {
    toIn[i] = inside[i] ? 0 : INF;
    toOut[i] = inside[i] ? INF : 0;
  }
  edt2d(toIn, n);
  edt2d(toOut, n);
  const sdf = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    // pixel centres: the edge lies half a pixel from the nearest pixel across it
    sdf[i] = (inside[i] ? -(Math.sqrt(toOut[i]) - 0.5) : Math.sqrt(toIn[i]) - 0.5) / n;
  }
  return sdf;
}

// The shape's signed distance at any point (volume units, centred): the
// drawing's 2D field (bilinear), thickened by grow, extruded and rounded.
function shapeField(shape, res = 512) {
  const sdf = field2d(shape, res);
  const h = shape.depth / 2;
  const r = shape.round;
  const grow = shape.grow ?? 0;
  return (x, y, z) => {
    const gx = Math.min(res - 1.001, Math.max(0, (x + 0.5) * res - 0.5));
    const gy = Math.min(res - 1.001, Math.max(0, (0.5 - y) * res - 0.5)); // row 0 at the top
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const i = y0 * res + x0;
    const top = sdf[i] + (sdf[i + 1] - sdf[i]) * fx;
    const bot = sdf[i + res] + (sdf[i + res + 1] - sdf[i + res]) * fx;
    // the rounded extrusion of the drawing: shrink it by r, extrude, round by r
    const wx = top + (bot - top) * (gy - y0) - grow + r;
    const wz = Math.abs(z) - (h - r);
    const ox = Math.max(wx, 0);
    const oz = Math.max(wz, 0);
    return Math.min(Math.max(wx, wz), 0) + Math.sqrt(ox * ox + oz * oz) - r;
  };
}

// The distance field as a size³ RGBA8 cube (x fastest, then y up, then z).
function volumeData(field, n) {
  const d3 = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) d3[(z * n + y) * n + x] = field((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5, (z + 0.5) / n - 0.5);
  const out = new Uint8Array(n * n * n * 4);
  const at = (x, y, z) => d3[(Math.min(n - 1, Math.max(0, z)) * n + Math.min(n - 1, Math.max(0, y))) * n + Math.min(n - 1, Math.max(0, x))];
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let gx = at(x + 1, y, z) - at(x - 1, y, z);
        let gy = at(x, y + 1, z) - at(x, y - 1, z);
        let gz = at(x, y, z + 1) - at(x, y, z - 1);
        const len = Math.hypot(gx, gy, gz) || 1;
        gx /= len;
        gy /= len;
        gz /= len;
        const i = ((z * n + y) * n + x) * 4;
        out[i] = Math.round((gx * 0.5 + 0.5) * 255);
        out[i + 1] = Math.round((gy * 0.5 + 0.5) * 255);
        out[i + 2] = Math.round((gz * 0.5 + 0.5) * 255);
        out[i + 3] = Math.round(Math.min(1, Math.max(0, (d3[(z * n + y) * n + x] + 2) / 4)) * 255);
      }
    }
  }
  return out;
}

// count points spread evenly over the shape's surface, in random order (the
// particles' homes; volume units, centred; w a random number), in a tex x tex
// RGBA float layout. Points drawn uniformly from a thin shell round the
// surface (from the cells it passes through) are uniform over its area; each
// is then moved onto the surface along the field's gradient.
function surfacePoints(field, count, tex, n = 64) {
  const cell = 1 / n;
  const cells = [];
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (Math.abs(field((x + 0.5) * cell - 0.5, (y + 0.5) * cell - 0.5, (z + 0.5) * cell - 0.5)) < cell * 0.9) cells.push(x, y, z);
  const cellCount = cells.length / 3;
  const shell = cell * 0.25;
  const e = cell * 0.25;
  const out = new Float32Array(tex * tex * 4);
  for (let k = 0, tries = 0; k < count && tries < count * 40; tries++) {
    const c = Math.floor(Math.random() * cellCount) * 3;
    let x = (cells[c] + Math.random()) * cell - 0.5;
    let y = (cells[c + 1] + Math.random()) * cell - 0.5;
    let z = (cells[c + 2] + Math.random()) * cell - 0.5;
    let d = field(x, y, z);
    if (Math.abs(d) > shell) continue;
    for (let it = 0; it < 2; it++) {
      const gx = field(x + e, y, z) - field(x - e, y, z);
      const gy = field(x, y + e, z) - field(x, y - e, z);
      const gz = field(x, y, z + e) - field(x, y, z - e);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
      if (g2 < 1e-6) break;
      const k2 = d / g2 / (2 * e);
      x -= gx * k2;
      y -= gy * k2;
      z -= gz * k2;
      d = field(x, y, z);
    }
    out.set([x, y, z, Math.random()], k * 4);
    k++;
  }
  return out;
}

// One shape: its distance field (size³ RGBA8) and count homes on its surface
// (a tex x tex RGBA float texture's data).
export function buildShape(name, { size = 64, count = 150000, tex = 388 } = {}) {
  const field = shapeField(SHAPES[name]);
  return { volume: volumeData(field, size), homes: surfacePoints(field, count, tex, size) };
}
