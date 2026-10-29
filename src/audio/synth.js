// The site's sound effects, synthesized. They are igloo.inc's set re-made
// from measurements of its files (their length, rhythm, pitch, band balance
// and loudness; the files themselves aren't ours to ship): soft digital UI
// noise, data bleeps, teletype ticks, whooshes for the relic pages, and the
// ambient loops (desert room tone, wind, the ring drone, the hover hum, the
// particles' hiss, the crystal's crackle).
//
// Pure functions: each returns mono Float32Array samples at SR, with no Web
// Audio involved, so tools can render and measure them too. Every sound is
// normalized to its igloo counterpart's level (`peak`: the loudest 10 ms, in
// dBFS; `rms`: the loops' overall level), so igloo's mixer volumes apply
// unchanged (Sound.js). Loops are seamless (integer LFO cycles, crossfaded
// noise).
export const SR = 44100;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const samples = (s) => Math.round(s * SR);

function noise(n, r) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  return x;
}

// RBJ biquad (lowpass / highpass / bandpass with 0 dB peak / peaking EQ).
function biquad(x, type, f0, q = 0.707, gainDb = 0) {
  const w = (TAU * f0) / SR;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') [b0, b1, b2, a0, a1, a2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al];
  else if (type === 'hp') [b0, b1, b2, a0, a1, a2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al];
  else if (type === 'bp') [b0, b1, b2, a0, a1, a2] = [al, 0, -al, 1 + al, -2 * cw, 1 - al];
  else [b0, b1, b2, a0, a1, a2] = [1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A];
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

// a one-pole lowpass whose cutoff follows f(i) (Hz), for sweeps
function sweepLp(x, f) {
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const k = 1 - Math.exp((-TAU * f(i)) / SR);
    s += (x[i] - s) * k;
    y[i] = s;
  }
  return y;
}

// n cascaded 2-pole lowpasses (steep: for rumbles that mustn't leak highs)
function lowpass(x, f, n = 2) {
  for (let k = 0; k < n; k++) x = biquad(x, 'lp', f, 0.707);
  return x;
}

// random steps of gain every `step` s between lo and 1 (a granular stutter)
function stutter(x, step, lo, r) {
  const m = Math.max(1, samples(step));
  let g = 1;
  for (let i = 0; i < x.length; i++) {
    if (i % m === 0) g = lo + (1 - lo) * r();
    x[i] *= g;
  }
  return x;
}

// a block of data: noise with short tone dots at random high pitches
function dataBlock(dur, r, tones, { hp = 5000, dots = 6, noiseGain = 0.5 } = {}) {
  const x = grain(dur, r, hp);
  scale(x, noiseGain);
  for (let k = 0; k < dots; k++) {
    const d = 0.006 + r() * 0.008;
    mix(x, blip(tones[Math.floor(r() * tones.length)], d, r, { attack: 0.001, release: 0.002 }), samples(r() * Math.max(0, dur - d)), 0.6 + r() * 0.4);
  }
  return x;
}

function mix(into, x, at = 0, gain = 1) {
  for (let i = 0; i < x.length && at + i < into.length; i++) into[at + i] += x[i] * gain;
  return into;
}

const smooth = (t) => t * t * (3 - 2 * t);

// level matching
function peak10(x) {
  const h = samples(0.01);
  let best = 0;
  for (let i = 0; i + h <= x.length; i += h) {
    let s = 0;
    for (let j = i; j < i + h; j++) s += x[j] * x[j];
    best = Math.max(best, s / h);
  }
  return Math.sqrt(best);
}
function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}
function scale(x, k) {
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}
const toPeak = (x, db) => scale(x, 10 ** (db / 20) / (peak10(x) || 1));
const toRms = (x, db) => scale(x, 10 ** (db / 20) / (rms(x) || 1));

// A seamless loop of length L s from a generator of length L + X: the extra X
// s crossfade into the start.
function loopify(make, L, X) {
  const n = samples(L);
  const m = samples(X);
  const x = make(n + m);
  const out = x.slice(0, n);
  for (let i = 0; i < m; i++) {
    const t = i / m;
    out[i] = x[i] * Math.sqrt(t) + x[n + i] * Math.sqrt(1 - t);
  }
  return out;
}

// a short sine blip with a quick fade at each end
function blip(f, dur, r, { attack = 0.002, release = 0.004, decay = 0 } = {}) {
  const n = samples(dur);
  const x = new Float32Array(n);
  const ph = r() * TAU;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let e = Math.min(1, t / attack, (dur - t) / release);
    if (decay) e *= Math.exp(-t / decay);
    x[i] = Math.sin(ph + TAU * f * t) * Math.max(0, e);
  }
  return x;
}

// a burst of noise, highpassed, with a quick fade at each end
function grain(dur, r, hp = 4000) {
  const n = Math.max(8, samples(dur));
  const x = biquad(noise(n, r), 'hp', hp, 0.7);
  const f = Math.max(1, samples(0.0015));
  for (let i = 0; i < n; i++) x[i] *= Math.min(1, i / f, (n - i) / f);
  return x;
}

// ---------------------------------------------------------------- one-shots

// UI show / hover (igloo's ui-short 0.30 s, ui-long 0.49 s): a soft breath of
// bright digital noise (mostly 6-22 kHz), fluttering, with a faint tone.
function uiNoise(dur, attack, release, seed, db) {
  const r = rng(seed);
  const n = samples(dur);
  let x = biquad(noise(n, r), 'hp', 2500, 0.6);
  x = biquad(x, 'pk', 9500, 0.8, 6);
  const tone = blip(9350, dur, r, { attack: 0.02, release: 0.02 });
  const mid = biquad(noise(n, r), 'bp', 1200, 0.7);
  stutter(x, 0.018, 0.35, r);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = smooth(Math.min(1, t / attack)) * smooth(Math.min(1, (dur - t) / release));
    x[i] = (x[i] + mid[i] * 0.12 + tone[i] * 0.08) * env;
  }
  return toPeak(x, db);
}

// igloo's logo.ogg: 8 tiny glitch grains over 0.35 s.
function logo() {
  const r = rng(11);
  const x = new Float32Array(samples(0.6));
  let t = 0.1;
  for (let k = 0; k < 8; k++) {
    const d = 0.025 + r() * 0.03;
    const g = grain(d, r, 3500);
    stutter(g, 0.004, 0.2, r);
    mix(x, g, samples(t), 0.6 + r() * 0.4);
    if (r() < 0.5) mix(x, blip(9330, d, r), samples(t), 0.2);
    t += d + 0.002 + r() * 0.006;
  }
  return toPeak(x, -40.1);
}

// igloo's beeps (three variants): 10-12 high data bleeps, 18-70 ms, 44-74 ms
// apart, ~9.3 / 13.4 / 9.0 kHz, over a thin hiss.
function beeps(variant) {
  const r = rng(100 + variant);
  const x = new Float32Array(samples(0.92));
  const spec = [
    { count: 12, gap: 0.06, rest: 0 },
    { count: 12, gap: 0.044, rest: 0.33 },
    { count: 10, gap: 0.074, rest: 0 },
  ][variant - 1];
  const notes = [8960, 9320, 10200, 12300, 13390, 14600];
  let t = 0.022;
  for (let k = 0; k < spec.count && t < 0.86; k++) {
    const d = Math.min(0.9 - t, (r() < 0.3 ? 0.09 : 0.04) + r() * 0.04);
    mix(x, dataBlock(d, r, notes, { hp: 6000, dots: Math.round(d / 0.012), noiseGain: 0.35 }), samples(t));
    t += d + 0.004 + r() * 0.012;
    if (spec.rest && r() < spec.rest) t += 0.06 + r() * 0.1;
  }
  return toPeak(x, [-35.3, -30.6, -30.6][variant - 1]);
}

// igloo's manifesto.ogg: a teletype run, 19 ticks of ~11.8 kHz, 54 ms apart.
function manifesto() {
  const r = rng(21);
  const x = new Float32Array(samples(1.05));
  for (let k = 0; k < 19; k++) {
    const f = r() < 0.08 ? 6460 : 11760 + r() * 80;
    const at = samples(0.006 + k * 0.054);
    const g = 0.7 + r() * 0.3;
    mix(x, blip(f, 0.005, r, { attack: 0.0003, release: 0.001, decay: 0.0015 }), at, g);
    mix(x, blip(f * 1.19, 0.004, r, { attack: 0.0003, release: 0.001, decay: 0.001 }), at, g * 0.5);
    mix(x, grain(0.003, r, 7000), at, g * 0.45);
  }
  return toPeak(x, -25.2);
}

// igloo's project-text.ogg: a page of text typing in, 25 grains 40 ms apart,
// noise and high tones.
function projectText() {
  const r = rng(31);
  const x = new Float32Array(samples(1.14));
  const tones = [11760, 11970, 12900, 13950, 15200];
  let t = 0.048;
  for (let b = 0; b < 4; b++) {
    const d = 0.17 + r() * 0.07;
    const block = dataBlock(d, r, tones, { hp: 4000, dots: 14, noiseGain: 0.45 });
    stutter(block, 0.016, 0.3, r);
    mix(x, block, samples(t));
    t += d + 0.02 + r() * 0.04;
  }
  return toPeak(x, -30.8);
}

// igloo's click-project.ogg: a click, three high pings and a 3.1 kHz ring.
function clickProject() {
  const r = rng(41);
  const x = new Float32Array(samples(1.55));
  mix(x, grain(0.003, r, 1000), samples(0.016), 1);
  mix(x, blip(9345, 0.03, r), samples(0.016), 0.5);
  mix(x, blip(8247, 0.03, r), samples(0.062), 0.45);
  mix(x, blip(9345, 0.025, r), samples(0.108), 0.4);
  for (const [f, a, dec] of [[3100, 0.55, 0.14], [4650, 0.25, 0.1], [6200, 0.2, 0.09], [7750, 0.12, 0.07], [9300, 0.1, 0.06]]) {
    mix(x, blip(f, 0.7, r, { attack: 0.001, release: 0.05, decay: dec }), samples(0.016), a);
  }
  const tail = biquad(noise(samples(0.7), r), 'hp', 4000, 0.7);
  for (let i = 0; i < tail.length; i++) tail[i] *= 0.012 * Math.exp(-i / SR / 0.15);
  mix(x, tail, samples(0.02));
  return toPeak(x, -25.5);
}

// a low swell: rumble (lowpassed noise, cutoff following the swell) and
// partials of ~53.7 Hz, rising for `attack` s to the peak, then decaying
function swell(dur, attack, decay, seed, partials) {
  const r = rng(seed);
  const n = samples(dur);
  const env = (t) => (t < attack ? smooth(t / attack) : Math.exp(-(t - attack) / decay));
  const cut = (i) => 80 + 260 * env(i / SR);
  const x = sweepLp(sweepLp(sweepLp(noise(n, r), cut), cut), cut);
  const ph = partials.map(() => r() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = x[i] * 3;
    partials.forEach(([f, a], k) => (s += Math.sin(ph[k] + TAU * f * t) * a));
    x[i] = s * env(t);
  }
  return { x, r, env };
}

// igloo's enter-project.ogg: the relic page opens, a 1.1 s rising swell.
function enterProject() {
  const { x, r, env } = swell(4.33, 1.1, 0.6, 51, [[107.4, 0.5], [161.1, 0.35], [214.8, 0.25], [268.5, 0.12]]);
  // data rising into the open: steps of texture climbing from ~1 to ~6 kHz
  for (let k = 0; k < 10; k++) {
    const g = biquad(grain(0.07, r, 300), 'bp', 1000 * 1.2 ** k, 1.2);
    mix(x, g, samples(0.35 + k * 0.075), 0.08 * (0.5 + k / 10));
  }
  return toPeak(x, -15.6);
}

// igloo's leave-project.ogg: the page closes, a shorter swell with a bright
// swish on top.
function leaveProject() {
  const { x, r, env } = swell(2.22, 0.5, 0.35, 61, [[107.4, 0.35], [150.4, 0.25], [204, 0.18]]);
  // a block of data texture as it shuts, and a thin 5.2 kHz line
  const block = dataBlock(0.5, r, [6100, 7400, 8800], { hp: 2500, dots: 20, noiseGain: 0.3 });
  stutter(block, 0.02, 0.3, r);
  mix(x, block, samples(0.15), 0.09);
  mix(x, blip(5221, 1.8, r, { attack: 0.2, release: 0.6 }), samples(0.15), 0.012);
  return toPeak(x, -27.8);
}

// ---------------------------------------------------------------- loops

// sum of sines with integer cycles over the loop, each breathing slowly
function drone(n, L, partials, r) {
  const x = new Float32Array(n);
  for (const [f0, a, breathe] of partials) {
    const f = Math.round(f0 * L) / L;
    const lfo = Math.max(1, Math.round(L / breathe)) / L;
    const p1 = r() * TAU;
    const p2 = r() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      x[i] += Math.sin(p1 + TAU * f * t) * a * (0.65 + 0.35 * Math.sin(p2 + TAU * lfo * t));
    }
  }
  return x;
}

// igloo's room.ogg (always on, 0.45): a deep room tone, a stack of low
// partials over a rumble.
function room() {
  const L = 24;
  const r = rng(71);
  const partials = [[107.5, 1, 12], [150.5, 0.6, 8], [193.5, 0.4, 6], [236.5, 0.25, 24], [279.5, 0.15, 4.8], [322.5, 0.1, 3]];
  const tones = drone(samples(L), L, partials, r);
  const rumble = loopify((n) => biquad(biquad(noise(n, r), 'lp', 120, 0.7), 'lp', 120, 0.7), L, 2);
  const air = loopify((n) => lowpass(noise(n, r), 2500, 1), L, 2);
  for (let i = 0; i < tones.length; i++) tones[i] = tones[i] * 0.25 + rumble[i] * 6 + air[i] * 0.004;
  return toRms(tones, -29.0);
}

// igloo's wind.ogg (the hero, 0.4): a low, gusting roar, the gusts opening it
// up a little.
function wind() {
  const L = 24;
  const r = rng(81);
  const gust = (i) => {
    const t = i / SR;
    return 0.55 + 0.25 * Math.sin(TAU * (t / 8) + 1.3) + 0.2 * Math.sin(TAU * (t / 4.8) + 0.4);
  };
  const x = loopify((n) => {
    const w = noise(n, r);
    const cut = (i) => 60 + 90 * gust(i % samples(L));
    const body = sweepLp(sweepLp(sweepLp(w, cut), cut), cut);
    const air = lowpass(biquad(w, 'bp', 500, 0.8), 1500, 1);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = gust(i % samples(L));
      y[i] = body[i] * 30 * g + air[i] * 0.05 * g * g;
    }
    return y;
  }, L, 2);
  return toRms(x, -28.9);
}

// igloo's circles.ogg (the rings, up to 0.9 as each passes): a deep drone.
function circles() {
  const L = 5;
  const r = rng(91);
  const tones = drone(samples(L), L, [[64.4, 1, 5], [129, 0.55, 2.5], [183, 0.3, 5], [226.2, 0.2, 1.25]], r);
  const rumble = loopify((n) => biquad(noise(n, r), 'lp', 100, 0.7), L, 1);
  for (let i = 0; i < tones.length; i++) tones[i] = tones[i] * 0.4 + rumble[i] * 2.5;
  return toRms(tones, -24.3);
}

// igloo's igloo.ogg (the hero's hover, 0.5): a pulsing low hum with bursts of
// digital crackle.
function hum() {
  const L = 10;
  const r = rng(101);
  const n = samples(L);
  const tones = drone(n, L, [[107.2, 1, 10], [161, 0.5, 5], [214.4, 0.3, 2]], r);
  for (let i = 0; i < n; i++) tones[i] *= 0.6 + 0.4 * Math.sin(TAU * 1.0 * (i / SR));
  const bursts = new Float32Array(n);
  let t = 0.05;
  while (t < L - 0.3) {
    const d = 0.08 + r() * 0.25;
    const g = dataBlock(d, r, [3200, 4800, 6400, 8100], { hp: 2000, dots: Math.round(d / 0.02), noiseGain: 0.6 });
    stutter(g, 0.012, 0.15, r);
    mix(bursts, g, samples(t), 0.5);
    t += 0.35 + r() * 1.1;
  }
  for (let i = 0; i < n; i++) tones[i] = tones[i] + bursts[i] * 0.4;
  return toRms(tones, -21.7);
}

// igloo's particles.ogg (the room's sculpture, by how hard it's stirred): a
// dense hiss, 2-12 kHz.
function particles() {
  const r = rng(111);
  const x = loopify((n) => {
    const w = noise(n, r);
    const a = biquad(w, 'bp', 4000, 0.7);
    const b = lowpass(biquad(w, 'hp', 6000, 0.7), 11000, 2);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = a[i] + b[i] * 0.55;
    return stutter(y, 0.006, 0.45, r);
  }, 4, 0.5);
  return toRms(x, -32.4);
}

// igloo's shard.ogg (the vault's crystal, by how fast you brush it): a fine
// crackle centred round 1 kHz.
function shard() {
  const r = rng(121);
  const x = loopify((n) => {
    const clicks = new Float32Array(n);
    for (let i = 0; i < n; i++) if (r() < 70 / SR) clicks[i] = (r() * 2 - 1) * (0.3 + r());
    const a = biquad(clicks, 'bp', 1000, 1.2);
    const b = biquad(clicks, 'bp', 300, 1.8);
    const c = biquad(noise(n, r), 'bp', 2800, 0.8);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = a[i] + b[i] * 1.1 + c[i] * 0.01;
    return y;
  }, 4, 0.5);
  return toRms(x, -45.6);
}

// Every sound by name (igloo's names).
export const SOUNDS = {
  'ui-short': () => uiNoise(0.3, 0.1, 0.1, 1, -34.5),
  'ui-long': () => uiNoise(0.49, 0.1, 0.18, 2, -33.9),
  logo,
  beeps: () => beeps(1),
  beeps2: () => beeps(2),
  beeps3: () => beeps(3),
  manifesto,
  'project-text': projectText,
  'click-project': clickProject,
  'enter-project': enterProject,
  'leave-project': leaveProject,
  room,
  wind,
  portals: circles,
  igloo: hum,
  particles,
  shard,
};
