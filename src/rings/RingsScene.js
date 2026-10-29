// Section 3, the rings (igloo's "entry" scene, re-themed): the camera dives
// down a shaft through three shattered sandstone rings that assemble as it
// nears them, flashing as it passes each, into a round room at the bottom.
//
// One paused GSAP timeline (9.2 s) is scrubbed by the section's progress p
// (0..1, set by StormTransition from the scroll): the camera's fall, its 180
// degree roll and the swing back to level, the field of view, the flashes,
// and the room's parts fading in, with section 4's particle sculpture and
// its links in the room (src/room). Each ring assembles itself in its shader
// from the camera's distance (materials.js), so it stays right scrubbing
// either way. Everything below p ~0.5 is dropped once the camera is past it.
//
// Rendered through its own composer: the scene, the ring flash + glare and a
// bloom, SMAA, then WipePass, which brings it in over section 2 (one screen)
// and writes the screen.
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DataTexture,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { domedAnnulus, insideCylinder, panelCylinder, rng, shatteredRing, smokeArm, tieredFloor } from './geometry.js';
import {
  backdropMaterial,
  containmentMaterial,
  floorMaterial,
  glyphMaterial,
  membraneMaterial,
  motesMaterial,
  plasmaMaterial,
  ringLightMaterial,
  ringMaterial,
  sharedUniforms,
  smokeMaterial,
} from './materials.js';
import { RingFlashEffect, WipePass } from './post.js';
import { ParticleSculpture } from '../room/ParticleSculpture.js';
import { RoomLinks, readLinks } from '../room/RoomLinks.js';
import { loadTexture } from '../scene/loadTexture.js';

gsap.registerPlugin(CustomEase);
// igloo's custom eases for the descent
const EASE = {
  entry: CustomEase.create('rings_entry', 'M0,0 C0.358,0 0.336,0.209 0.442,0.519 0.59,0.952 0.768,0.918 1,1'),
  entry2: CustomEase.create('rings_entry2', 'M0,0 C0.388,0.082 0.924,0.862 1,1'),
  entry3: CustomEase.create('rings_entry3', 'M0,0 C0.272,0 0.472,0.454 0.496,0.496 0.66,0.79 0.685,1 1,1'),
};
const DURATION = 9.2; // s of timeline = p 0..1
const Y = new Vector3(0, 1, 0);
const RING_Y = [-1.65, -4.15, -6.65];
// the camera's frame, rebuilt every frame
const _up = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _trueUp = new Vector3();
const _off = new Vector3();
const _dir = new Vector3();
const _look = new Vector3();

// Blurred columns of glyphs for the shaft and room walls (our own atlas:
// rows of readouts and marks, blurred like igloo's text walls; only glyphs
// the bundled mono font has, so no system fallback / tofu).
function glyphAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 512);
  g.filter = 'blur(1.6px)';
  g.fillStyle = '#fff';
  const r = rng(7);
  for (let row = 0; row < 32; row++) {
    const y = 12 + row * 16;
    for (let col = 0; col < 4; col++) {
      const x0 = col * 128 + 6;
      let s = '';
      const kind = r();
      if (kind < 0.4) for (let k = 0; k < 10; k++) s += '0123456789ABCDEF'[Math.floor(r() * 16)];
      else if (kind < 0.7) s = ['DYN_IV', 'KV62', 'GIZA', 'RA//SUN', 'BA//KA', 'NILE', 'SEKHMET', 'ANKH'][Math.floor(r() * 8)] + ' ' + Math.floor(r() * 9999);
      else s = '|| == // ++ ::'.slice(0, 6 + Math.floor(r() * 8));
      g.font = `${10 + Math.floor(r() * 4)}px "IBM Plex Mono", monospace`;
      g.globalAlpha = 0.5 + r() * 0.5;
      g.fillText(s, x0, y);
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function pointsGeometry(count, box, seed) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos.set([(r() - 0.5) * box[0], (r() - 0.5) * box[1], (r() - 0.5) * box[2]], i * 3);
    rnd.set([r(), r(), r()], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('rnd', new BufferAttribute(rnd, 3));
  return g;
}

export class RingsScene {
  // linksRoot: #room-links (section 4's links)
  constructor(cfg, { noise, mobile = false, reducedMotion = false, linksRoot = null }) {
    this.cfg = cfg;
    this.c = cfg.rings;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(22, 1, 0.01, 220);
    this.p = 0;
    this.lastP = 0;
    this.direction = 1;
    this.ready = false;
    this.noise = noise;
    // timeline state (igloo's names)
    this.pos = new Vector3(0, 1.5, -2);
    this.target = new Vector3(0, -2.5, -1);
    this.add = { upRotation: 0, upOriginal: 0 };
    this.fov = { value: 22 };
    this.look = { orbit: new Vector2(0.01, 0.005), aim: new Vector2(0, 0), roll: 0 };
    this.prox = { value: 0 };
    this.orbit = new Vector2();
    this.aim = new Vector2();
    this.rollNow = 0;
    this.mouseX = 0;
    this.linksRoot = linksRoot;
    this.floorSpin = { value: 0 }; // the floor's extra whirl on a link change
    this.simDt = 0; // the sculpture's simulation: time owed while it runs at half rate
    this.simSkip = false;
    // section 4's links (DOM): built here, not after the loads below, so they
    // work whatever fails in load(); the sculpture joins them when it has loaded
    this.links = new RoomLinks(linksRoot, {
      links: readLinks(linksRoot),
      camera: this.camera,
      color: this.cfg.room.arrows,
      onChange: (dir) => gsap.to(this.floorSpin, { value: this.floorSpin.value - 4 * dir, duration: 3, ease: 'power4.out', overwrite: true }),
    });
  }

  // Build everything (the stone texture loads first) and the composer.
  async load(renderer) {
    let stone;
    try {
      stone = await loadTexture('/assets/textures/detail/stone_detail.png'); // (off the main thread)
    } catch (err) {
      // the section still builds (and the links still show): flat stone
      console.error('[rings] the stone texture failed, flat stone', err);
      stone = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
      stone.needsUpdate = true;
    }
    stone.wrapS = stone.wrapT = RepeatWrapping;
    stone.minFilter = LinearMipmapLinearFilter;
    stone.anisotropy = 4;
    const colors = this.c.colors;
    const U = (this.U = sharedUniforms({ noise: this.noise, stone, colors }));
    const S = this.scene;
    const add = (mesh, y = 0, order = 0) => {
      mesh.position.y = y;
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      S.add(mesh);
      return mesh;
    };

    // the backdrop
    add(new Mesh(new SphereGeometry(100, 32, 32), backdropMaterial(U)), -12.15, -1);

    // the three rings, their membranes, plasma halos and smoke arms
    const ringMat = ringMaterial(U);
    const ringGeo = [shatteredRing({ shards: 6, seed: 11 }), shatteredRing({ shards: 4, seed: 23 }), shatteredRing({ shards: 6, seed: 37 })];
    this.rings = RING_Y.map((y, i) => {
      const m = add(new Mesh(ringGeo[i], ringMat), y, 3);
      m.rotation.x = -Math.PI / 2;
      return m;
    });
    const memGeo = new PlaneGeometry(1, 1);
    const memMat = membraneMaterial(U);
    this.membranes = [-1.5, -4.0, -6.5].map((y, i) => {
      const m = add(new Mesh(memGeo, memMat), y, 3 - i);
      m.rotation.x = -Math.PI / 2;
      m.scale.setScalar(0.65);
      return m;
    });
    const halo = domedAnnulus();
    const haloMat = plasmaMaterial(U);
    this.halos = [-1.6, -4.1, -6.6].map((y) => add(new Mesh(halo, haloMat), y, 4));
    const arm = smokeArm();
    const armMat = smokeMaterial(U, 'trail');
    this.arms = [-1.6, -4.1, -6.6].map((y) => add(new Mesh(arm, armMat), y, 5));

    // the shaft: dust wall, falling dust, glyph walls
    this.tunnel = add(new Mesh(insideCylinder(1.3, 9), smokeMaterial(U, 'tunnel')), 1, 1);
    this.dust = add(new Points(pointsGeometry(this.mobile ? 120 : 200, [3, 8, 3], 5), motesMaterial(U, 'shaft')), -3.5, 6);
    const atlas = (this.atlas = glyphAtlas());
    const panels = panelCylinder();
    const wallMat = glyphMaterial(U, atlas, { strength: 0.12, rising: false });
    this.wallA = add(new Mesh(panels, wallMat), -9.5, 0);
    this.wallA.scale.set(2, 9, 2);
    this.wallB = add(new Mesh(panels, wallMat), -9.5, 0);
    this.wallB.scale.set(3.3, 8, 3.3);

    // the room at the bottom
    this.roomGlyphMat = glyphMaterial(U, atlas, { strength: 0.45, rising: true });
    this.roomWallA = add(new Mesh(panels, this.roomGlyphMat), -10.33, 1);
    this.roomWallA.scale.setScalar(1.75);
    this.roomWallB = add(new Mesh(panels, this.roomGlyphMat), -10.33, 1);
    this.roomWallB.scale.setScalar(3.5);
    this.roomWallB.rotation.y = Math.PI / 2;
    this.floorMat = floorMaterial(U);
    this.floor = add(new Mesh(tieredFloor(), this.floorMat), -10.19, 3);
    this.floor.scale.setScalar(0.73);
    this.floor.rotation.y = Math.PI;
    const cyl = new CylinderGeometry(1, 1, 3, 64, 6, true);
    cyl.translate(0, 1.5, 0);
    this.containMat = containmentMaterial(U);
    this.contain = add(new Mesh(cyl, this.containMat), -10.13, 15);
    this.contain.scale.setScalar(0.28);
    const lightGeo = new PlaneGeometry(1, 1).rotateX(Math.PI / 2).translate(0, 1.5, 0);
    this.ringLight = add(new Mesh(lightGeo, ringLightMaterial(U)), -10.26, 3);
    this.ringLight.scale.setScalar(0.57);
    this.groundMat = smokeMaterial(U, 'ground');
    this.groundSmoke = add(new Mesh(domedAnnulus(), this.groundMat), -10.17, 2);
    this.groundSmoke.scale.set(5, 0.1, 5);
    this.ceilingMat = smokeMaterial(U, 'ceiling');
    this.ceilingSmoke = add(new Mesh(domedAnnulus({ r0: 0, r1: 0.62, y0: 0, y1: 0, u0: 0 }), this.ceilingMat), -9.4, 2);
    this.ceilingSmoke.scale.set(2, 0.1, 2);
    this.motesMat = motesMaterial(U, 'room');
    this.motes = add(new Points(pointsGeometry(60, [2.5, 0.5, 2.5], 9), this.motesMat), -9.61, 15);

    // section 4: the particle sculpture of the current link (the links, built
    // in the constructor, work without it)
    try {
      const sculpture = new ParticleSculpture(this.cfg.room, { shapes: this.links.links, resolution: U.uResolution, mobile: this.mobile });
      await sculpture.load(renderer);
      add(sculpture.group, -9.785, 0);
      this.sculpture = sculpture;
      this.links.attach(sculpture);
    } catch (err) {
      console.error('[room] the particle sculpture failed', err);
      this.sculpture = null;
    }

    this.buildComposer(renderer); // first: the timeline's flash callbacks use it
    this.buildTimeline();
    this.ready = true;
  }

  buildComposer(renderer) {
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.composer.autoRenderToScreen = false;
    this.flash = new RingFlashEffect({ glare: new Color(this.c.colors.glare) });
    const bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 0.3, // igloo: 0.2 (its picture is greyer; our gold blooms harder)
      intensity: 0.8,
      radius: 0.85,
      levels: this.mobile ? 4 : 6,
    });
    this.wipe = new WipePass();
    this.wipe.renderToScreen = true;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(this.camera, this.flash, bloom));
    this.smaaPass = new EffectPass(this.camera, new SMAAEffect({ preset: this.mobile ? SMAAPreset.LOW : SMAAPreset.MEDIUM }));
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.wipe);
    if (this.size) this.setSize(...this.size);
  }

  // igloo's entry timeline (createTimeline), one to one.
  buildTimeline() {
    const tl = (this.timeline = gsap.timeline({ paused: true }));
    const P = this.pos;
    const T = this.target;
    tl.to(P, { x: 0, z: 0, duration: 2.5, ease: 'power2.out' }, 0);
    tl.to(T, { x: 0, z: 0, duration: 2.5, ease: 'power2.out' }, 0);
    tl.to(P, { y: -9.83, duration: 7, ease: EASE.entry3 }, 0.2);
    tl.to(T, { y: -10, duration: 3, ease: 'power1.inOut' }, 0.2);
    tl.to(T, { y: -9.81, duration: 2.5, ease: 'power1.inOut' }, 3.2);
    tl.to(this.add, { upRotation: Math.PI, duration: 5.25, ease: 'power3.inOut' }, 1);
    tl.to(this.add, { upOriginal: 1, duration: 3.7, ease: EASE.entry }, 3.5);
    tl.fromTo(P, { z: 0 }, { z: -1.5, duration: 3.7, ease: EASE.entry, immediateRender: false }, 3.5);
    tl.to(P, { z: -3, duration: 2, ease: EASE.entry2 }, 7.2);
    tl.to(this.fov, { value: 30, duration: 7.2, ease: 'power1.inOut' }, 0);
    tl.to(this.look.orbit, { x: 0, y: 0, duration: 1, ease: 'power2.inOut' }, 4);
    tl.to(this.look.aim, { x: -0.03, y: -0.01, duration: 2, ease: 'power2.inOut' }, 4);
    tl.to(this.look, { roll: 0.05, duration: 2, ease: 'power2.inOut' }, 4);
    tl.to(T, { y: -10.35, duration: 2, ease: 'power2.in' }, 7.2);
    // the room
    tl.fromTo(this.floorMat.uniforms.uAlpha, { value: 0 }, { value: 1, duration: 5, ease: 'power2.out' }, 3.4);
    tl.fromTo(this.roomGlyphMat.uniforms.uAlpha, { value: 0 }, { value: 1, duration: 2, ease: 'power2.inOut' }, 4.5);
    tl.fromTo(this.containMat.uniforms.uAlpha, { value: 0 }, { value: 1, duration: 2, ease: 'power2.inOut' }, 4);
    tl.fromTo(this.groundMat.uniforms.uAlpha, { value: 0 }, { value: 1, duration: 3, ease: 'power2.out' }, 4.4);
    tl.fromTo(this.motesMat.uniforms.uAlpha, { value: 0 }, { value: 1, duration: 3, ease: 'power2.out' }, 4.4);
    // the sculpture, far below: fades in white warming to gold, its swirl
    // settles into the shape, then it takes its shading
    if (this.sculpture) {
      const m = this.sculpture.material.uniforms;
      tl.fromTo(m.uAlpha, { value: 0 }, { value: 1, duration: 2.5, ease: 'power2.inOut' }, 1.5);
      tl.fromTo(m.uInitialGlow, { value: 1 }, { value: 0, duration: 1, ease: 'power1.inOut' }, 3.9);
      tl.fromTo(this.sculpture.uniforms.uShowNoise, { value: 1 }, { value: 0, duration: 1.5, ease: 'power1.inOut' }, 3.5);
    }
    // the flashes: a fresh glitch pattern at each, weaker on the last going down
    const square = (strength) => () => {
      const s = strength ?? (this.direction === -1 ? 1 : 0.5);
      this.flash.uniforms.get('uSquareAttr').value.set(Math.random() * 25.424, Math.random() * 64.453, s);
    };
    const pulse = (at, out) => {
      tl.fromTo(this.prox, { value: 0 }, { value: 1, duration: 0.5, ease: 'power1.in', immediateRender: false }, at);
      tl.fromTo(this.prox, { value: 1 }, { value: 0, duration: out, ease: 'power1.out', immediateRender: false }, at + 0.5);
    };
    tl.call(square(1), null, 2);
    pulse(2, 0.4);
    tl.call(square(1), null, 2.95);
    pulse(2.95, 0.4);
    tl.call(square(null), null, 3.8);
    pulse(3.8, 0.6);
    tl.call(square(0.5), null, 4.9);
    tl.set({}, {}, DURATION); // the timeline's length
    tl.progress(1).progress(0);
  }

  setSize(w, h, dpr) {
    this.size = [w, h, dpr];
    this.camera.aspect = w / h;
    this.camera.zoom = Math.min(1, (w / h) * 1.5);
    this.camera.updateProjectionMatrix();
    if (this.U) this.U.uResolution.value.set(w * dpr, h * dpr);
    this.composer?.setSize(w, h, false);
  }

  // p: the section's progress (0..1); pointer: { ndc, active, look }.
  update(time, dt, { p, pointer }) {
    if (!this.ready) {
      this.links.update(p, pointer); // the links are DOM: they work without the scene
      return;
    }
    this.U.uTime.value = time;
    if (p !== this.lastP) this.direction = p > this.lastP ? 1 : -1;
    this.lastP = p;
    this.p = p;
    this.timeline.progress(Math.min(1, Math.max(0, p)));

    // what is on screen (igloo's progress windows: things behind the camera go)
    const win = (a, b) => p > a && p < b;
    const ringsUntil = [0.34, 0.43, 0.52];
    this.rings.forEach((m, i) => (m.visible = p < ringsUntil[i]));
    this.membranes.forEach((m, i) => (m.visible = win([0.1, 0.25, 0.36][i], ringsUntil[i])));
    this.halos.forEach((m, i) => (m.visible = win([0.06, 0.25, 0.35][i], ringsUntil[i])));
    this.arms.forEach((m, i) => (m.visible = win(0, [0.37, 0.47, 0.56][i])));
    this.tunnel.visible = this.dust.visible = p < 0.52;
    this.ringLight.visible = p > 0.53;
    const t = p * DURATION;
    this.floor.visible = this.groundSmoke.visible = this.motes.visible = t >= 3.4;
    this.contain.visible = t >= 4;
    this.roomWallA.visible = this.roomWallB.visible = this.ceilingSmoke.visible = t >= 4.5;
    if (this.sculpture) this.sculpture.group.visible = t >= 1.5;

    // spin with the camera's roll (igloo's factors)
    const roll = this.add.upRotation;
    this.rings.forEach((m) => (m.rotation.z = roll * 0.4));
    this.halos.forEach((m, i) => (m.rotation.y = (i * Math.PI) / 2 + roll * 0.5));
    this.arms.forEach((m, i) => (m.rotation.y = (i * Math.PI) / 2 + roll * 0.5));
    this.tunnel.rotation.y = roll * 0.65;
    this.wallB.rotation.y = roll * 0.65;
    this.wallA.rotation.y = roll * 0.65 + 2;
    this.floorMat.uniforms.uRotationTime.value = time * 0.5 + this.floorSpin.value;
    this.flash.uniforms.get('uRingProximity').value = this.reducedMotion ? 0 : this.prox.value;

    // the camera: lookAt(position, target, up), up rolling 180 degrees about
    // the shaft and then blending back to world up for the room; a little
    // mouse orbit early on, a look-around in the room (a mouse only: a touch
    // leaves the view centred, see IntroScene.pointer)
    const k = 1 - Math.exp(-dt * 2.1); // igloo's lerp 0.035 per 60 Hz frame
    const mx = pointer?.look?.x ?? 0;
    const my = pointer?.look?.y ?? 0;
    this.orbit.x += ((mx * Math.PI) / 2 * this.look.orbit.x - this.orbit.x) * k;
    this.orbit.y += ((my * Math.PI) / 2 * this.look.orbit.y - this.orbit.y) * k;
    this.aim.x += ((mx * Math.PI) / 2 * this.look.aim.x - this.aim.x) * k;
    this.aim.y += ((my * Math.PI) / 2 * this.look.aim.y - this.aim.y) * k;
    const vx = dt > 0 ? (mx - this.mouseX) / dt : 0;
    this.mouseX = mx;
    this.rollNow += (Math.max(-1, Math.min(1, vx * 0.5)) * this.look.roll - this.rollNow) * k;

    const cam = this.camera;
    const up = _up.set(0, 0, -1).applyAxisAngle(Y, this.add.upRotation).lerp(Y, this.add.upOriginal).normalize();
    const fwd = _fwd.subVectors(this.target, this.pos).normalize();
    const right = _right.crossVectors(fwd, up).normalize();
    const trueUp = _trueUp.crossVectors(right, fwd);
    const off = _off.subVectors(this.pos, this.target).applyAxisAngle(right, this.orbit.y).applyAxisAngle(trueUp, this.orbit.x);
    cam.position.copy(this.target).add(off);
    const dir = _dir.subVectors(this.target, cam.position).applyAxisAngle(right, this.aim.y).applyAxisAngle(trueUp, this.aim.x);
    cam.up.copy(up.applyAxisAngle(fwd, this.rollNow));
    cam.lookAt(_look.copy(cam.position).add(dir));
    if (cam.fov !== this.fov.value) {
      cam.fov = this.fov.value;
      cam.updateProjectionMatrix();
    }

    // section 4 (after the camera: the particles read where they fall on
    // screen). Up the shaft, before the floor shows (3.4), the sculpture is a
    // far glow of sub-pixel points: its simulation runs every other frame.
    if (this.sculpture?.group.visible) {
      this.simDt += dt;
      this.simSkip = t < 3.4 && !this.simSkip;
      if (!this.simSkip) {
        this.sculpture.update(time, this.simDt, { camera: cam, p, pointer, aspect: cam.aspect });
        this.simDt = 0;
      }
    }
    this.links.update(p, pointer);
  }

  // Section 3 is off screen: its links go.
  sleep() {
    this.links.disable();
  }

  // other: another section's finished frame to wipe with; progress: how far
  // the incoming one has come in (0..1 screens). Section 2 (vault) above:
  // section 3 comes in over it. The hero below (swap): it comes in over
  // section 3, at the end of the loop.
  render(renderer, { other = null, progress = 1, swap = false, dt = 0 } = {}) {
    if (!this.ready) return;
    const u = this.wipe.fullscreenMaterial.uniforms;
    u.tOther.value = other;
    u.uSwap.value = other && swap ? 1 : 0;
    u.uProgress.value = other ? progress : 1;
    // no anti-aliasing while a wipe is on (both scenes render; the cut's motion
    // and fringe hide the edges), to keep the frame in budget on slow GPUs
    this.smaaPass.enabled = !other;
    this.composer.render(dt);
  }

  // (main.js doesn't wait for it: the shaders compile in parallel, then the warm-up)
  async compile(renderer, other = null) {
    if (!this.ready) return;
    this.update(0, 0, { p: 0.3, pointer: null });
    await renderer.compileAsync(this.scene, this.camera);
    this.sculpture?.warm(this.camera); // igloo's second of simulation before it shows
    this.render(renderer, { progress: 1 });
    // the wipe's both ways
    if (other) {
      this.render(renderer, { other, progress: 0.5 });
      this.render(renderer, { other, progress: 0.5, swap: true });
    }
    this.update(0, 0, { p: 0, pointer: null });
  }

  dispose() {
    this.timeline?.kill();
    this.links.dispose();
    this.sculpture?.dispose();
    this.composer?.dispose();
    this.U?.uStone.value.dispose();
    this.atlas?.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
  }
}
