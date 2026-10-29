// igloo's logo / Close-box "show" (its MSDF logo shader, ported to DOM), and
// the copyright lines' blink.
//
// glitch(el): over `duration` s the picture is cut into blocks that jump
// sideways, re-randomised `steps` times (igloo: 3 steps, up to `amount` of
// the width), while the whole element flickers like a weak TV signal,
// alpha * (0.85 + 0.15 sin(30 s + r)), invisible for the first 1 %. A glow
// (a CSS filter on the element) flickers with it. The blocks are clipped
// clones of the element laid over it while it plays (aria-hidden); the
// element's content is hidden meanwhile (and the element itself with
// `self`, when its picture is its own background).
//
// blink(el): igloo's uBlink, 5 hard on/off steps (alpha low <-> 1) over
// `duration` s.
//
// flicker(el): the glitch's flicker alone (igloo's icons: deeper,
// alpha * (0.6 + 0.4 sin(30 s + r))), for things that can't be cloned (SVG).
//
// Both write the alpha to the element's --blink (registered as not inherited
// in ui.css); the CSS multiplies it into the element's opacity.
import gsap from 'gsap';

const states = new WeakMap();

// alpha * (1 - depth + depth sin(30 s + r)), nothing for the first 1 %
const flickerAlpha = (s, rand, depth) =>
  s < 0.01 ? '0' : (Math.sin(s * 30 + rand * 12.4242) * depth + 1 - depth).toFixed(3);

function layer(el) {
  let st = states.get(el);
  if (!st) {
    const root = document.createElement('span');
    root.className = 'glitch';
    root.setAttribute('aria-hidden', 'true');
    st = { root, cells: [], tween: null, html: '' };
    states.set(el, st);
  }
  return st;
}

// Blocks: rows of random height, each cut into 1-3 pieces; most pieces move.
function cutBlocks(w, h, rows, amp) {
  const blocks = [];
  for (let y = 0; y < h; ) {
    const bh = Math.min(h - y, rows[0] + Math.random() * (rows[1] - rows[0]));
    const pieces = 1 + Math.floor(Math.random() * 3);
    const cuts = [0, ...Array.from({ length: pieces - 1 }, () => Math.random() * w).sort((a, b) => a - b), w];
    for (let i = 0; i < pieces; i++) {
      const dx = Math.random() < 0.25 ? 0 : (Math.random() * 2 - 1) * amp;
      blocks.push({ x0: cuts[i], x1: cuts[i + 1], y0: y, y1: y + bh, dx });
    }
    y += bh;
  }
  return blocks;
}

export function glitch(el, opts = {}) {
  const {
    duration = 0.25, // s (igloo: 0.25 on hover, 0.5 on the intro)
    delay = 0, // s
    steps = 3, // block layouts per run
    amount = 0.0075, // max shift, fraction of the width (igloo's logo; its Close box: 0.025)
    rows = [0.1, 0.25], // block heights, fraction of the height
    self = false, // the picture is the element's own background: hide it too
  } = opts;
  if (!el) return null;
  const st = layer(el);
  st.tween?.kill();
  const rand = Math.random();
  const p = { s: 0 };
  let step = -1;

  const draw = () => {
    const s = p.s;
    el.style.setProperty('--blink', flickerAlpha(s, rand, 0.15));
    const k = Math.min(steps - 1, Math.floor(s * steps));
    if (k === step) return;
    step = k;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const blocks = cutBlocks(w, h, [rows[0] * h, rows[1] * h], amount * w);
    const cls = el.getAttribute('class').replace(/\bis-(glitching-self|glitching|shown)\b/g, '') + ' glitch__cell';
    while (st.cells.length < blocks.length) {
      const c = document.createElement('span');
      st.root.append(c);
      st.cells.push(c);
    }
    st.cells.forEach((c, i) => {
      const b = blocks[i];
      c.hidden = !b;
      if (!b) return;
      c.className = cls;
      if (c.innerHTML !== st.html) c.innerHTML = st.html;
      c.style.clipPath = `inset(${b.y0.toFixed(1)}px ${(w - b.x1).toFixed(1)}px ${(h - b.y1).toFixed(1)}px ${b.x0.toFixed(1)}px)`;
      c.style.transform = `translateX(${b.dx.toFixed(2)}px)`;
    });
  };

  const start = () => {
    // clone the element's current content (not the glitch layer itself)
    st.root.remove();
    st.html = el.innerHTML;
    el.append(st.root);
    el.classList.add('is-glitching');
    if (self) el.classList.add('is-glitching-self');
    step = -1;
    draw();
  };
  const stop = () => {
    el.classList.remove('is-glitching', 'is-glitching-self');
    el.style.removeProperty('--blink');
    st.root.remove();
    st.tween = null;
  };

  el.style.setProperty('--blink', '0');
  st.tween = gsap.fromTo(
    p,
    { s: 0 },
    { s: 1, duration, delay, ease: 'none', immediateRender: false, onStart: start, onUpdate: draw, onComplete: stop },
  );
  return st.tween;
}

const blinks = new WeakMap();

export function flicker(el, { duration = 0.5, delay = 0, depth = 0.4 } = {}) {
  if (!el) return null;
  blinks.get(el)?.kill();
  const rand = Math.random();
  const p = { s: 0 };
  const tween = gsap.fromTo(
    p,
    { s: 0 },
    {
      s: 1,
      duration,
      delay,
      ease: 'none',
      immediateRender: false,
      onUpdate: () => el.style.setProperty('--blink', flickerAlpha(p.s, rand, depth)),
      onComplete: () => el.style.removeProperty('--blink'),
    },
  );
  blinks.set(el, tween);
  return tween;
}

export function blink(el, { duration = 0.1, delay = 0, low = 0.3 } = {}) {
  if (!el) return null;
  blinks.get(el)?.kill();
  const p = { b: 0 };
  const tween = gsap.fromTo(
    p,
    { b: 0 },
    {
      b: 1,
      duration,
      delay,
      ease: 'none',
      immediateRender: false,
      onUpdate: () => el.style.setProperty('--blink', String(low + (1 - low) * (Math.floor(p.b * 5) % 2))),
      onComplete: () => el.style.removeProperty('--blink'),
    },
  );
  blinks.set(el, tween);
  return tween;
}
