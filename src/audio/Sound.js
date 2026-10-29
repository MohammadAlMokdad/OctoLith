// The site's sound: igloo.inc's audio controller, re-made with our own
// soundtrack and synthesized effects.
//   - Muted until the first click, tap or key (browsers only let audio start
//     on a gesture; scrolling doesn't count). Then it fades in by itself:
//     igloo unmutes as soon as its audio context runs. The corner toggle
//     mutes and unmutes. Both fade the master volume (time constant 0.35 s).
//     A hidden tab goes silent and the audio pauses.
//   - Music: the soundtrack loop (cfg.audio.music), streamed, at 0.2.
//   - Beds and loops (synth.js, built in a worker), igloo's volumes and drivers:
//       room       always, 0.45
//       wind       the hero: in as the world appears (or round the loop),
//                  out through the sandstorm; x 0.4
//       igloo      the hover hum: while the pointer is over the pyramid (its
//                  plexus up), as loud as the wind; x 0.5
//       shard      the vault: how fast the centred crystal is being brushed; x 0.5
//       portals    the rings: up to 0.9 as the camera passes each ring
//       particles  the room: 0.04 x the sculpture's interaction ramp, + 0.21
//                  x how fast the pointer stirs it
//   - Beeps (one of three at random, 0.4 s apart at least) as a crystal's
//     labels come up.
//   - One-shots by name from any module: sfx(name) (sfx.js).
//   - The listener's own two levels (the volume sliders, src/ui/SoundMixer.js):
//     the music, and the effects (every loop and one-shot). setVolume.
import { setSfxEngine } from './sfx.js';

// igloo's one-shot volumes (and the beeps' minimum spacing)
const ONE_SHOTS = {
  'ui-short': 0.3,
  'ui-long': 0.3,
  logo: 0.3,
  manifesto: 0.3,
  beeps: 0.5,
  beeps2: 0.5,
  beeps3: 0.5,
  'project-text': 0.5,
  'click-project': 0.5,
  'enter-project': 0.5,
  'leave-project': 0.5,
};
const MIN_GAP = { beeps: 0.4 };
const LOOPS = ['room', 'wind', 'igloo', 'shard', 'portals', 'particles'];
// built in this order: what plays first comes first
const ORDER = ['room', 'ui-long', 'ui-short', 'logo', 'manifesto', 'wind', 'igloo', 'beeps', 'beeps2', 'beeps3', 'shard', 'click-project', 'enter-project', 'project-text', 'leave-project', 'portals', 'particles'];
const RINGS_AT = [0.28, 0.375, 0.465]; // section 3's progress as the camera passes each ring
const SCULPTURE = { y: -9.785, r: 0.27 }; // the room's sculpture (igloo's sound sphere)

const fit = (x, a, b, c, d) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return c + (d - c) * t;
};
const lerpFPS = (a, b, k, dt) => a + (b - a) * (1 - (1 - k) ** dt);
// a volume slider's position (0..1) -> gain: half way sounds about half as loud
const loudness = (v) => v * v;

export class Sound {
  // c: cfg.audio. parts: the scene (atmosphere, pointer), the transition, the
  // plexus, the vault and its HUD, and the rings (sculpture, links), read
  // each frame to drive the loops.
  constructor(c, parts) {
    this.c = c;
    this.parts = parts;
    this.started = false;
    this.muted = true;
    this.onChange = null; // (on) => {}: the toggle's text
    this.volume = { music: 1, fx: 1 }; // the volume sliders' positions (setVolume)
    this.buffers = {};
    this.gains = {};
    this.lastPlayed = {};
    this.levels = { hum: 0, shard: 0, splat: 0, splatTarget: 0 };
    this.splat = { x: 0, y: 0, z: 0, hit: false, last: null, lastMove: 0, lastTime: 0 };
    this.lastFocus = -1;
    this.lastLink = null;
    this.beepAgain = 0;
    this.onGesture = (e) => {
      if (e.target.closest?.('#sound-toggle')) return; // the toggle starts it itself
      this.start();
    };
    this.onVisibility = () => this.visibility();
    this.frame = this.frame.bind(this);
  }

  attach() {
    for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, this.onGesture, { capture: true });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const t of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(t, this.onGesture, { capture: true });
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    ctx.resume?.();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // the effects' slider: every loop and one-shot goes through it
    this.fxGain = ctx.createGain();
    this.fxGain.gain.value = this.volumeGain('fx');
    this.fxGain.connect(this.master);
    // the soundtrack, streamed
    const music = (this.music = new Audio(this.c.music));
    music.loop = true;
    music.preload = 'auto';
    const musicGain = (this.musicGain = ctx.createGain());
    musicGain.gain.value = this.volumeGain('music');
    ctx.createMediaElementSource(music).connect(musicGain).connect(this.master);
    music.play().catch(() => {});
    for (const name of LOOPS) {
      const g = (this.gains[name] = ctx.createGain());
      g.gain.value = name === 'room' ? this.c.volumes.room : 0;
      g.connect(this.fxGain);
    }
    this.build();
    setSfxEngine(this);
    this.setMuted(false); // igloo: on as soon as it can be
    this.time = performance.now();
    requestAnimationFrame(this.frame);
  }

  // The sounds, from a worker (or here, a few per frame, if workers fail).
  build() {
    const built = new Set();
    const add = (name, data, sr) => {
      if (built.has(name)) return;
      built.add(name);
      const b = this.ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data, 0);
      if (LOOPS.includes(name)) {
        const src = this.ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        src.connect(this.gains[name]);
        src.start(0, Math.random() * b.duration);
      } else this.buffers[name] = b;
    };
    const here = async () => {
      const { SOUNDS, SR } = await import('./synth.js');
      for (const name of ORDER) {
        if (built.has(name)) continue;
        add(name, SOUNDS[name](), SR);
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    try {
      const w = new Worker(new URL('./soundWorker.js', import.meta.url), { type: 'module' });
      let got = 0;
      w.onmessage = ({ data }) => {
        add(data.name, data.data, data.sr);
        if (++got === ORDER.length) w.terminate();
      };
      w.onerror = () => {
        w.terminate();
        here();
      };
      w.postMessage({ names: ORDER });
    } catch {
      here();
    }
  }

  setMuted(m) {
    this.muted = m;
    this.applyMaster();
    this.onChange?.(!m);
  }

  // The corner toggle (also the first gesture, when it's the toggle).
  toggle() {
    if (!this.started) return this.start();
    this.setMuted(!this.muted);
  }

  applyMaster() {
    if (!this.ctx) return;
    const on = !this.muted && !document.hidden;
    this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.35);
  }

  // A volume slider moved: kind 'music' or 'fx', v its position (0..1).
  // Before the sound has started it is kept for the start.
  setVolume(kind, v) {
    this.volume[kind] = v;
    const node = kind === 'music' ? this.musicGain : this.fxGain;
    if (node) node.gain.setTargetAtTime(this.volumeGain(kind), this.ctx.currentTime, 0.03);
  }

  volumeGain(kind) {
    return loudness(this.volume[kind]) * (kind === 'music' ? this.c.volumes.music : 1);
  }

  visibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        if (!document.hidden) return;
        this.music.pause();
        this.ctx.suspend?.();
      }, 400);
    } else {
      clearTimeout(this.hideTimer);
      this.ctx.resume?.();
      this.music.play().catch(() => {});
      this.applyMaster();
      this.time = performance.now();
    }
  }

  play(name) {
    const b = this.buffers[name];
    if (!b || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name.replace(/\d$/, '')] ?? 0;
    const key = gap ? name.replace(/\d$/, '') : name;
    if (gap && now - (this.lastPlayed[key] ?? -1e9) < gap) return;
    this.lastPlayed[key] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = (ONE_SHOTS[name] ?? 0.3) * (this.c.effects ?? 1);
    src.connect(g).connect(this.fxGain);
    src.start();
  }

  beep() {
    this.play(['beeps', 'beeps2', 'beeps3'][Math.floor(Math.random() * 3)]);
  }

  level(name, v) {
    const g = this.gains[name];
    if (g) g.gain.setTargetAtTime(v * (this.c.effects ?? 1), this.ctx.currentTime, 0.05);
  }

  // Every frame while running: the loops' levels from what's on screen.
  frame(now) {
    requestAnimationFrame(this.frame);
    if (!this.ctx || this.ctx.state !== 'running') return;
    const dt = Math.min(5, ((now - this.time) / 1000) * 60);
    this.time = now;
    const { scene, transition: T, plexus, vault, hud, rings } = this.parts;
    const L = this.levels;
    const p = Math.max(0, T.progress);
    // the hero: wind in as the world appears, or round the loop; out through the storm
    const heroS = p >= T.ringsEnd - 1 ? p - T.loop : p;
    const { pull, storm } = T.t;
    let wind = heroS < 0 ? fit(heroS, -1.05, -0.69, 0, 1) : fit(heroS, pull + 0.15 * storm, pull + 0.7 * storm, 1, 0);
    wind *= scene.atmosphere ?? 1;
    this.level('wind', wind * 0.4);
    // the hover hum, while the plexus is up round the pointer (igloo's plexus
    // only exists over the igloo; ours always has a few markers out with the
    // breath, so: how close the nearest one is to the pointer, < 0.8 m on the
    // pyramid, 4-5 m off it)
    const near = plexus?.active?.length ? Math.min(...plexus.active.map((b) => b.dist ?? Infinity)) : Infinity;
    const hover = 1 - fit(near, 0.8, 1.6, 0, 1);
    L.hum = lerpFPS(L.hum, hover * wind, 0.1, dt);
    this.level('igloo', L.hum * 0.5);
    // the vault: brushing the centred crystal; beeps as its labels come up
    const vaultOn = T.wall >= 1 && T.ringsIn < 1;
    const focus = vaultOn && hud ? hud.focused : -1;
    const speed = focus >= 0 ? vault?.crystals?.[focus]?.frost?.speed ?? 0 : 0;
    L.shard = lerpFPS(L.shard, speed, speed > L.shard ? 0.2 : 0.05, dt);
    this.level('shard', L.shard * 0.5);
    const t = this.ctx.currentTime;
    if (focus !== this.lastFocus) {
      if (focus >= 0) {
        this.beep();
        this.beepAgain = t + 0.5;
      }
      this.lastFocus = focus;
    }
    if (this.beepAgain && t >= this.beepAgain) {
      this.beepAgain = 0;
      if (focus >= 0) this.beep();
    }
    // the rings: a drone swelling as each one passes
    const ringsOn = T.ringsIn > 0 && rings?.ready;
    let portals = 0;
    if (ringsOn) {
      const n = Math.min(...RINGS_AT.map((r) => Math.abs(rings.p - r)));
      portals = 1 - (1 - fit(n, 0, 0.04, 1, 0)) ** 3; // power2.out
    }
    this.level('portals', portals * 0.9);
    // the room: the sculpture's hiss, louder the harder it's stirred
    const e = ringsOn ? rings.sculpture?.uniforms.uInteractForce.value ?? 0 : 0;
    this.stir(e, scene.pointer, rings, t);
    this.level('particles', 0.04 * e + L.splat * 0.21);
  }

  // igloo's sound sphere round the sculpture: the pointer moving over it
  // builds a velocity (capped by the interaction ramp); a link change adds a
  // burst.
  stir(e, pointer, rings, t) {
    const L = this.levels;
    const s = this.splat;
    const link = rings?.links?.current ?? null;
    if (link !== this.lastLink) {
      if (this.lastLink !== null) L.splatTarget += 1;
      this.lastLink = link;
    }
    if (t - s.lastTime < 0.015) return;
    s.lastTime = t;
    let moved = 0;
    const cam = rings?.camera;
    if (e > 0 && cam && pointer?.active) {
      // ray from the camera through the pointer, against the sphere
      const o = cam.position;
      const d = this.ray ?? (this.ray = o.clone());
      d.set(pointer.ndc.x, pointer.ndc.y, 0.5).unproject(cam).sub(o).normalize();
      const cx = -o.x, cy = SCULPTURE.y - o.y, cz = -o.z;
      const b = cx * d.x + cy * d.y + cz * d.z;
      const c = cx * cx + cy * cy + cz * cz - SCULPTURE.r * SCULPTURE.r;
      const disc = b * b - c;
      if (disc >= 0) {
        const k = b - Math.sqrt(disc);
        const hx = o.x + d.x * k, hy = o.y + d.y * k, hz = o.z + d.z * k;
        if (s.last) {
          moved = Math.hypot(hx - s.last[0], hy - s.last[1], hz - s.last[2]);
          if (moved > 0) s.lastMove = t;
          if (t - s.lastMove > 0.15 || moved > 0.3) moved = 0;
        }
        s.last = [hx, hy, hz];
      } else s.last = null;
    } else s.last = null;
    L.splatTarget = Math.min(e, Math.max(0, (L.splatTarget + moved * 4) * 0.97));
    L.splat = Math.min(e, Math.max(0, L.splat + (L.splatTarget - L.splat) * 0.05));
  }
}
