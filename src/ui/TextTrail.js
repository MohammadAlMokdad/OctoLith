// igloo's project text under the pointer (the "mouse sim" of its detail
// scene, ported to the CPU). Moving the pointer over a relic's page lights up
// the letters along its path and sends a ring of scrambled letters out from
// it that fades as it spreads. Driven by src/vault/VaultDetail.js while a page
// is open.
//
// The sim, as igloo's:
//   - every step each cell takes the largest of its 4 neighbours, so the
//     trail spreads one cell per step. They are read through a fixed noise
//     warp of up to one igloo cell (its advect texture), so the front ripples;
//   - the pointer's path since the last step is splatted in, wider the faster
//     the pointer moves (up to `radius` of the screen height);
//   - everything is damped (x `damping` per igloo step) and capped at 1.
//   r = a cell's value, g = how much it rose this step (the passing front).
// Per letter (igloo's text shader):
//   lit = fit(r, light[0], light[1]) mixes its colour toward `colors.pageLit`;
//   tr = fit(g, 0.01, 1, 0, scramble) shifts its glyph floor(tr * steps)
//   places along its row of the font atlas.
// igloo's cells are 5 device px stepped ~66 times a second. Here they are
// twice as big and stepped half as often: the same speed in px/s and the same
// fade per second, at a quarter of the cost. The grid only covers the text
// panel plus a margin, and nothing runs once the trail has faded.
import { shifted } from './scrambleText.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fit = (x, a, b) => clamp01((x - a) / (b - a));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const IGLOO_HZ = 66;

// '#RRGGBB' or 'rgb(r, g, b)' -> [r, g, b]
function parseRgb(css) {
  if (css.startsWith('#')) return [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
  const m = css.match(/[\d.]+/g) ?? [0, 0, 0];
  return m.slice(0, 3).map(Number);
}

export class TextTrail {
  constructor(panel, opts, light) {
    this.panel = panel;
    this.o = opts;
    this.light = parseRgb(light);
    this.on = false;
    this.lines = [];
    this.pointer = { x: -1e4, y: -1e4, moved: false };
    this.onMove = (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.moved = true;
    };
    this.onResize = () => this.on && this.layout();
    this.frame = (now) => this.tick(now);
  }

  // jobs: the page's text shows (scrambleText with keep: true).
  start(jobs) {
    this.stop();
    this.lines = jobs.map((job) => ({ job, base: null, slots: job.slots }));
    this.on = true;
    this.velocity = 0;
    this.target = 0;
    this.last = null;
    this.lastMove = 0;
    this.moving = 0;
    this.acc = 0;
    this.prevNow = null;
    this.awake = false;
    this.measured = false;
    addEventListener('pointermove', this.onMove, { passive: true });
    addEventListener('resize', this.onResize);
    this.raf = requestAnimationFrame(this.frame);
  }

  // A line's text was shown again (a link's hover replay, keep: true): follow
  // its new letters.
  retrack(job) {
    const line = this.on && this.lines.find((l) => l.job.el === job.el);
    if (!line) return;
    line.job = job;
    line.slots = job.slots;
    if (this.measured) this.measure(line, this.panel.scrollTop);
  }

  measure(line, scroll) {
    for (const p of line.slots) {
      const q = p.el.getBoundingClientRect();
      p.cx = q.left + q.width / 2;
      p.cy = q.top + q.height / 2 + scroll;
      p.lit = 0;
      p.tr = 0;
    }
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    cancelAnimationFrame(this.raf);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('resize', this.onResize);
    this.paint(true);
  }

  // The grid over the panel (+ margin), the warp, and every letter's place.
  layout() {
    const o = this.o;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const c = (this.cell = (2 * o.cell) / dpr); // CSS px per cell (2 igloo cells)
    this.stepTime = 2 / IGLOO_HZ;
    this.damp = o.damping ** 2;
    const r = this.panel.getBoundingClientRect();
    const m = o.margin;
    const W = (this.W = Math.ceil((r.width + 2 * m) / c) + 4);
    const H = (this.H = Math.ceil((r.height + 2 * m) / c) + 4);
    this.ox = r.left - m - 2 * c;
    this.oy = r.top - m - 2 * c;
    const n = W * H;
    this.a = new Float32Array(n);
    this.b = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.g = new Float32Array(n);
    this.base = new Int32Array(n);
    this.wx = new Float32Array(n);
    this.wy = new Float32Array(n);
    // igloo's advect: a noise flow over the screen (3 tiles across), up to one
    // of its cells (half of ours)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = ((this.ox + (x + 0.5) * c) / innerWidth) * 3;
        const v = ((this.oy + (y + 0.5) * c) / innerHeight) * 3;
        const ax = Math.sin(6.283 * (u + 0.37 * Math.sin(6.283 * v * 0.71 + 1.3))) * 0.5;
        const ay = Math.sin(6.283 * (v * 1.13 + 0.41 * Math.sin(6.283 * u * 0.83 + 4.1))) * 0.5;
        const sx = x + ax;
        const sy = y + ay;
        const bx = Math.min(W - 3, Math.max(1, Math.floor(sx)));
        const by = Math.min(H - 3, Math.max(1, Math.floor(sy)));
        const i = y * W + x;
        this.base[i] = by * W + bx;
        this.wx[i] = clamp01(sx - bx);
        this.wy[i] = clamp01(sy - by);
      }
    }
    // letters: centres in the panel's scrolled content
    const scroll = this.panel.scrollTop;
    for (const line of this.lines) {
      const el = line.slots[0]?.el.closest('[data-line]') ?? this.panel;
      line.base = parseRgb(getComputedStyle(el).color);
      this.measure(line, scroll);
    }
    this.measured = true;
  }

  // igloo's splat speed, per igloo step (dt ~ 1/66 s).
  speed(now, e) {
    if (e > 0) this.lastMove = now;
    if (now - this.lastMove > 0.15 || e > 0.3) {
      this.target = 0;
      e = 0;
    }
    this.target = clamp01((this.target + e * 6) * 0.88);
    const eased = 1 - (1 - this.target) ** 4; // power4.out
    this.velocity += (eased - this.velocity) * 0.1;
  }

  step(now) {
    const { W, H, a, b, prev, g, base, wx, wy, cell } = this;
    // pointer path since the last step, and how fast it went
    const p = { x: this.pointer.x, y: this.pointer.y };
    const last = this.last ?? p;
    const e = Math.hypot((p.x - last.x) / innerWidth, (p.y - last.y) / innerHeight);
    this.speed(now, e / 2);
    this.speed(now, e / 2);
    const radius = this.o.radius * innerHeight * smooth(0.1, 1, this.velocity); // px
    this.last = p;

    let peak = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1, i = y * W + 1; x < W - 1; x++, i++) {
        const q = base[i];
        const fx = wx[i];
        const fy = wy[i];
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        // bilinear reads at the warped spot and one cell left / right / up / down
        const l = q - 1;
        const r = q + 1;
        const t = q - W;
        const d = q + W;
        prev[i] = a[q] * w00 + a[q + 1] * w10 + a[q + W] * w01 + a[q + W + 1] * w11;
        const vl = a[l] * w00 + a[l + 1] * w10 + a[l + W] * w01 + a[l + W + 1] * w11;
        const vr = a[r] * w00 + a[r + 1] * w10 + a[r + W] * w01 + a[r + W + 1] * w11;
        const vt = a[t] * w00 + a[t + 1] * w10 + a[t + W] * w01 + a[t + W + 1] * w11;
        const vd = a[d] * w00 + a[d + 1] * w10 + a[d + W] * w01 + a[d + W + 1] * w11;
        b[i] = Math.max(vl, vr, vt, vd);
      }
    }
    // splat the segment last -> p (cubic falloff over the radius)
    if (radius > 0.5) {
      const ax = (last.x - this.ox) / cell - 0.5;
      const ay = (last.y - this.oy) / cell - 0.5;
      const bx = (p.x - this.ox) / cell - 0.5;
      const by = (p.y - this.oy) / cell - 0.5;
      const R = radius / cell;
      const x0 = Math.max(1, Math.floor(Math.min(ax, bx) - R));
      const x1 = Math.min(W - 2, Math.ceil(Math.max(ax, bx) + R));
      const y0 = Math.max(1, Math.floor(Math.min(ay, by) - R));
      const y1 = Math.min(H - 2, Math.ceil(Math.max(ay, by) + R));
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const h = clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
          const d = Math.hypot(x - ax - dx * h, y - ay - dy * h);
          const k = clamp01(1 - d / R);
          b[y * W + x] += k * k * k;
        }
      }
    }
    for (let i = 0; i < a.length; i++) {
      const v = Math.min(b[i] * this.damp, 1);
      g[i] = v - prev[i];
      b[i] = v;
      if (v > peak) peak = v;
    }
    this.a = b;
    this.b = a;
    return peak;
  }

  sample(arr, x, y) {
    const gx = (x - this.ox) / this.cell - 0.5;
    const gy = (y - this.oy) / this.cell - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    if (ix < 0 || iy < 0 || ix >= this.W - 1 || iy >= this.H - 1) return 0;
    const fx = gx - ix;
    const fy = gy - iy;
    const k = iy * this.W + ix;
    return (
      arr[k] * (1 - fx) * (1 - fy) + arr[k + 1] * fx * (1 - fy) + arr[k + this.W] * (1 - fx) * fy + arr[k + this.W + 1] * fx * fy
    );
  }

  // Letters from the field (reset: everything back to plain).
  paint(reset = false) {
    const o = this.o;
    const scroll = this.panel.scrollTop;
    for (const line of this.lines) {
      const { job } = line;
      for (const p of line.slots) {
        let lit = 0;
        let tr = 0;
        if (!reset && p.cx !== undefined) {
          const y = p.cy - scroll;
          lit = Math.round(fit(this.sample(this.a, p.cx, y), o.light[0], o.light[1]) * 10) / 10;
          tr = fit(this.sample(this.g, p.cx, y), 0.01, 1) * o.scramble;
        }
        p.tr = tr;
        if (lit !== p.lit) {
          p.lit = lit;
          const c = line.base;
          const L = this.light;
          p.el.style.color = lit
            ? `rgb(${c.map((v, j) => Math.round(v + (L[j] - v) * lit)).join(',')})`
            : '';
        }
        if (!job.running) {
          const glyph = shifted(p.ch, Math.floor(tr * job.steps) % 8);
          if (glyph !== p.glyph) p.el.textContent = p.glyph = glyph;
        }
      }
    }
  }

  tick(now) {
    if (!this.on) return;
    this.raf = requestAnimationFrame(this.frame);
    const t = now / 1000;
    if (!this.measured) this.layout();
    const dt = this.prevNow === null ? 0 : Math.min(0.1, t - this.prevNow);
    this.prevNow = t;
    if (this.pointer.moved) {
      this.pointer.moved = false;
      this.awake = true;
      this.moving = t;
    }
    if (!this.awake) return;
    this.acc += dt;
    let peak = -1;
    for (let n = 0; this.acc >= this.stepTime && n < 3; n++) {
      this.acc -= this.stepTime;
      peak = this.step(t);
    }
    if (this.acc > this.stepTime) this.acc = 0;
    if (peak < 0) return;
    this.paint();
    // faded out and the pointer resting: sleep until it moves again
    if (peak < 0.004 && t - this.moving > 0.3) {
      this.a.fill(0);
      this.g.fill(0);
      this.paint();
      this.awake = false;
    }
  }
}
