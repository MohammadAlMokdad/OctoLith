// The one master GSAP timeline. Every time and value comes from INTRO_CONFIG:
// phase times from cfg.phases scaled by cfg.pace (see pacedPhases), so the
// timeline's own time is real seconds. Fixed fades are scaled by pace too.
import gsap from 'gsap';
import { pacedPhases } from '../config/introConfig.js';

export function createIntroTimeline(parts, cfg) {
  const { scene, pyramid, network, ground, sand, ui } = parts;
  const post = scene.post;
  const U = pyramid.uniforms;
  const X = cfg.post;
  const P = pacedPhases(cfg);
  const k = cfg.pace ?? 1; // for the short fixed fades below
  const C = cfg.camera;
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  for (const [name, p] of Object.entries(P)) if (p.start !== undefined) tl.addLabel(name, p.start);
  tl.addLabel('end', P.total);

  // Camera: slow orbit across the whole intro, gentle dolly-in during the scan,
  // then a descent at the settle so the hero shows the horizon.
  tl.fromTo(scene.rig, { azimuth: C.scan.azimuth }, { azimuth: C.hero.azimuth, duration: P.total, ease: 'sine.inOut' }, 0);
  tl.fromTo(
    scene.rig,
    { distance: C.scan.distance, elevation: C.scan.elevation, targetY: C.target[1] },
    { distance: C.scanEnd.distance, duration: P.settle.start, ease: 'sine.out' },
    0,
  );
  tl.to(
    scene.rig,
    {
      elevation: C.hero.elevation,
      distance: C.hero.distance,
      targetY: C.hero.targetY,
      fov: C.hero.fov ?? C.fov,
      duration: P.total - P.settle.start,
      ease: 'power2.inOut',
    },
    P.settle.start,
  );
  // Live hero: parallax and idle drift fade in as the intro ends.
  tl.fromTo(scene.rig, { parallax: 0, idle: 0 }, { parallax: 1, idle: 1, duration: 1.0 * k, ease: 'sine.inOut' }, P.total - 0.5 * k);

  // ---------------------------------------------------------------- B: seed point
  pyramid.uniforms.uFillY.value = pyramid.apex.y + 1; // solid hidden until the fill
  tl.fromTo(pyramid, { seedIntensity: 0 }, { seedIntensity: 1, duration: P.seed.duration, ease: 'power2.out' }, P.seed.start);
  tl.to(pyramid, { seedIntensity: 0, duration: 0.35 * k, ease: 'power1.in' }, P.fill.start);

  // ---------------------------------------------------------------- C: wireframe + network
  const head = cfg.wire.headWidth;
  tl.fromTo(pyramid, { wireProgress: 0 }, { wireProgress: 1 + head, duration: P.wire.duration, ease: 'power1.inOut' }, P.wire.start);
  // The network starts at the base (aDist ~0.2) and propagates outward.
  tl.fromTo(network, { progress: 0.15 }, { progress: 1.05, duration: P.network.duration, ease: 'power1.out' }, P.network.start);
  tl.set(network, { fade: 1 }, 0);
  // The cage's numbers count up behind the front until the settle, rippling
  // outward (igloo's intro particles: sine.out).
  const ticks = cfg.network.numbers?.ticks ?? 0;
  tl.fromTo(network, { ticks: 0 }, { ticks, duration: P.settle.start - P.network.start, ease: 'sine.out' }, P.network.start);

  // Post during the scan: lines glow, faint fringing.
  tl.fromTo(post, { bloomIntensity: 0.9, chromatic: X.caRest * 2 }, { bloomIntensity: 1.1, duration: P.fill.start }, 0);

  // ---------------------------------------------------------------- D: energy fill -> flash -> the glow fades
  tl.set(U.uFinal, { value: 0 }, 0);
  tl.set(U.uXray, { value: 0 }, 0); // the x-ray hologram is not used (the glow fades straight to stone)
  tl.fromTo(U.uFillY, { value: pyramid.apex.y + 0.02 }, { value: pyramid.baseY - 0.05, duration: P.fill.duration, ease: 'power1.in' }, P.fill.start);
  tl.to(post, { bloomIntensity: 1.6, duration: P.fill.duration, ease: 'power1.in' }, P.fill.start);
  const flashIn = P.flash.duration * 0.4;
  tl.fromTo(U.uFlash, { value: 0 }, { value: 1, duration: flashIn, ease: 'power2.out' }, P.flash.start);
  tl.to(U.uFlash, { value: 0, duration: P.fade.duration, ease: 'power2.in' }, P.flash.start + flashIn);
  tl.to(post, { bloomIntensity: X.bloomPeak, chromatic: X.caPeak, duration: flashIn, ease: 'power2.out' }, P.flash.start);
  tl.to(post, { bloomIntensity: 0.9, chromatic: X.caRest * 2.2, duration: P.fade.duration, ease: 'power2.out' }, P.fade.start);
  // The glow fades out, not off: from the flash to the end of the settle the
  // overexposed energy first dims to a soft warm light (uEnergy), while the
  // whole look crossfades to the finished stone (uFinal), so the pyramid is
  // simply there once the light has gone. The gold wireframe goes with it,
  // down to the hero's faint warm seams.
  const fadeStart = P.fade.start;
  const fadeDuration = P.settle.start + P.settle.duration - fadeStart;
  tl.fromTo(U.uEnergy, { value: U.uEnergy.value }, { value: 1.0, duration: fadeDuration * 0.6, ease: 'sine.inOut' }, fadeStart);
  tl.fromTo(U.uFinal, { value: 0 }, { value: 1, duration: fadeDuration, ease: 'sine.inOut' }, fadeStart);
  tl.to(pyramid, { wireFade: cfg.wire.seamGlow, wireWarm: 1, duration: fadeDuration, ease: 'sine.inOut' }, fadeStart);

  // ---------------------------------------------------------------- E: world materialises
  // Dotted patch under the pyramid, then the stepped reveal expanding outward
  // (slow near the pyramid, accelerating to the horizon). The network and dots
  // fade where the reveal passes beneath them (in their shaders).
  tl.set(ground, { reveal: 0, dotsFade: 0 }, 0);
  tl.fromTo(ground, { dotsProgress: 0.25, dotsFade: 0 }, { dotsProgress: 1, dotsFade: 1, duration: P.points.duration, ease: 'power1.out' }, P.points.start);
  // Two legs: a readable expansion across the on-screen area, then a fast push
  // to the horizon.
  const R = cfg.reveal;
  const near = P.reveal.duration * R.nearShare;
  tl.fromTo(ground, { reveal: 0 }, { reveal: R.nearRadius, duration: near, ease: R.nearEase ?? 'power1.inOut' }, P.reveal.start);
  tl.to(ground, { reveal: R.maxRadius, duration: P.reveal.duration - near, ease: 'power2.in' }, P.reveal.start + near);
  tl.fromTo(scene, { atmosphere: 0 }, { atmosphere: 1, duration: P.reveal.duration, ease: 'power2.inOut' }, P.reveal.start);
  tl.to(ground, { dotsFade: 0, duration: 0.3 * k }, P.reveal.start + P.reveal.duration - 0.2 * k);

  // ---------------------------------------------------------------- F: settle
  // (the stone and seams arrive with the glow's fade above)
  tl.to(post, { bloomIntensity: X.bloomRest, chromatic: X.caRest, duration: P.settle.duration, ease: 'power2.out' }, P.settle.start);
  // The network is gone for the hero (twinkles stop with it).
  tl.to(network, { fade: 0, duration: 0.5 * k }, P.settle.start);

  // ---------------------------------------------------------------- live hero
  // igloo's block life (idle pulse, hover, plexus) ramps in once the stone is
  // physical, over 2 s like igloo's own.
  tl.fromTo(pyramid, { live: 0 }, { live: 1, duration: 2 * k, ease: 'none' }, P.settle.start + P.settle.duration);
  // Wind-blown sand fades in during the reveal.
  if (sand) {
    const s0 = P.reveal.start + 0.5 * P.reveal.duration;
    tl.fromTo(sand, { intensity: 0 }, { intensity: 1, duration: P.total - s0, ease: 'sine.inOut' }, s0);
  }

  // ---------------------------------------------------------------- G: UI reveal
  if (ui) {
    ui.blocks.forEach((_, i) => tl.call(() => ui.reveal(i), [], P.ui.start + i * cfg.ui.stagger * k));
  }

  return tl;
}
