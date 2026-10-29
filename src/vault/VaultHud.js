// Labels around the centred crystal (igloo's cube texts + plexus): the title
// up-left with a leader line to the crystal, a live TEMP readout on the right,
// the date at the bottom right, and faint lines between points on the
// crystal's outline. Real DOM text (the copy is in index.html) over the
// canvas, placed each frame from the crystal projected to the screen. A
// label set scrambles in when its crystal centres and fades as it scrolls away.
import { Box3, Vector3 } from 'three';
import { scrambleText } from '../ui/scrambleText.js';

const PLEXUS_POINTS = 9;
const EDGE = 14; // px the labels keep from the screen's edges (they'd hang off a phone's)

export class VaultHud {
  constructor(root, vault) {
    this.root = root;
    this.vault = vault;
    this.svg = root.querySelector('.vault-hud__lines');
    // touch screens: the copy's touch wording (data-touch), e.g. TAP TO EXPLORE
    if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
      for (const s of root.querySelectorAll('[data-touch]')) s.textContent = s.dataset.touch;
    }
    this.items = [...root.querySelectorAll('.relic')].map((el) => {
      const num = el.querySelector('[data-temp]');
      return {
        el,
        title: el.querySelector('.relic__title'),
        temp: el.querySelector('.relic__temp'),
        date: el.querySelector('.relic__date'),
        num,
        delta: el.querySelector('[data-delta]'),
        base: parseFloat(num?.textContent) || 45,
        last: 0,
        text: new Map([...el.querySelectorAll('[data-scramble]')].map((s) => [s, s.textContent])),
      };
    });
    this.pool = [];
    this.focused = -1;
    this.v = new Vector3();
    this.suppressed = false; // a relic's page is open: no labels
  }

  line(i) {
    while (this.pool.length <= i) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this.svg.appendChild(l);
      this.pool.push(l);
    }
    return this.pool[i];
  }

  // Corners of the crystal's bounds and a spread of points on its surface,
  // both in the crystal's own space (picked once, when it is first shown).
  points(c) {
    if (c.hudPoints) return c.hudPoints;
    const pos = c.crystal.geometry.attributes.position;
    const box = new Box3().setFromBufferAttribute(pos);
    const centre = box.getCenter(new Vector3());
    // farthest-point sampling over the vertices: an even spread over the outline
    const picks = [];
    const p = new Vector3();
    let best = 0;
    for (let i = 0; i < pos.count; i++) if (p.fromBufferAttribute(pos, i).distanceTo(centre) > best) {
      best = p.distanceTo(centre);
      picks[0] = i;
    }
    while (picks.length < PLEXUS_POINTS) {
      let far = -1;
      let farD = -1;
      for (let i = 0; i < pos.count; i += 3) {
        p.fromBufferAttribute(pos, i);
        let d = Infinity;
        for (const k of picks) d = Math.min(d, p.distanceToSquared(new Vector3().fromBufferAttribute(pos, k)));
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
      picks.push(far);
    }
    c.hudPoints = picks.map((i) => new Vector3().fromBufferAttribute(pos, i));
    return c.hudPoints;
  }

  // To the canvas's pixels (on phones it is the large viewport's height,
  // taller than the window while the toolbar shows: both start at the top).
  project(p, matrix) {
    const v = this.v.copy(p).applyMatrix4(matrix).project(this.vault.camera);
    const [w, h] = this.vault.size ?? [innerWidth, innerHeight];
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
  }

  // visible: section 2 is on screen and clear of the storm.
  update(time, { visible }) {
    const crystals = this.vault.crystals;
    let focus = -1;
    let amount = 0;
    if (visible && !this.suppressed) {
      crystals.forEach((c, i) => {
        if (c.focus > amount) {
          amount = c.focus;
          focus = i;
        }
      });
    }
    if (focus !== this.focused) {
      this.items[this.focused]?.el.classList.remove('is-focused');
      this.focused = focus;
      const item = this.items[focus];
      if (item) {
        item.el.classList.add('is-focused');
        let k = 0;
        for (const [el, text] of item.text) scrambleText(el, text, { delay: 60 + k++ * 70 });
      }
    }
    let used = 0;
    const item = this.items[focus];
    if (item && crystals[focus]) {
      const c = crystals[focus];
      const ease = amount * amount * (3 - 2 * amount);
      item.el.style.opacity = ease.toFixed(3);
      const m = c.crystal.matrixWorld;
      const pts = this.points(c).map((p) => this.project(p, m));
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const nearest = (x, y) => pts.reduce((b, q) => (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? q : b));
      // each label kept on screen (narrow phones), its lines following it
      const W = innerWidth;
      const H = innerHeight;
      const fitX = (x, w) => Math.min(Math.max(x, EDGE), W - w - EDGE);
      const fitY = (y, h) => Math.min(Math.max(y, EDGE), H - h - EDGE);
      const place = (el, x, y) => (el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`);
      const lineTo = (a, b, alpha) => {
        const l = this.line(used++);
        l.setAttribute('x1', a[0].toFixed(1));
        l.setAttribute('y1', a[1].toFixed(1));
        l.setAttribute('x2', b[0].toFixed(1));
        l.setAttribute('y2', b[1].toFixed(1));
        l.style.opacity = (alpha * ease).toFixed(3);
      };
      // title: up and left of the crystal, its underside joined to the nearest point
      const tw = item.title.offsetWidth;
      const th = item.title.offsetHeight;
      const tx = fitX(minX - tw * 0.45, tw);
      const ty = fitY(minY - th - 28, th);
      place(item.title, tx, ty);
      lineTo([tx, ty + th + 6], [tx + tw, ty + th + 6], 0.9);
      lineTo([tx + tw, ty + th + 6], nearest(tx + tw, ty + th + 6), 0.6);
      // temperature: right of the crystal, a third of the way down
      const rx = fitX(maxX + 24, item.temp.offsetWidth);
      const ry = fitY(minY + (maxY - minY) * 0.22, item.temp.offsetHeight);
      place(item.temp, rx, ry);
      lineTo([rx - 6, ry + 8], nearest(rx - 6, ry + 8), 0.45);
      // date: bottom right, underlined, joined to the nearest point
      const dw = item.date.offsetWidth;
      const dh = item.date.offsetHeight;
      const dx = fitX(maxX - dw * 0.35, dw);
      const dy = fitY(maxY - dh * 0.4, dh);
      place(item.date, dx, dy);
      lineTo([dx, dy + dh], nearest(dx, dy + dh), 0.45);
      // plexus: each point to its two nearest neighbours
      pts.forEach((a, i) => {
        const near = pts
          .map((b, j) => [j, Math.hypot(b[0] - a[0], b[1] - a[1])])
          .filter(([j]) => j > i)
          .sort((x, y) => x[1] - y[1])
          .slice(0, 2);
        for (const [j] of near) lineTo(a, pts[j], 0.18);
      });
      // live readout, a few times a second
      if (time - item.last > 0.12 && item.num) {
        const prev = parseFloat(item.num.textContent);
        const t = item.base + Math.sin(time * 0.7 + focus) * 0.6 + Math.sin(time * 2.3) * 0.08;
        const d = t - prev;
        item.num.textContent = t.toFixed(2);
        item.delta.textContent = `${d >= 0 ? '+' : '-'}${Math.abs(d * 10).toFixed(2).padStart(5, '0')}`;
        item.last = time;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.opacity = '0';
  }
}
