// Boot: ASCII loader -> load + compile the scene behind it -> collapse the
// loader -> play the intro timeline -> live hero.
//
// Skip (click / tap / Esc / Enter) jumps to the end with a quick fade; the
// page can't scroll until the intro has finished. prefers-reduced-motion (or
// a repeat visit with playOncePerSession) goes straight to the final state
// with a 300 ms fade.
//
// QA switches, dev server only (the production build ignores the query string
// and drops the debug GUI chunk): ?debug adds the lil-gui scrubber;
// ?debug&t=2.1 jumps to a time and pauses; ?debug&full forces the finished
// world on; ?debug&skipAt=1500 fires a skip after 1.5 s; ?final shows the end
// state; ?clean hides the DOM UI (used to render the no-WebGL fallback image);
// ?nowebgl forces that fallback; ?nolag disables GSAP lag smoothing (QA in
// slow headless browsers); ?debug&holdLoader freezes the ASCII loader at 55%
// (to inspect it); ?mouse=0.1,0.2 pins the pointer at that screen position
// (-1..1, y up) to check the hover and plexus headless. ?dpr=1.5 pins the
// pixel ratio (the adaptive resolution is also off with ?debug and ?clean).
// ?stats shows the frame rate, the render's resolution and stalls in a corner
// (for phones: src/debug/Stats.js); the adaptive resolution stays on.
//
// The styles are <link>ed in index.html's <head>, not imported here: imported
// CSS only lands once this whole bundle has run, and the page flashed unstyled
// until then.
import gsap from 'gsap';
import { INTRO_CONFIG as cfg, pacedPhases } from './config/introConfig.js';
import { AsciiLoader } from './loader/AsciiLoader.js';
import { IntroScene } from './scene/IntroScene.js';
import { PyramidModel } from './scene/PyramidModel.js';
import { Plexus } from './scene/Plexus.js';
import { RevealGround } from './scene/RevealGround.js';
import { NetworkGrid } from './scene/NetworkGrid.js';
import { SandWind } from './scene/SandWind.js';
import { hazeNoiseTexture } from './scene/shaders/common.js';
import { StormTransition } from './transition/StormTransition.js';
import { VaultScene } from './vault/VaultScene.js';
import { VaultHud } from './vault/VaultHud.js';
import { VaultDetail } from './vault/VaultDetail.js';
import { RingsScene } from './rings/RingsScene.js';
import { IntroUI } from './ui/IntroUI.js';
import { SoundMixer } from './ui/SoundMixer.js';
import { Sound } from './audio/Sound.js';
import { createIntroTimeline } from './timeline/introTimeline.js';

const $ = (sel) => document.querySelector(sel);
// Dev server only: production reads no switches, and `debug` folds to false so
// the DebugGui import below is dead code Vite drops from the build.
const params = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams();
const debug = import.meta.env.DEV && params.has('debug');
const stats = import.meta.env.DEV && params.has('stats');
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (params.has('nolag')) gsap.ticker.lagSmoothing(0);
// Always start at the hero (the intro locks scrolling; a restored scroll
// position would put the page mid-storm).
history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

function applyCssVars() {
  const root = document.documentElement.style;
  root.setProperty('--scan-bg', cfg.colors.scanBg);
  root.setProperty('--scan-bg-top', cfg.colors.scanBgTop);
  root.setProperty('--line', cfg.colors.line);
  root.setProperty('--ui', cfg.colors.ui);
  root.setProperty('--ui-title', cfg.colors.uiTitle);
  root.setProperty('--page-title', cfg.colors.pageTitle);
  root.setProperty('--page-text', cfg.colors.pageText);
  root.setProperty('--ui-light', cfg.colors.uiLight);
}

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function seenThisSession() {
  try {
    return cfg.playOncePerSession && sessionStorage.getItem(cfg.sessionKey) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    if (cfg.playOncePerSession) sessionStorage.setItem(cfg.sessionKey, '1');
  } catch {
    /* storage unavailable: just play again next time */
  }
}

const veil = () => $('#veil');

// The page can't scroll until the intro has finished: body.is-intro hides
// the overflow, and wheel, touch and scroll keys are swallowed outright (iOS
// Safari scrolls a body with hidden overflow). Scrolling doesn't skip the
// intro either: it used to, and the rest of the gesture then carried the
// page on into the storm.
const SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown'];
const SCROLL_KEYS = [' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
function blockScroll(e) {
  if (e.target.closest?.('.lil-gui')) return; // the debug GUI scrolls itself
  if (e.type === 'keydown' && !SCROLL_KEYS.includes(e.key)) return;
  e.preventDefault();
}
for (const t of SCROLL_EVENTS) window.addEventListener(t, blockScroll, { passive: false });

function unlockScroll() {
  document.body.classList.remove('is-intro');
  for (const t of SCROLL_EVENTS) window.removeEventListener(t, blockScroll, { passive: false });
}

// ---------------------------------------------------------------- skip
// Collected before the scene is ready so a click during the loader counts.
// A click (not pointerdown: a touch scroll starts with one too), Esc or Enter.
const skip = { requested: false, handler: null };
const SKIP_EVENTS = ['click', 'keydown'];
function onSkipInput(e) {
  if (e.type === 'keydown' && !['Escape', 'Enter'].includes(e.key)) return;
  if (e.target.closest?.('.lil-gui')) return; // debug GUI clicks don't skip
  skip.requested = true;
  skip.handler?.();
}
function listenForSkip() {
  for (const t of SKIP_EVENTS) window.addEventListener(t, onSkipInput, { passive: true });
}
function stopListeningForSkip() {
  for (const t of SKIP_EVENTS) window.removeEventListener(t, onSkipInput);
}

// The UI's web font (self-hosted, font-display: block): wait for it, 1.5 s at most.
const fontsReady = () => Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

// ---------------------------------------------------------------- fallback
async function runFallback(loader, ui) {
  const img = $('#stage-fallback');
  img.hidden = false;
  document.body.classList.add('is-fallback'); // base.css collapses the scroll track
  await fontsReady();
  await loader.finish();
  document.body.classList.remove('is-loading');
  ui.blocks.forEach((_, i) => setTimeout(() => ui.reveal(i, { instant: reducedMotion }), i * cfg.ui.stagger * 1000));
  unlockScroll();
}

// ---------------------------------------------------------------- main
async function boot() {
  applyCssVars();
  if (params.has('clean')) document.body.classList.add('is-clean');
  listenForSkip();
  const ui = new IntroUI(document, cfg);
  const loader = new AsciiLoader($('#loader'), $('#loader-bar'));
  loader.start();
  if (debug && params.has('holdLoader')) {
    loader.setProgress(0.55);
    return;
  }

  if (!webglAvailable() || params.has('nowebgl')) {
    stopListeningForSkip();
    return runFallback(loader, ui);
  }

  // Anything failing while the world is built (an asset, a shader that won't
  // compile, a lost context) means the static hero instead.
  let scene;
  let parts;
  let tl;
  try {
    const dprParam = parseFloat(params.get('dpr'));
    scene = new IntroScene($('#stage'), cfg, {
      mobile,
      dpr: Number.isFinite(dprParam) ? dprParam : null,
      adaptive: !debug && !params.has('clean'),
      reducedMotion,
      onProgress: (p) => loader.setProgress(p * 0.9), // the last 10% is shader compilation
    });
    const assets = await scene.load();
    // The pyramid is built first: the sand's hero glow shares its motion uniforms.
    const pyramid = new PyramidModel(assets, cfg, { reducedMotion });
    const ground = scene.addModule(new RevealGround(assets, cfg, { hero: pyramid.motion?.uniforms }));
    scene.addModule(pyramid);
    const plexus = pyramid.motion ? scene.addModule(new Plexus(pyramid.motion, cfg)) : null;
    const network = scene.addModule(new NetworkGrid(cfg, { mobile, reveal: ground.uniforms }));
    const sand = scene.addModule(new SandWind(assets, cfg, { mobile, reducedMotion, reveal: ground.uniforms }));
    // Scrolling on into section 2, the relic vault, through the sandstorm.
    const vault = new VaultScene(cfg, { noise: hazeNoiseTexture(), mobile, reducedMotion });
    const hud = new VaultHud($('#vault-hud'), vault);
    // ...and on down into section 3, the rings.
    const rings = new RingsScene(cfg, { noise: hazeNoiseTexture(), mobile, reducedMotion, linksRoot: $('#room-links') });
    const transition = new StormTransition(cfg, {
      scene,
      sand,
      section: vault,
      rings,
      pyramid,
      hud,
      track: $('#track'),
      ui: $('#hero'),
      reducedMotion,
    });
    // Click to explore: each relic's own page.
    const detail = new VaultDetail(cfg, { vault, transition, hud, root: $('#relic-page') });
    const pin = params.get('mouse')?.split(',').map(Number);
    if (pin?.length === 2 && pin.every(Number.isFinite)) scene.pinPointer(pin[0], pin[1]);
    parts = { scene, ground, pyramid, plexus, network, sand, ui, transition, vault, detail, rings };
    // Sound: the soundtrack and igloo's effects, on from the first click / tap / key.
    const sound = (parts.sound = new Sound(cfg.audio, { scene, transition, plexus, vault, hud, rings }));
    ui.onSoundToggle = () => sound.toggle();
    sound.onChange = (on) => ui.setSound(on);
    sound.attach();
    // Right-click the toggle: the volumes, and the tip beside it saying so.
    const mixer = (parts.mixer = new SoundMixer({ toggle: $('#sound-toggle'), panel: $('#sound-mixer'), hint: $('#sound-hint'), sound }));
    ui.onSoundShown = (instant) => mixer.tip(instant);
    // ?debug&p=1.2: show the scroll into section 2 pinned at 1.2 screens.
    const pinP = parseFloat(params.get('p'));
    if (debug && Number.isFinite(pinP)) transition.override = pinP;
    tl = createIntroTimeline(parts, cfg);
    tl.progress(0); // apply every phase's start values before compiling
    await scene.compile();
  } catch (err) {
    console.error('[intro] building the scene failed, showing the static hero', err);
    tl?.kill();
    scene?.dispose();
    stopListeningForSkip();
    return runFallback(loader, ui);
  }
  const { ground, transition, vault, rings } = parts;

  // Scrolling opens once the world has settled (phases.scroll), not at the
  // very end: the intro's tail (the camera's last descent, the corner text,
  // the parallax easing in) plays on, three times faster if the page scrolls.
  let finished = false;
  const hurry = () => {
    if (window.scrollY <= 0) return;
    window.removeEventListener('scroll', hurry);
    if (tl.isActive()) gsap.to(tl, { timeScale: 3, duration: 0.3, ease: 'power1.in' });
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    stopListeningForSkip();
    unlockScroll();
    transition.enabled = true;
    markSeen();
    window.addEventListener('scroll', hurry, { passive: true });
  };
  tl.call(finish, [], pacedPhases(cfg).scroll);
  tl.eventCallback('onComplete', finish);

  // Jump to the end: fade to the scan colour, snap, fade back in.
  const jumpToEnd = (fadeIn = 0.12, fadeOut = 0.3) => {
    skip.handler = null;
    gsap
      .timeline()
      .to(veil(), { opacity: 1, duration: fadeIn, ease: 'power1.in' })
      .add(() => {
        tl.progress(1);
        ui.finishAll();
        finish();
      })
      .to(veil(), { opacity: 0, duration: fadeOut, ease: 'power1.out' });
  };

  scene.start();
  if (stats) import('./debug/Stats.js').then(({ Stats }) => new Stats(scene));
  // Section 2's assets load in the background once the hero is running (it is
  // only reached by scrolling, after the intro).
  vault
    .load(scene.renderer)
    .then(() => vault.compile(scene.renderer))
    .catch((err) => console.error('[vault] loading failed', err))
    .then(() => rings.load(scene.renderer))
    .then(() => {
      rings.setSize(scene.width, scene.height, scene.renderer.getPixelRatio());
      rings.compile(scene.renderer, scene.post.texture);
    })
    .catch((err) => console.error('[rings] loading failed', err));

  const straightToEnd = reducedMotion || seenThisSession() || params.has('final');
  const clean = params.has('clean'); // fallback-image renders: no veil fade
  if (straightToEnd && !clean) gsap.set(veil(), { opacity: 1 });
  await fontsReady();
  await loader.finish();
  document.body.classList.remove('is-loading');

  if (debug) {
    const { DebugGui } = await import('./debug/DebugGui.js');
    new DebugGui({ tl, scene, cfg, parts });
    window.__intro = parts;
  }

  const t = parseFloat(params.get('t'));
  if (straightToEnd) {
    // Reduced motion / repeat visit: final state with a 300 ms fade.
    tl.progress(1);
    ui.finishAll();
    finish();
    gsap.to(veil(), { opacity: 0, duration: 0.3, ease: 'power1.out' });
  } else if (debug && Number.isFinite(t)) {
    stopListeningForSkip();
    tl.seek(t).pause();
    ui.syncTo(t);
  } else if (skip.requested) {
    jumpToEnd(0.01);
  } else {
    skip.handler = () => jumpToEnd();
    tl.play();
    const skipAt = parseFloat(params.get('skipAt'));
    if (debug && Number.isFinite(skipAt)) setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), skipAt);
  }
  if (debug && params.has('full')) {
    ground.reveal = cfg.reveal.maxRadius;
    scene.atmosphere = 1;
  }

  // Free GPU resources when the page goes away.
  window.addEventListener(
    'pagehide',
    (e) => {
      if (e.persisted) return; // kept in the back/forward cache
      tl.kill();
      scene.dispose();
    },
    { once: true },
  );
}

boot();
