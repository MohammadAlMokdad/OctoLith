// scrambleText(el, finalText, opts): igloo's text "show" (its MSDF text
// shader, ported to DOM). Two fronts run left -> right over the whole text,
// both sine.out; character i of n sits at x = i / (n - 1), so a long
// paragraph takes as long as a short label:
//   sweep   (s) the fade front: each character fades in over the last tenth
//           of the way (igloo uShow1: alpha = clamp((1.1 s1 - x) / 0.1));
//   settle  (s) each character starts up to 5 places along its row of 8 in
//           igloo's font atlas and steps back to itself as the second front
//           passes (uShow2: shift = floor((1 - clamp(2 s2 - x)) * 5.753)).
// The defaults are igloo's intro text (0.4 s / 0.75 s); hovers replay it
// faster (0.2 / 0.375 s). Layout never shifts: the font is monospace and
// every character keeps its slot; words don't break mid-animation.
//
// The final text stays available to screen readers: it is written into a
// visually hidden span, while the animated characters live in an
// aria-hidden span. Starting a new show on an element replaces the old one.
//
// keep: true leaves the per-character spans in place after the show, for
// src/ui/TextTrail.js (the relic pages' pointer trail) to drive. Each slot's
// `tr` is the trail's extra shift, added in during the show like igloo's
// floor((1 - tr2 + tr) * steps).
const active = new Set();
const jobs = new WeakMap(); // el -> its running job
const texts = new WeakMap(); // el -> its final text
let raf = 0;

function loop(now) {
  for (const job of active) job.step(now);
  raf = active.size ? requestAnimationFrame(loop) : 0;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sineOut = (x) => Math.sin((clamp01(x) * Math.PI) / 2);
const isBlank = (ch) => /\s/.test(ch);

// The glyph k places along ch's row of 8 in igloo's atlas (rows start at
// '"', so e.g. 'n' + 4 wraps round to 'j'); printable ASCII only.
export function shifted(ch, k) {
  const code = ch.charCodeAt(0);
  if (!k || code < 33 || code > 126) return ch;
  const col = (code - 2) & 7;
  let c = code - col + ((col + k) & 7);
  if (c > 126) c -= 8;
  if (c < 33) c += 8;
  return String.fromCharCode(c);
}

// The text an element animates to (what scrambleText last wrote into it).
export function textOf(el) {
  return texts.get(el) ?? el.textContent.replace(/\s+/g, ' ').trim();
}

export function scrambleText(el, finalText = textOf(el), opts = {}) {
  const {
    sweep = 0.4, // s: the fade front crosses the text
    settle = 0.75, // s: the glyph front crosses the text
    delay = 0, // ms
    keep = false, // keep the per-character spans afterwards (TextTrail)
    steps = 5.753, // glyph shift scale (igloo: 5.753, its project text 5.654)
  } = opts;

  jobs.get(el)?.cancel();
  texts.set(el, finalText);

  // Accessible structure: hidden real text + aria-hidden live text.
  el.textContent = '';
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = finalText;
  const live = document.createElement('span');
  live.className = 'scramble__live';
  live.setAttribute('aria-hidden', 'true');
  el.append(sr, live);

  // One span per character, grouped into unbreakable words.
  const chars = [...finalText];
  const n = chars.length;
  const slots = [];
  let word = null;
  chars.forEach((ch, i) => {
    if (isBlank(ch)) {
      live.append(ch);
      word = null;
      return;
    }
    if (!word) {
      word = document.createElement('span');
      word.className = 'scramble__word';
      live.append(word);
    }
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.opacity = '0';
    word.append(s);
    slots.push({ el: s, ch, x: n > 1 ? i / (n - 1) : 0, glyph: ch, alpha: 0, tr: 0 });
  });

  let t0 = null;
  const end = Math.max(sweep, settle);

  const job = {
    step(now) {
      if (t0 === null) t0 = now + delay;
      const t = (now - t0) / 1000;
      if (t < 0) return;
      if (t >= end) return job.finish();
      const s1 = 1.1 * sineOut(t / sweep);
      const s2 = 2 * sineOut(t / settle);
      for (const p of slots) {
        const alpha = Math.round(clamp01((s1 - p.x) / 0.1) * 20) / 20;
        const k = Math.floor((1 - clamp01(s2 - p.x) + p.tr) * steps) % 8;
        const glyph = shifted(p.ch, k);
        if (alpha !== p.alpha) p.el.style.opacity = String((p.alpha = alpha));
        if (glyph !== p.glyph) p.el.textContent = p.glyph = glyph;
      }
    },
    // Show the final text immediately (skip / reduced motion / done).
    finish() {
      if (!active.has(job)) return;
      job.cancel();
      if (keep) {
        for (const p of slots) {
          p.el.style.opacity = '';
          p.alpha = 1;
          p.el.textContent = p.glyph = p.ch;
        }
      } else live.textContent = finalText;
    },
    // Stop without settling (a new show on the same element takes over).
    cancel() {
      active.delete(job);
      job.running = false;
      if (jobs.get(el) === job) jobs.delete(el);
    },
    running: true,
    el,
    slots,
    steps,
  };

  jobs.set(el, job);
  active.add(job);
  if (!raf) raf = requestAnimationFrame(loop);
  return job;
}

// Replay an element's show (igloo's hover: show(0.5) = 0.2 s / 0.375 s).
export function replayText(el, opts = {}) {
  return scrambleText(el, textOf(el), { sweep: 0.2, settle: 0.375, ...opts });
}
