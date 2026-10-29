// The hero camera's pull-back as the page scrolls into section 2: igloo's own
// scroll move (its scene-1 timeline, read from the production build) expressed
// as how far each rig value has gone, 0 at the hero -> 1 at the end of the
// section, then applied between cfg.camera.hero and cfg.camera.exit.
// igloo eases its height/target (cubic out) and its dolly/orbit (quad in-out)
// separately, so distance and orbit don't move in lockstep.
const c01 = (x) => Math.min(1, Math.max(0, x));
const cubicOut = (x) => 1 - (1 - x) ** 3;
const quadInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

// igloo's camera at its timeline time T (0..21 for the whole of scene 1).
function iglooRig(T) {
  const a = cubicOut(c01(T / 14));
  const y = 11.5 - 9 * a;
  const targetY = 15 - 14 * a;
  const q = quadInOut(c01((T - 7) / 14));
  const x = -13.25 - 2 * q;
  const z = 13.25 + 10 * q;
  const distance = Math.hypot(x, y - targetY, z);
  return {
    azimuth: (Math.atan2(z, x) * 180) / Math.PI,
    elevation: (Math.asin((y - targetY) / distance) * 180) / Math.PI,
    distance,
    targetY,
  };
}

// igloo's hero sits at 49.5 % of its scene's scroll; the scene ends at 100 %.
const T0 = 0.495 * 21;
const START = iglooRig(T0);
const END = iglooRig(21);
const KEYS = ['azimuth', 'elevation', 'distance', 'targetY'];

// s: 0 = hero, 1 = the end of the section. Returns per-key fractions 0..1.
export function exitFractions(s) {
  const r = iglooRig(T0 + c01(s) * (21 - T0));
  const out = {};
  for (const k of KEYS) out[k] = (r[k] - START[k]) / (END[k] - START[k]);
  return out;
}

// Offsets to add to the hero rig at s (degrees / metres).
export function exitOffsets(s, camera) {
  const f = exitFractions(s);
  const out = {};
  for (const k of KEYS) out[k] = f[k] * (camera.exit[k] - camera.hero[k]);
  return out;
}

// Coming back round the loop (scrolling on past section 3): the part of
// igloo's scene-1 timeline BEFORE its hero, T 0 -> T0. The camera starts
// ~9 m higher, looking up at the sky, and drops while tilting down onto the
// scene, settling at the hero. heroS: screens before the hero (<= 0); igloo's
// scene-1 progress there is 0.495 + heroS / 3.35 (its scene is 2.35 screens +
// the one it shares). Offsets in igloo's own degrees and metres (our hero
// rig uses igloo's angles), the metres scaled to our hero distance.
export function heroProgress(heroS) {
  return Math.min(1, Math.max(0, 0.495 + heroS / 3.35));
}

export function arrivalOffsets(heroS, camera) {
  const r = iglooRig(heroProgress(heroS) * 21);
  const k = camera.hero.distance / START.distance;
  return {
    azimuth: r.azimuth - START.azimuth,
    elevation: r.elevation - START.elevation,
    distance: (r.distance - START.distance) * k,
    targetY: (r.targetY - START.targetY) * k,
  };
}
