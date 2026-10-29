// Renderer, camera rig, background, asset loading, render loop and cleanup.
// Modules (pyramid, plexus, network, ground, sand) plug in via addModule();
// each may implement update(time, dt, scene), resize(width, height, dpr),
// objects() and dispose().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PostFX } from '../post/PostFX.js';
import { HAZE_GLSL, HAZE_UNIFORMS, NOISE_GLSL, hazeNoiseTexture } from './shaders/common.js';
import { fitFov } from './fitFov.js';

const MODELS = '/assets/models/';
const TEXTURES = '/assets/textures/';
const BAKES = ['pyramid', 'pyramid_exploded', 'ground', 'far', 'landmark'];
const DETAILS = ['sand', 'stone'];

const color = (c) => new THREE.Color(c);
const rad = THREE.MathUtils.degToRad;

export class IntroScene {
  // dpr: pin the pixel ratio (otherwise the cap from cfg.performance);
  // adaptive: lower the pixel ratio while frames are too slow.
  constructor(host, cfg, { mobile = false, onProgress = () => {}, dpr = null, adaptive = true, reducedMotion = false } = {}) {
    this.host = host;
    this.cfg = cfg;
    this.mobile = mobile;
    this.onProgress = onProgress;
    this.modules = [];
    this.listeners = [];
    this.running = false;
    this.elapsed = 0;

    const renderer = new THREE.WebGLRenderer({
      antialias: false, // the composer multisamples
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.dprPinned = dpr;
    const cap = this.pixelRatioCap();
    renderer.setPixelRatio(cap);
    this.adapt = { on: adaptive && !dpr, cap, frames: [], time: 0, skip: 60, bad: {}, onTime: 0 };
    renderer.toneMapping = THREE.NoToneMapping; // done in PostFX
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.1, 2000);
    const s = cfg.camera.scan;
    // Animated by the timeline. Angles in degrees.
    this.rig = {
      azimuth: s.azimuth,
      elevation: s.elevation,
      distance: s.distance,
      targetY: cfg.camera.target[1],
      fov: cfg.camera.fov, // vertical, degrees (the hero's is a touch wider)
      parallax: 0, // 0 during the intro, 1 in the idle hero
      idle: 0,
    };
    this.mouse = new THREE.Vector2();
    this.mouseSmooth = new THREE.Vector2();
    this.target = new THREE.Vector3(...cfg.camera.target);

    this.scene.fog = new THREE.FogExp2(color(cfg.colors.scanBg), 0);
    this.fogScan = color(cfg.colors.scanBg);
    this.fogWorld = color(cfg.colors.horizon);
    this.worldFogDensity = 0.0048;
    this.buildSky();

    const c = cfg.colors;
    const t = cfg.transition;
    this.post = new PostFX(renderer, this.scene, this.camera, {
      ...cfg.post,
      mobileBloomScale: cfg.performance.mobileBloomScale,
    }, {
      mobile,
      storm: {
        noise: hazeNoiseTexture(),
        colors: { light: c.stormLight, mid: c.stormMid, deep: c.stormDeep },
        wind: t.wind,
        parallax: t.parallax,
        fringe: t.fringe,
        reducedMotion,
      },
    });
    // The scroll into section 2 (StormTransition sets these): pull-back
    // offsets added to the rig, and the transition itself.
    this.exitOffset = null;
    this.transition = null;

    this.tick = this.tick.bind(this);
    this.on(window, 'resize', () => this.resize());
    // The pointer for the hero's hover and the touches the later sections
    // answer (pointer.ndc; a touch only counts while the finger is down), and
    // the cameras' parallax target (pointer.look, this.mouse). Only a mouse
    // moves the look: a touch moved the view toward wherever the screen was
    // touched and left it there, so on a phone the view stays centred.
    // Relative to the canvas, which can be taller than the window on phones
    // (see resize).
    this.pointer = { ndc: new THREE.Vector2(), active: false, look: this.mouse };
    const track = (e) => {
      if (this.pointerPinned) return;
      this.pointer.ndc.set((e.clientX / this.width) * 2 - 1, -((e.clientY / this.height) * 2 - 1));
      this.pointer.active = true;
      if (e.pointerType === 'mouse') this.mouse.copy(this.pointer.ndc);
    };
    const release = () => (this.pointer.active = false);
    this.on(window, 'pointermove', track);
    this.on(window, 'pointerdown', track);
    this.on(window, 'pointerup', (e) => e.pointerType === 'touch' && release());
    this.on(window, 'pointercancel', release);
    this.on(document.documentElement, 'pointerleave', release);
    this.on(window, 'blur', release);
    this.on(document, 'visibilitychange', () => (document.hidden ? this.pause() : this.resume()));
    this.resize();
  }

  // Pixel ratio to render at: ?dpr= pins it; otherwise the device ratio under
  // cfg.performance (maxDpr; on phones and tablets mobileDpr, and no more
  // than mobilePixels in all). Also the ceiling the adaptive resolution
  // climbs back to.
  pixelRatioCap() {
    const p = this.cfg.performance;
    if (this.dprPinned) return this.dprPinned;
    const device = window.devicePixelRatio || 1;
    if (!this.mobile) return Math.min(device, p.maxDpr);
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    return Math.min(device, p.mobileDpr, Math.sqrt(p.mobilePixels / (w * h)));
  }

  on(target, type, fn) {
    target.addEventListener(type, fn);
    this.listeners.push(() => target.removeEventListener(type, fn));
  }

  // Debug (?mouse=x,y): hold the pointer at a screen position (-1..1, y up)
  // so the hover can be checked without a real cursor.
  pinPointer(x, y) {
    this.pointerPinned = true;
    this.mouse.set(x, y);
    this.pointer.ndc.set(x, y);
    this.pointer.active = true;
  }

  // ---------------------------------------------------------------- sky
  // Flat scan gradient (screen-space) that transitions into the world sky.
  buildSky() {
    const c = this.cfg.colors;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uScanBot: { value: color(c.scanBg) },
          uScanTop: { value: color(c.scanBgTop) },
          uHorizon: { value: color(c.horizon) },
          uZenith: { value: color(c.zenith) },
          uSky: { value: 0 }, // 0 = flat scan background, 1 = world sky
          uRes: { value: new THREE.Vector2(1, 1) },
          ...HAZE_UNIFORMS, // blowing dust toward the horizon
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${NOISE_GLSL}
          ${HAZE_GLSL}
          uniform vec3 uScanBot, uScanTop, uHorizon, uZenith;
          uniform float uSky;
          uniform vec2 uRes;
          varying vec3 vDir;
          void main() {
            float sy = gl_FragCoord.y / uRes.y;
            vec3 scan = mix(uScanBot, uScanTop, smoothstep(0.4, 1.0, sy));
            vec3 world = mix(uHorizon, uZenith, smoothstep(0.0, 0.45, normalize(vDir).y));
            world = dustHaze(world, cameraPosition + normalize(vDir) * 300.0);
            gl_FragColor = vec4(mix(scan, world, uSky), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // 0 = flat grey-blue scan look, 1 = atmospheric world (sky + fog).
  set atmosphere(v) {
    this.sky.material.uniforms.uSky.value = v;
    this.scene.fog.color.lerpColors(this.fogScan, this.fogWorld, v);
    this.scene.fog.density = this.worldFogDensity * v;
    this._atmosphere = v;
  }

  get atmosphere() {
    return this._atmosphere ?? 0;
  }

  // ---------------------------------------------------------------- assets
  async load() {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => this.onProgress(loaded / total);
    const gltf = new GLTFLoader(manager);
    const texLoader = new THREE.TextureLoader(manager);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const loadTex = (url, setup) =>
      texLoader.loadAsync(url).then((t) => {
        t.anisotropy = maxAniso;
        setup(t);
        return t;
      });
    const bakes = BAKES.map((n) =>
      loadTex(`${TEXTURES}${n}_color.png`, (t) => {
        t.flipY = false; // glTF UV convention
        t.colorSpace = THREE.SRGBColorSpace;
      }),
    );
    const details = DETAILS.map((n) =>
      loadTex(`${TEXTURES}detail/${n}_detail.png`, (t) => {
        t.colorSpace = THREE.NoColorSpace; // a multiplier, not a colour
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
      }),
    );
    const modelUrl = (n) => (n === 'pyramid' ? this.cfg.assets.pyramid : `${MODELS}${n}.glb`);
    const models = ['pyramid', 'terrain', 'landmarks'].map((n) =>
      gltf.loadAsync(modelUrl(n)).then((g) => g.scene),
    );

    const [bakeTex, detailTex, modelScenes] = await Promise.all([
      Promise.all(bakes),
      Promise.all(details),
      Promise.all(models),
    ]);
    this.assets = {
      bakes: Object.fromEntries(BAKES.map((n, i) => [n, bakeTex[i]])),
      details: Object.fromEntries(DETAILS.map((n, i) => [n, detailTex[i]])),
      models: Object.fromEntries(['pyramid', 'terrain', 'landmarks'].map((n, i) => [n, modelScenes[i]])),
    };
    return this.assets;
  }

  addModule(module) {
    this.modules.push(module);
    for (const o of module.objects?.() ?? []) this.scene.add(o);
    module.resize?.(this.width, this.height, this.renderer.getPixelRatio());
    return module;
  }

  // Compile every shader (including the composer's) before the intro starts,
  // so no phase hitches the first time it appears.
  async compile() {
    const hidden = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    await this.renderer.compileAsync(this.scene, this.camera);
    this.updateCamera(0);
    this.post.render(0);
    // The storm pass and the screen output it takes over from SMAA.
    this.post.stormOn = true;
    this.transition?.compile(this.renderer);
    this.post.render(0);
    this.post.stormOn = false;
    // the frame into a texture (the end of the loop)
    this.post.renderTo(0);
    for (const o of hidden) o.visible = false;
  }

  // ---------------------------------------------------------------- loop
  start() {
    if (this.running) return;
    this.running = true;
    this.timer = new THREE.Timer();
    this.renderer.setAnimationLoop(this.tick);
  }

  pause() {
    if (!this.running) return;
    this.renderer.setAnimationLoop(null);
  }

  resume() {
    if (!this.running || document.hidden) return;
    this.timer.reset(); // no jump in elapsed time after a hidden tab
    this.adapt.frames.length = 0;
    this.adapt.time = 0;
    this.adapt.skip = 30;
    this.renderer.setAnimationLoop(this.tick);
  }

  tick(timestamp) {
    this.timer.update(timestamp);
    // Clamp: after resume() resets the timer, the next frame's timestamp can
    // be slightly older than the reset, which gives a negative delta.
    const raw = Math.max(this.timer.getDelta(), 0);
    const dt = Math.min(raw, 0.1);
    this.elapsed += dt;
    this.adaptResolution(raw);
    this.mouseSmooth.lerp(this.mouse, 1 - Math.exp(-dt * 3));
    const t = this.transition;
    t?.update(dt, this.elapsed);
    if (t?.heroHidden) {
      // Past the storm: only section 2 / 3 is on screen.
      t.renderSection(this.renderer);
      return;
    }
    this.updateCamera(dt);
    for (const m of this.modules) m.update?.(this.elapsed, dt, this);
    if (t?.heroLoop) {
      // The end of the loop: the hero rising in over section 3.
      t.renderLoop(this.renderer, this.post.renderTo(dt));
      return;
    }
    t?.beforeHeroRender(this.renderer);
    this.post.render(dt);
  }

  // Median frame time over ~1.5 s: slower than minFps -> a lower pixel ratio
  // (two steps when far too slow, so a slow phone gets there in one go);
  // clearly faster (25 % headroom) -> back up toward the cap, unless that
  // ratio was too slow recently (each failure keeps it off for twice as long,
  // so it can't flip-flop). On a 60 Hz screen frames can't show headroom:
  // there it tries a step up after two windows with every frame on time
  // (the slowest tenth within a quarter of the fastest) and the page at rest,
  // since a change costs a hitch. Without that a phone stayed at whatever a
  // slow moment had stepped it down to. Skips the frames right after start,
  // resume and each change (uploads, resizes).
  adaptResolution(dt) {
    const a = this.adapt;
    if (!a.on) return;
    // Not while two scenes are being blended (the sandstorm, a section wiping
    // in): those frames cost both scenes for one screen of scroll. Reacting
    // to them stepped the resolution down mid-wipe, and every step
    // reallocates the buffers: a 0.1-0.3 s freeze and a jump in sharpness,
    // twice (down, then back up). Those frames don't count.
    if (this.transition?.compositing) {
      a.frames.length = 0;
      a.time = 0;
      return;
    }
    if (a.skip > 0) {
      a.skip--;
      return;
    }
    a.frames.push(dt);
    a.time += dt;
    if (a.time < 1.5 || a.frames.length < 20) return;
    const f = a.frames.sort((x, y) => x - y);
    const median = f[f.length >> 1];
    const onTime = f[Math.floor(f.length * 0.9)] < f[Math.floor(f.length * 0.1)] * 1.25;
    a.frames.length = 0;
    a.time = 0;
    const p = this.cfg.performance;
    const dpr = this.renderer.getPixelRatio();
    const key = (v) => v.toFixed(2);
    const slow = median > 1 / p.minFps;
    a.onTime = onTime && !slow ? a.onTime + 1 : 0;
    let next = dpr;
    if (slow) {
      const bad = (a.bad[key(dpr)] ??= { until: 0, wait: 10 });
      bad.wait *= 2;
      bad.until = this.elapsed + bad.wait;
      next = Math.max(p.minDpr, dpr * p.dprStep ** (median > 1.5 / p.minFps ? 2 : 1));
    } else if (median < 1 / (p.minFps * 1.25) || (a.onTime >= 2 && (this.transition?.speed ?? 0) < 0.01)) {
      const up = Math.min(a.cap, dpr / p.dprStep);
      if (this.elapsed >= (a.bad[key(up)]?.until ?? 0)) next = up;
    }
    if (Math.abs(next - dpr) < 0.01) return;
    this.renderer.setPixelRatio(next);
    this.resize(true);
    a.skip = 30;
    a.onTime = 0;
  }

  updateCamera() {
    const r = this.rig;
    const c = this.cfg.camera;
    const x = this.exitOffset; // the pull-back into section 2, if scrolling
    const idle = Math.sin(this.elapsed * 0.13) * c.idleDrift * r.idle;
    const az = rad(r.azimuth + (x?.azimuth ?? 0) + this.mouseSmooth.x * c.parallax * r.parallax + idle);
    const el = rad(r.elevation + (x?.elevation ?? 0) + this.mouseSmooth.y * c.parallax * 0.5 * r.parallax);
    const distance = r.distance + (x?.distance ?? 0);
    this.target.y = r.targetY + (x?.targetY ?? 0);
    this.camera.position.set(
      this.target.x + distance * Math.cos(el) * Math.cos(az),
      this.target.y + distance * Math.sin(el),
      this.target.z + distance * Math.cos(el) * Math.sin(az),
    );
    this.camera.lookAt(this.target);
    if (r.fov !== this.fovShown) this.applyFov();
    this.camera.updateMatrixWorld(); // modules raycast / project before the render
    this.sky.position.copy(this.camera.position);
  }

  // The stage is the large viewport's height (base.css), so a phone's toolbar
  // sliding in and out (a resize event each time) changes nothing here: no
  // buffers reallocated mid-scroll. force: the pixel ratio changed.
  resize(force = false) {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    // a new size can move a phone's cap (mobilePixels)
    const cap = this.pixelRatioCap();
    if (!force && Math.abs(cap - this.adapt.cap) > 0.01) {
      this.adapt.cap = cap;
      this.adapt.bad = {};
      if (this.renderer.getPixelRatio() > cap) this.renderer.setPixelRatio(cap);
    }
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyFov();
    const dpr = this.renderer.getPixelRatio();
    this.sky.material.uniforms.uRes.value.set(w * dpr, h * dpr);
    for (const m of this.modules) m.resize?.(w, h, dpr);
    this.transition?.resize(w, h, dpr);
  }

  // Vertical field of view from the rig; on screens wider than maxAspect the
  // horizontal one stays at maxAspect's (the world ends past it), on ones
  // narrower than minAspect (portrait phones) at minAspect's.
  applyFov() {
    const fov = this.rig.fov;
    this.camera.fov = fitFov(fov, this.camera.aspect, this.cfg.camera);
    this.camera.updateProjectionMatrix();
    this.fovShown = fov;
  }

  // ---------------------------------------------------------------- cleanup
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.running = false;
    for (const off of this.listeners) off();
    for (const m of this.modules) m.dispose?.();
    this.transition?.dispose();
    const textures = new Set();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of mats) {
        for (const u of Object.values(mat.uniforms ?? {})) if (u.value?.isTexture) textures.add(u.value);
        if (mat.map) textures.add(mat.map);
        mat.dispose();
      }
    });
    for (const t of Object.values(this.assets?.bakes ?? {})) textures.add(t);
    for (const t of Object.values(this.assets?.details ?? {})) textures.add(t);
    for (const t of textures) t.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
