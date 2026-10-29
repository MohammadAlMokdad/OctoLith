// Scroll from the hero into section 2 through a sandstorm (igloo's scene-1
// exit, re-themed). The page scrolls natively over a tall track; this turns
// the scroll position into, in screens (cfg.transition):
//   0 .. pull            the camera pulls back toward cfg.camera.exit (igloo's
//                        curve) while the wind picks up and sand lifts off
//   pull .. pull+storm   the wall of sand rolls over the hero (SandstormEffect)
//                        and thins out into section 2; the camera keeps pulling
//   beyond               section 2 alone (the hero isn't rendered): the relic
//                        vault, one crystal per screen (VaultScene, VaultHud)
//   end .. end+1         section 3, the rings, comes in over the last crystal
//   end+1 ..             the descent through the rings (cfg.rings)
//   its last screen      the hero rising in from below (igloo's loop); then
//                        the hero arriving (camera out of the sky, blocks
//                        flying back together) until its rest at `loop`
//                        screens, where the page jumps back to the top. At the
//                        top, scrolling up jumps to the end and goes back.
// One screen of all that is scrollLength window heights of page scroll, and
// the scene follows the scroll through igloo's two smoothing stages (see
// update). Stopping mid-storm snaps to
// the nearest side after cfg.transition.snapAfter s, stopping between
// crystals settles on the nearest one (cfg.vault.snapAfter), and stopping in
// section 3 lets its "gravity" pull you down to the room (cfg.rings.autocenter),
// like igloo's autocenter. Nothing moves the page while it is locked.
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { SRGBColorSpace, UnsignedByteType, WebGLRenderTarget } from 'three';
import { arrivalOffsets, exitOffsets, heroProgress } from './exitPath.js';

gsap.registerPlugin(CustomEase);
// igloo's "inOut3": hangs at the start, rushes through the middle, long settle
const IN_OUT3 = CustomEase.create('inOut3', 'M0,0 C0.6,0 0,1 1,1');

const c01 = (x) => Math.min(1, Math.max(0, x));
// Screens before the end of the storm that already count as section 2. The
// first crystal sits exactly where the storm ends, and the browser hands back
// scroll positions rounded to (device) pixels: without some slack the page can
// rest a hair inside the storm (e.g. 1813.33 / 1067 px), where the vault shows
// but its crystal won't open. The storm is fully clear by then
// (SandstormEffect's clear front finishes early).
const END_SLACK = 0.02;
// ms the page must have rested at the top before going up wraps round the loop
const REST_MS = 250;
const smooth = (a, b, x) => {
  const t = c01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export class StormTransition {
  // scene: IntroScene; sand: SandWind | null; section: VaultScene; hud:
  // VaultHud; rings: RingsScene (section 3).
  constructor(cfg, { scene, sand, section, rings = null, pyramid = null, hud, track, ui, reducedMotion = false }) {
    this.cfg = cfg;
    this.t = cfg.transition;
    this.scene = scene;
    this.sand = sand;
    this.section = section;
    this.rings = rings;
    this.ringsIn = 0; // how much of the screen section 3 covers (0..1, the wipe)
    this.loopIn = 0; // how much of the screen the hero covers coming round the loop (0..1)
    this.heroLoop = false; // the hero is wiping in over section 3 (IntroScene renders both)
    this.pyramid = pyramid; // its blocks explode on the loop's arrival, its outline glows
    this.away = false; // the corner UI is gone (scrolled away)
    this.uiFade = ''; // --hero-ui as last written; uiAway: is-away as last set (DOM writes only on a change)
    this.uiAway = false;
    this.vaultOut = null; // section 2's frame while section 3 wipes in over it
    this.hud = hud;
    this.track = track;
    this.speed = 0; // how fast the shown progress moves (screens/s, smoothed)
    this.locked = false; // a relic's page is open: the page doesn't scroll
    this.blockTouch = null; // ...and touches off its panel are blocked (lock)
    this.glide = null; // { p }: a scripted move the scene follows exactly (no smoothing)
    this.wall = 0; // the storm's progress (1 = section 2 alone)
    this.ui = ui; // element whose --hero-ui (1 -> 0) fades the corner UI
    this.reducedMotion = reducedMotion;
    this.storm = scene.post.storm;
    this.storm.set('tSceneB', section.texture);
    this.target = 0; // scroll position (screens), straight from the page
    this.lead = 0; // the first smoothing stage, chasing the scroll (screens)
    this.progress = 0; // what the scene shows (smoothed after the lead)
    this.override = null; // debug: pin the progress (screens)
    this.enabled = false; // scrolling is locked until the intro ends
    this.lastScroll = 0;
    this.snapping = null;
    this.heroHidden = false;
    this.listeners = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.listeners.push(() => el.removeEventListener(type, fn, opts));
    };
    on(window, 'scroll', () => this.onScroll(), { passive: true });
    on(window, 'resize', () => this.layout());
    // Any deliberate input cancels a snap in progress. At the top, going up
    // goes round the loop the other way (wrapUp reads the rest clock that
    // cancelSnap resets, so it goes first).
    on(window, 'pointerdown', () => this.cancelSnap(), { passive: true });
    on(window, 'wheel', (e) => {
      if (e.deltaY < 0) this.wrapUp();
      this.cancelSnap();
    }, { passive: true });
    on(window, 'keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp') this.wrapUp();
      this.cancelSnap();
    });
    // While a finger is on the screen nothing snaps or pulls the page (it
    // would fight the finger); the idle time counts from when it lifts. A drag
    // down goes round the loop only if it began at rest at the top (one that
    // reaches the top mid-way is still a moving gesture: see wrapUp).
    this.touching = false;
    this.touchRested = false;
    on(window, 'touchstart', (e) => {
      this.touching = true;
      this.touchY = e.touches[0]?.clientY ?? null;
      this.touchRested = window.scrollY <= 1 && this.rested();
      this.cancelSnap();
    }, { passive: true });
    on(window, 'touchmove', (e) => {
      const y = e.touches[0]?.clientY;
      if (this.touchRested && this.touchY != null && y != null && y - this.touchY > 8) this.wrapUp(true);
      this.touchY = y ?? null;
    }, { passive: true });
    const lift = (e) => {
      if (e.touches.length) return;
      this.touching = false;
      this.lastScroll = performance.now();
    };
    on(window, 'touchend', lift, { passive: true });
    on(window, 'touchcancel', lift, { passive: true });
    this.touchScreen = matchMedia('(hover: none) and (pointer: coarse)'); // phones and tablets, not touchscreen laptops
    this.themeColor = document.querySelector('meta[name="theme-color"]');
    this.layout();
    section.setSize(scene.width, scene.height, scene.renderer.getPixelRatio());
    scene.transition = this;
  }

  // Screens of scroll: the transition, where the vault starts (its first
  // crystal centred), and where its last crystal is centred.
  get length() {
    return this.t.pull + this.t.storm;
  }

  get vaultStart() {
    return this.length;
  }

  get end() {
    return this.vaultStart + this.cfg.vault.relics.length - 1;
  }

  // Section 3 starts coming in at the last crystal; its progress (0..1) runs
  // over ringsLength screens from there (igloo: the scene's height + 1).
  get ringsStart() {
    return this.end;
  }

  get ringsLength() {
    return this.cfg.rings.height + 1;
  }

  ringsProgress(p) {
    return (p - this.ringsStart) / this.ringsLength;
  }

  get ringsEnd() {
    return this.ringsStart + this.ringsLength;
  }

  // One lap of the loop (screens): from the hero's rest round to it again.
  get loop() {
    return this.ringsEnd + this.cfg.rings.loop.arrival;
  }

  // The screen's height for the scroll: the canvas's, which is the large
  // viewport's on phones (base.css), so it holds still while the browser's
  // toolbar slides in and out (window.innerHeight follows the toolbar).
  get viewHeight() {
    return this.scene.height || window.innerHeight;
  }

  // Page pixels per screen of the experience (longer on touch screens, where
  // a flick's momentum carries the page a long way).
  get screenPx() {
    const k = this.touchScreen?.matches ? this.t.touchScrollLength : this.t.scrollLength;
    return this.viewHeight * (k ?? this.t.scrollLength ?? 1);
  }

  // The track gives the page its scroll: one lap and a screen to spare (the
  // jump back to the top happens on reaching the lap's end). When a screen's
  // worth of pixels changes (a phone turned round), the page moves to stay at
  // the same place in the experience.
  layout() {
    const px = this.screenPx;
    const was = this.layoutPx;
    this.layoutPx = px;
    this.track.style.height = `${(this.loop + 1) * px + this.viewHeight}px`;
    if (was && Math.abs(was - px) > 0.5 && this.enabled && !this.glide) {
      this.cancelSnap();
      window.scrollTo(0, Math.round(this.target * px));
      return;
    }
    this.onScroll();
  }

  canWrap() {
    return this.enabled && !this.locked && this.override === null && !this.glide;
  }

  // Move the page by `by` screens without anything visible changing (the
  // scene shows the same frame at s and s + loop). The scene, which trails
  // the page, moves whole laps with it, onto the lap nearest the page: going
  // down it is usually still short of the lap's end, so it comes out a little
  // below 0 and arrives at the hero's rest from there (update) instead of
  // skipping to it; a page that jumped by more than half a lap (End) doesn't
  // send it all the way round. A phone in the middle of a flick can refuse
  // the jump (iOS keeps its momentum): then the scene stays where the page
  // is, and the next frame tries again.
  wrap(by) {
    this.cancelSnap();
    const y = Math.round((this.target + by) * this.screenPx);
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 2) return;
    this.target += by;
    const laps = Math.round((this.target - this.progress) / this.loop) * this.loop;
    this.lead += laps;
    this.progress += laps;
    this.lastScroll = performance.now();
  }

  // The page has sat still (no scroll, input or snap) for REST_MS.
  rested() {
    return performance.now() - this.lastScroll >= REST_MS;
  }

  // Up from the top: round to a hair short of the lap's end (the end itself
  // would wrap straight back down). Only from rest: a trackpad's or a flick's
  // inertia keeps sending wheel / touch events after the page has hit the
  // top, and wrapping on one of those carries what is left of it into
  // section 3, backwards. A touch gesture's rest is read as it starts.
  wrapUp(rested = this.rested()) {
    if (rested && this.canWrap() && window.scrollY <= 1 && this.target * this.screenPx <= 1) this.wrap(this.loop - 0.002);
  }

  // (an elastic overscroll above the top reads as the top: below 0 is the
  // end of the lap, see update)
  onScroll() {
    this.target = Math.max(0, window.scrollY) / this.screenPx;
    if (!this.snapping) this.lastScroll = performance.now();
  }

  // Glide the page (and the scene, exactly, without the usual smoothing) to
  // scroll position p (screens) over duration s, igloo's centerScroll
  // (power3.inOut). Works while the page is locked.
  glideTo(p, duration) {
    this.cancelSnap();
    this.glideTween?.kill();
    const g = (this.glide = { p: this.progress });
    if (duration <= 0) g.p = p;
    this.glideTween = gsap.to(g, {
      p,
      duration: Math.max(duration, 0.001),
      ease: 'power3.inOut',
      onUpdate: () => window.scrollTo(0, g.p * this.screenPx),
      onComplete: () => {
        window.scrollTo(0, Math.round(p * this.screenPx));
        if (this.override !== null) this.override = p; // ?debug&p= pinned: stay where the glide ended
        this.glide = null;
        this.glideTween = null;
        this.lastScroll = performance.now();
      },
    });
    return this.glideTween;
  }

  // Freeze the page's scroll (a relic's page is open; its panel scrolls
  // itself). overflow: hidden doesn't stop a touch from scrolling the page on
  // iOS: touches off the panel are blocked too, or the vault drifts behind the
  // open page. Meanwhile the scene holds its place whatever the page does
  // (update), and on unlock the page is put back there, so close() lands on
  // the crystal that was opened.
  lock(on) {
    this.locked = on;
    document.documentElement.classList.toggle('is-locked', on);
    if (on) {
      this.cancelSnap();
      if (!this.blockTouch) {
        this.blockTouch = (e) => {
          if (!e.target.closest?.('.relic-page__panel')) e.preventDefault();
        };
        window.addEventListener('touchmove', this.blockTouch, { passive: false });
      }
    } else {
      this.unblockTouch();
      if (!this.glide && this.override === null && Math.abs(this.target - this.progress) > 0.01) {
        window.scrollTo(0, Math.round(this.progress * this.screenPx));
      }
    }
  }

  unblockTouch() {
    if (!this.blockTouch) return;
    window.removeEventListener('touchmove', this.blockTouch);
    this.blockTouch = null;
  }

  cancelSnap() {
    this.snapping?.kill();
    this.snapping = null;
    this.lastScroll = performance.now();
  }

  // The page has been still half-way through the storm (-> whichever side is
  // nearer: the end of the pull-back, or section 2), between two crystals
  // (-> the nearer crystal), or in section 3 (-> igloo's autocenter, below):
  // glide there.
  maybeSnap() {
    if (this.snapping || this.touching || !this.enabled || this.locked || this.override !== null) return;
    const idle = performance.now() - this.lastScroll;
    const { pull, storm } = this.t;
    const p = this.target;
    let to = null;
    let duration = this.t.snapTime;
    let ease = 'power2.inOut';
    if (p > pull + 0.01 && p < pull + storm - END_SLACK) {
      if (idle < this.t.snapAfter * 1000) return;
      to = (p - pull) / storm < 0.5 ? pull : pull + storm;
    } else if (p > this.vaultStart - END_SLACK && p < this.end) {
      const q = p - this.vaultStart;
      if (Math.abs(q - Math.round(q)) < 0.01 || idle < this.cfg.vault.snapAfter * 1000) return;
      to = this.vaultStart + Math.round(q);
    } else if (p > this.ringsStart + 0.01 && p < this.ringsEnd) {
      const a = this.cfg.rings.autocenter;
      if (idle < a.idle * 1000) return;
      const len = this.ringsLength;
      const q = p - this.ringsStart; // screens into section 3
      ease = IN_OUT3;
      if (q < 1) {
        // half-way through the wipe: the nearer side; going on lands at `initial`
        const extra = Math.max(0, a.initial * len - 1);
        if (q < 0.5) [to, duration] = [this.ringsStart, a.edge];
        else [to, duration] = [this.ringsStart + 1 + extra, a.edge + extra * 2];
      } else if (q > len - 1) {
        // half-way through the hero coming in (the loop): back to the room, or
        // on round to the hero's rest (igloo: 2 s + 2 s per screen past the edge)
        const back = (1 - a.final) * len - 1;
        const on = this.cfg.rings.loop.arrival;
        if (q - (len - 1) < 0.5) [to, duration] = [this.ringsStart + a.final * len, a.edge + back * 2];
        else [to, duration] = [this.loop, a.edge + on * 2];
      } else {
        // the gravity: down (or back up) to the room
        if (q / len <= a.pullFrom) return;
        to = this.ringsStart + a.final * len;
        const d = Math.abs(to - p);
        if (d < 0.005) return;
        duration = Math.min(a.maxTime, Math.max(a.minTime, d * a.perScreen));
      }
    } else return;
    const proxy = { y: window.scrollY };
    this.snapping = gsap.to(proxy, {
      y: to * this.screenPx,
      duration,
      ease,
      onUpdate: () => window.scrollTo(0, proxy.y),
      onComplete: () => {
        this.snapping = null;
        this.lastScroll = performance.now();
      },
    });
  }

  // Called by IntroScene every frame, before the camera and modules update.
  update(dt, time) {
    // round the loop: the lap's end is the top of the page again
    if (this.canWrap() && !this.snapping && this.target >= this.loop) this.wrap(-this.loop);
    this.maybeSnap();
    // (locked: a relic's page is open; whatever the page does, the scene stays)
    const goal = this.glide?.p ?? this.override ?? (this.locked ? this.progress : this.target);
    const before = this.progress;
    // igloo's two stages: the lead chases the scroll at a capped speed, the
    // scene eases after the lead, so it gathers pace, glides and settles
    // instead of lurching with each wheel notch
    const [k1, k2] = this.t.smoothing;
    const cap = this.t.maxSpeed * dt;
    this.lead += Math.max(-cap, Math.min(cap, (goal - this.lead) * (1 - Math.exp(-dt * k1))));
    this.progress += (this.lead - this.progress) * (1 - Math.exp(-dt * k2));
    if (this.glide || (Math.abs(goal - this.lead) < 1e-4 && Math.abs(goal - this.progress) < 1e-4)) this.lead = this.progress = goal;
    if (dt > 0) this.speed += (Math.abs(this.progress - before) / dt - this.speed) * (1 - Math.exp(-dt * 4));
    // (just after the page wraps back to the top the scene is still short of
    // the lap's end, below 0: the same place a lap on)
    const p = this.progress < 0 ? this.progress + this.loop : this.progress;
    // where the hero is: screens past its rest, or (round the loop, from
    // section 3's last screen on) before it, negative
    const ringsEnd = this.ringsEnd;
    const heroS = p >= ringsEnd - 1 ? p - this.loop : p;
    this.loopIn = p >= ringsEnd - 1 ? c01(p - (ringsEnd - 1)) : 0;
    const { pull, storm } = this.t;
    const approach = c01(heroS / pull);
    const wall = heroS >= pull + storm - END_SLACK ? 1 : c01((heroS - pull) / storm);
    this.wall = wall;

    this.scene.exitOffset = heroS >= 0 ? exitOffsets(heroS / this.length, this.cfg.camera) : arrivalOffsets(heroS, this.cfg.camera);
    if (this.sand) this.sand.storm = smooth(0, 1, approach);
    this.arrive(heroS);
    const [uiGone, uiBack] = this.cfg.rings.loop.ui;
    const fade = heroS >= 0 ? 1 - smooth(0.03, 0.35, heroS) : smooth(uiGone, uiBack, heroS);
    // (DOM writes only on a change: every frame, they would cost style work)
    const fadeStr = fade.toFixed(3);
    if (this.ui && fadeStr !== this.uiFade) this.ui.style.setProperty('--hero-ui', (this.uiFade = fadeStr));
    const away = fade <= 0;
    if (this.ui && away !== this.uiAway) this.ui.classList.toggle('is-away', (this.uiAway = away));
    // coming back after being away: the corner texts type in again (igloo)
    if (away) this.away = true;
    else if (this.away && fade > 0.05) {
      this.away = false;
      window.dispatchEvent(new CustomEvent('octo:hero-return'));
    }
    // A phone browser's toolbar turns dark as the storm and section 2 take over.
    const dark = heroS < 0 ? 1 - this.loopIn : smooth(0.35, 0.7, wall);
    const theme = dark > 0.5 ? this.cfg.colors.sectionOuter : this.cfg.colors.horizon;
    if (this.themeColor && theme !== this.theme) this.themeColor.content = this.theme = theme;

    const s = this.storm;
    s.set('uStorm', wall);
    s.set('uApproach', smooth(0.15, 1, approach));
    s.set('uTime', time);
    this.scene.post.stormOn = heroS > 0.002;
    this.mixing = wall > 0;
    // the hero: alone, under the storm, or (heroLoop) rising in over section 3
    this.heroLoop = this.loopIn > 0 && this.loopIn < 1 && !!this.rings?.ready;
    this.heroHidden = wall >= 1 || (this.loopIn <= 0 && p >= ringsEnd - 1);
    // section 3 comes in over the last crystal, then takes over
    const q3 = p - this.ringsStart;
    this.ringsIn = this.rings?.ready && p < ringsEnd ? c01(q3) : 0;
    this.dt = dt;
    if (this.mixing && this.ringsIn < 1) {
      this.section.update(time, dt, { q: p - this.vaultStart, speed: this.speed / 2, pointer: this.scene.pointer });
    }
    if (this.ringsIn > 0) {
      this.rings.update(time, dt, { p: c01(q3 / this.ringsLength), pointer: this.scene.pointer });
    } else this.rings?.sleep?.();
    this.hud?.update(time, { visible: wall >= 0.98 && this.ringsIn <= 0 });
  }

  // The hero arriving round the loop (heroS < 0), igloo's: the upper blocks
  // blown apart and coming back together by 40 % of its scene's scroll, the
  // outline glowing while they are apart.
  arrive(heroS) {
    const pyr = this.pyramid;
    if (!pyr?.motion) return;
    const sineIn = (x) => 1 - Math.cos((x * Math.PI) / 2);
    const hp = heroProgress(heroS);
    pyr.motion.explode = heroS < 0 ? sineIn(c01(1 - hp / 0.4)) : 0;
    const outline = heroS < 0 ? sineIn(c01(1 - hp / 0.35)) : 0;
    if (outline > 0 || this.outlined) {
      const rest = this.cfg.wire.seamGlow;
      pyr.wireFade = Math.min(1, rest + outline * 0.6);
      this.outlined = outline > 0;
    }
  }

  // Two scenes on screen at once (the storm over the hero, section 3 wiping
  // in over the vault, the hero wiping in over section 3): IntroScene holds
  // its adaptive resolution meanwhile.
  get compositing() {
    return (this.wall > 0 && this.wall < 1) || (this.ringsIn > 0 && this.ringsIn < 1) || this.heroLoop;
  }

  // The end of the loop: the hero (its frame in heroTexture) rising in over
  // section 3, igloo's cut the other way round.
  renderLoop(renderer, heroTexture) {
    this.rings.render(renderer, { other: heroTexture, progress: this.loopIn, swap: true, dt: this.dt });
  }

  // Before the hero's frame: section 2 into its texture while the storm blends them.
  beforeHeroRender(renderer) {
    if (this.mixing) this.section.render(renderer);
  }

  // After the storm: section 2, section 3 wiping in over it, or section 3.
  renderSection(renderer) {
    if (this.ringsIn <= 0) return this.section.renderToScreen(renderer);
    if (this.ringsIn >= 1) return this.rings.render(renderer, { dt: this.dt });
    if (!this.vaultOut) {
      this.vaultOut = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, colorSpace: SRGBColorSpace });
      this.resizeVaultOut();
    }
    this.section.renderTo(renderer, this.vaultOut);
    this.rings.render(renderer, { other: this.vaultOut.texture, progress: this.ringsIn, dt: this.dt });
  }

  resizeVaultOut() {
    const r = this.scene.renderer;
    this.vaultOut?.setSize(Math.round(this.scene.width * r.getPixelRatio()), Math.round(this.scene.height * r.getPixelRatio()));
  }

  resize(w, h, dpr) {
    this.section.setSize(w, h, dpr);
    this.rings?.setSize(w, h, dpr);
    this.resizeVaultOut();
  }

  // Compile section 2's shaders with the rest (no hitch on the first scroll).
  compile(renderer) {
    this.section.render(renderer);
  }

  dispose() {
    this.cancelSnap();
    this.glideTween?.kill();
    this.glide = this.glideTween = null;
    this.unblockTouch();
    for (const off of this.listeners) off();
    this.section.dispose();
    this.rings?.dispose();
    this.vaultOut?.dispose();
  }
}
