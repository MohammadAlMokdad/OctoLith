// Section 2, the relic vault (igloo's showcase cubes): one sand-frosted quartz
// crystal per screen of scroll, stacked downward, with a relic inside that is
// only ever seen through the glass. Each frame:
//   1. pre-pass  (layer 1): backdrop, drifting text, the relics -> transmission
//                target (half resolution, mipmapped: the frost blurs it)
//   2. main pass (layer 2): backdrop, drifting text, the crystals refracting
//                the pre-pass, dust plumes -> this.target (linear, MSAA)
//   3. the storm blends this.target over the hero (render), or it goes to the
//      screen with a little grain and vignette once the hero is gone
//      (renderToScreen)
// Crystals spin as they scroll in and out (igloo's numbers) and settle facing
// the camera with a slow wobble. The mouse brushes their sand frost off.
import {
  AdditiveBlending,
  Box3,
  Color,
  EquirectangularReflectionMapping,
  Group,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  CanvasTexture,
  UnsignedByteType,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { createCrystalMaterial } from './crystalMaterial.js';
import { FrostBrush } from './FrostBrush.js';
import { fitFov } from '../scene/fitFov.js';
import { loadTexture } from '../scene/loadTexture.js';
import { DetailScene } from './DetailScene.js';

const PRE = 1; // layer: the transmission pre-pass only
const MAIN = 2; // layer: the main pass only
const MODELS = '/assets/models/';
const TEXTURES = '/assets/textures/';

// Deterministic per-crystal randomness (igloo re-rolls it per visit).
const rand = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class VaultScene {
  constructor(cfg, { noise, mobile = false, reducedMotion = false }) {
    this.cfg = cfg;
    this.v = cfg.vault;
    this.noise = noise;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.v.camera.fov, 1, 0.1, 100);
    this.camera.layers.enable(PRE);
    this.camera.layers.enable(MAIN);
    this.scene.add(this.camera);
    this.crystals = [];
    this.q = 0; // screens of scroll into the section (crystal i centred at q = i)
    this.time = 0;
    this.sway = { x: 0, y: 0 };
    this.zoom = { value: 0 }; // m toward the crystal (the relic's page opening)
    this.wobbleAmount = { value: 1 }; // the crystals' idle wobble (stills as a page opens)
    this.page = null; // DetailScene, the relic's page
    this.brush = true; // the mouse brushes frost off (off while a page is open)
    this.ready = false;

    // Everything here stays within 0..1 (the crystals clamp), so 8-bit sRGB
    // storage: half the bandwidth of half-float for the 4x MSAA, and no
    // banding in the dark gradient. Sampling decodes it back to linear.
    this.target = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, colorSpace: SRGBColorSpace, samples: mobile ? 0 : 4 });
    this.transmission = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    this.buildBackdrop();
    this.buildDriftText();
    this.buildOutput();
  }

  get texture() {
    return this.target.texture;
  }

  // ---------------------------------------------------------------- backdrop
  // The vault viewer's warm, dusty centre falling off to dark edges, with
  // slow dust in the light; fixed to the camera, seen in both passes.
  buildBackdrop() {
    const c = this.cfg.colors;
    this.backdrop = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        depthWrite: false,
        uniforms: {
          uInner: { value: new Color(c.sectionInner) },
          uOuter: { value: new Color(c.sectionOuter) },
          uDust: { value: new Color(c.stormMid) },
          uNoise: { value: this.noise },
          uTime: { value: 0 },
          uScroll: { value: 0 },
          uAspect: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uNoise;
          uniform vec3 uInner, uOuter, uDust;
          uniform float uTime, uScroll, uAspect;
          varying vec2 vUv;
          float N(vec2 q) { return texture2D(uNoise, q * 0.0625).r; }
          void main() {
            vec2 p = vec2(vUv.x * uAspect, vUv.y);
            float d = length((vUv - vec2(0.5, 0.56)) * vec2(1.5, 1.0));
            vec3 col = mix(uInner, uOuter, smoothstep(0.0, 0.66, d));
            // dust hanging in the light, drifting and parallaxing with the scroll
            float haze = N(p * 1.3 + vec2(-uTime * 0.025, uTime * 0.008 - uScroll * 0.35));
            col += uDust * 0.2 * smoothstep(0.35, 0.8, haze) * (1.0 - smoothstep(0.0, 0.75, d));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.backdrop.position.z = -14;
    this.backdrop.renderOrder = -10;
    this.backdrop.layers.set(PRE);
    this.backdrop.layers.enable(MAIN);
    this.camera.add(this.backdrop);
  }

  // ---------------------------------------------------------------- drifting text
  // igloo's blurry text, as catalogue scraps from the dig: soft gold lines at
  // different depths, drifting slowly; the camera's scroll parallaxes them.
  buildDriftText() {
    const lines = [
      'DYNASTY_IV // GIZA',
      '29°58′45″N 31°08′03″E',
      'SAND_FROST 0.82',
      'KV62 // THEBES',
      'ANKH // LIFE',
      'BASTET // BUBASTIS',
      'c. 2560 BC',
      'VAULT_03 SEALED',
    ];
    const rowH = 128;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = rowH * lines.length;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '500 64px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      lines.forEach((t, i) => {
        ctx.filter = `blur(${1 + (i % 3) * 1.2}px)`;
        ctx.fillText(t, 24, rowH * (i + 0.5));
      });
    };
    draw();
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    // the page's mono font may still be loading: redraw once it's in
    document.fonts?.load('500 64px "IBM Plex Mono"').then(() => {
      draw();
      tex.needsUpdate = true;
    });
    const color = new Color(this.cfg.colors.hud);
    this.drift = [];
    const n = this.v.relics.length;
    for (let i = 0; i < 14; i++) {
      const row = i % lines.length;
      const m = new Mesh(
        new PlaneGeometry(1, rowH / 1024),
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: {
            uMap: { value: tex },
            uRow: { value: row },
            uRows: { value: lines.length },
            uColor: { value: color },
            uOpacity: { value: 0.08 + rand(i, 3) * 0.12 },
          },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            uniform sampler2D uMap;
            uniform float uRow, uRows, uOpacity;
            uniform vec3 uColor;
            varying vec2 vUv;
            void main() {
              float a = texture2D(uMap, vec2(vUv.x, (uRows - 1.0 - uRow + vUv.y) / uRows)).r;
              gl_FragColor = vec4(uColor, a * uOpacity);
            }`,
        }),
      );
      const scale = 1.4 + rand(i, 1) * 1.6;
      m.scale.set(scale, scale, 1);
      // spread around the crystals' column, behind them
      const side = i % 2 ? 1 : -1;
      m.position.set(side * (1.3 + rand(i, 2) * 2.2), 3 - rand(i, 4) * (n * this.v.spacing + 3), -2.5 - rand(i, 5) * 4.5);
      m.userData.speed = (0.04 + rand(i, 6) * 0.08) * side;
      m.renderOrder = -5;
      m.layers.set(PRE);
      m.layers.enable(MAIN);
      this.scene.add(m);
      this.drift.push(m);
    }
  }

  // ---------------------------------------------------------------- output
  // To the screen, with a little vignette and grain. While a relic's page
  // opens or closes (detail.p / detail.p2), igloo's dissolve: both pictures
  // warped by sand-frost displacement that zooms in as the page opens and a
  // slow sideways drift, split by igloo's spectral fringing, crossfading.
  buildOutput() {
    this.detail = { p: 0, p2: 0 }; // dissolve, settle (0 = crystals, 1 = the relic's page)
    this.outCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.outQuad = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tScene: { value: this.target.texture },
          tDetail: { value: null },
          tNoise: { value: this.noise },
          uDetail: { value: 0 },
          uDetail2: { value: 0 },
          uTime: { value: 0 },
          uAspect: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tScene, tDetail, tNoise;
          uniform float uTime, uDetail, uDetail2, uAspect;
          varying vec2 vUv;
          float N(vec2 q) { return texture2D(tNoise, q * 0.0625).r; }
          float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float fit(float x, float a, float b, float c, float d) {
            return clamp(c + (x - a) / (b - a) * (d - c), min(c, d), max(c, d));
          }
          // igloo's chromatic aberration: 5 samples along a barrel distortion,
          // each weighted by a colour of the spectrum
          float caLin(float t) { return clamp(1.0 - abs(2.0 * t - 1.0), 0.0, 1.0); }
          float caRemap(float t, float a, float b) { return clamp((t - a) / (b - a), 0.0, 1.0); }
          vec2 caBarrel(vec2 c, float amt) { vec2 cc = c - 0.5; return c + cc * dot(cc, cc) * amt; }
          vec3 caSpectrum(float t) {
            float lo = step(t, 0.5);
            float w = caLin(caRemap(t, 1.0 / 6.0, 5.0 / 6.0));
            return pow(vec3(lo, 1.0, 1.0 - lo) * vec3(1.0 - w, w, 1.0 - w), vec3(1.0 / 2.2));
          }
          vec3 spectral(sampler2D tex, vec2 uv, float maxDistort, float bend) {
            vec3 sum = vec3(0.0), weights = vec3(0.0);
            for (int i = 0; i < 5; i++) {
              float t = float(i) / 5.0;
              vec3 w = caSpectrum(t);
              weights += w;
              sum += w * texture2D(tex, caBarrel(uv, bend * maxDistort * t)).rgb;
            }
            return sum / weights;
          }
          void main() {
            vec3 col;
            if (uDetail <= 0.0) {
              col = texture2D(tScene, vUv).rgb;
            } else if (uDetail >= 1.0 && uDetail2 >= 1.0) {
              col = texture2D(tDetail, vUv).rgb;
            } else {
              vec2 uvTex = (vUv - 0.5) * vec2(uAspect, 1.0) + 0.5;
              float transition = fit(uDetail, 0.4, 1.0, 0.0, 1.0);
              float noise = hash(gl_FragCoord.xy + fract(uTime) * 91.0);
              float modulator = 8.0 * smoothstep(1.0, 0.5, abs(vUv.x * 2.0 - 1.0)) * smoothstep(1.0, 0.5, abs(vUv.y * 2.0 - 1.0));
              // a slow sideways drift (igloo's "tech" displacement)
              vec2 dispTech = vec2((N((uvTex - 0.5) * 1.6 + 3.3) * 2.0 - 0.94) * 0.005, 0.0);
              // sand frost: fine grain that zooms in as the page opens (igloo: ice)
              vec2 uvDisp = (uvTex - 0.5) * 5.0 * (1.0 - uDetail);
              float tDisp = N(uvDisp * 4.0 + 1.7) * 2.0 - 0.94;
              vec2 disp = vec2(tDisp) * 0.1;
              vec3 a = vec3(0.0);
              vec3 b = vec3(0.0);
              if (transition < 1.0) {
                float k = fit(uDetail, 0.1, 0.9, 0.0, 1.0);
                a = spectral(tScene, vUv + disp * k * k + dispTech * (1.0 - pow(1.0 - uDetail, 5.0)), modulator, (1.0 - pow(1.0 - uDetail, 3.0)) * noise);
              }
              if (transition > 0.0) {
                b = spectral(tDetail, vUv + disp * fit(uDetail, 0.1, 0.9, 1.0, 0.0) + dispTech * fit(uDetail2, 0.7, 1.0, 1.0, 0.0), modulator, (1.0 - pow(uDetail2, 3.0)) * noise);
              }
              col = mix(a, b, transition);
            }
            float v = length(vUv - 0.5) * 1.25;
            col *= 1.0 - 0.35 * smoothstep(0.35, 1.0, v);
            col += (hash(vUv * 1000.0 + fract(uTime) * 61.0) - 0.5) * 0.025;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.outQuad.frustumCulled = false;
  }

  // ---------------------------------------------------------------- assets
  // Loaded in the background once the hero is up (section 2 is reached by scrolling).
  async load(renderer) {
    const gltf = new GLTFLoader();
    // (decoded off the main thread: the hero is on screen meanwhile)
    const map = (name, color) =>
      loadTexture(`${TEXTURES}${name}.png`, { flipY: false }).then((t) => {
        t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
        t.anisotropy = 8;
        return t;
      });
    const r = this.v.relics;
    const [vault, relics, env, bakes, normals, roughs, darkBakes] = await Promise.all([
      gltf.loadAsync(`${MODELS}vault.glb`).then((g) => g.scene),
      gltf.loadAsync(`${MODELS}relics.glb`).then((g) => g.scene),
      new EXRLoader().loadAsync(`${TEXTURES}env_vault.exr`),
      Promise.all(r.map((s) => map(`relic_${s.bake}_color`, true))),
      Promise.all(r.map((s) => map(`${s.maps}_normal`, false))),
      Promise.all(r.map((s) => map(`${s.maps}_roughness`, false))),
      Promise.all(r.map((s) => map(`relic_${s.bake}_dark_color`, true))), // for the relic's page
    ]);
    env.mapping = EquirectangularReflectionMapping;
    const pmrem = new PMREMGenerator(renderer);
    this.envMap = pmrem.fromEquirectangular(env).texture;
    pmrem.dispose();
    env.dispose();

    const g = this.v.glass;
    r.forEach((slot, i) => {
      const group = new Group();
      group.position.y = -this.v.spacing * i;
      const crystal = vault.getObjectByName(slot.crystal);
      const relic = relics.getObjectByName(slot.relic);
      // Pivot about the crystal's own centre.
      const centre = new Box3().setFromObject(crystal).getCenter(new Vector3());
      const pivot = new Group();
      pivot.position.copy(centre).negate();
      crystal.position.set(0, 0, 0);
      relic.position.set(0, 0, 0);
      crystal.material = createCrystalMaterial({
        glass: g,
        normalMap: normals[i],
        roughnessMap: roughs[i],
        envMap: this.envMap,
        rimColor: this.cfg.colors.frostRim,
      });
      relic.material = new MeshBasicMaterial({ map: bakes[i] });
      crystal.layers.set(MAIN);
      relic.layers.set(PRE);
      crystal.renderOrder = 3;
      pivot.add(crystal, relic);
      const spin = new Group(); // rotated by the scroll
      spin.add(pivot);
      group.add(spin, this.buildPlume(i));
      this.scene.add(group);
      const frost = new FrostBrush({ ...this.v.frost, size: this.mobile ? 256 : this.v.frost.size, noise: this.noise });
      crystal.material.userData.uniforms.tFrost.value = frost.texture;
      this.crystals.push({ group, spin, crystal, relic, frost, bounds: new Box3().setFromObject(crystal) });
    });
    for (const c of this.crystals) c.frost.reset(renderer);
    // The relic's own page (click to explore), sharing the relic geometry.
    this.page = new DetailScene(this.cfg, { noise: this.noise, mobile: this.mobile });
    this.page.setRelics(this.crystals.map((c) => c.relic), darkBakes);
    if (this.size) this.page.setSize(...this.size);
    this.ready = true;
  }

  // A plume of dust under each crystal (igloo's smoke), facing the camera,
  // fading as the crystal scrolls away.
  buildPlume(i) {
    const m = new Mesh(
      new PlaneGeometry(3.2, 3.6),
      new ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uNoise: { value: this.noise },
          uColor: { value: new Color(this.cfg.colors.stormMid) },
          uTime: { value: 0 },
          uSeed: { value: i * 3.7 },
          uFade: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            // billboard: the plane always faces the camera
            vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            mv.xy += position.xy;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uNoise;
          uniform vec3 uColor;
          uniform float uTime, uSeed, uFade;
          varying vec2 vUv;
          float N(vec2 q) { return texture2D(uNoise, q * 0.0625).r; }
          void main() {
            // igloo's smoke: two noise layers rising slowly, strongest in a
            // ring around the middle, faded to nothing at the plane's edge
            vec2 st = vUv * vec2(1.5, 1.1) + vec2(uSeed, -uTime * 0.07);
            float n = N(st * 2.0) * N(st * 1.1 + 4.0) * 4.0;
            float r = length(vUv - vec2(0.5, 0.42)) * 2.0;
            float grad = (1.0 - smoothstep(0.2, 1.0, r)) * smoothstep(0.0, 0.5, r);
            float a = clamp(n * grad, 0.0, 1.0) * uFade;
            gl_FragColor = vec4(uColor * a * 0.12, 1.0);
          }`,
      }),
    );
    m.position.y = -0.45;
    m.renderOrder = 15;
    m.frustumCulled = false;
    m.layers.set(MAIN);
    return m;
  }

  // ---------------------------------------------------------------- frame
  // q: screens of scroll into the section (crystal i centred at q = i);
  // speed: |dq/dt| (screens/s); pointer: IntroScene.pointer.
  update(time, dt, { q, speed = 0, pointer }) {
    this.time = time;
    this.q = q;
    const v = this.v;
    const n = v.relics.length;
    const motion = this.reducedMotion ? 0 : 1;
    // Camera: down the column with the scroll, a little mouse sway, and a
    // tighter lens while scrolling fast (igloo: 45 - 5 x scroll velocity).
    const k = 1 - Math.exp(-dt * 3);
    this.sway.x += ((pointer?.look?.x ?? 0) * v.camera.sway[0] * motion - this.sway.x) * k;
    this.sway.y += ((pointer?.look?.y ?? 0) * v.camera.sway[1] * motion - this.sway.y) * k;
    const y = -v.spacing * q;
    this.camera.position.set(this.sway.x, y + this.sway.y, v.camera.z + this.zoom.value);
    this.camera.lookAt(0, y, 0);
    const fov = fitFov(v.camera.fov, this.camera.aspect, v.camera) - 5 * Math.min(1, speed) * motion;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    const bu = this.backdrop.material.uniforms;
    bu.uTime.value = time;
    bu.uScroll.value = q;
    for (const m of this.drift) m.position.x += m.userData.speed * dt * motion;
    for (const m of this.drift) if (Math.abs(m.position.x) > 6) m.position.x = -Math.sign(m.position.x) * 6;

    this.crystals.forEach((c, i) => {
      // igloo: the further from centre (in scroll progress), the more it spins
      const a = (i - q) / (n + 1);
      const o = rand(i, 9) < 0.5 ? -1 : 1;
      const [sy, sx, sz] = v.spin;
      const w = (s) => Math.sin(time * 0.3 + rand(i, s) * 12.4) * v.wobble * this.wobbleAmount.value * Math.sign(rand(i, s + 1) - 0.5) * motion;
      c.spin.rotation.set(
        sx * -o * (1 - (0.1 + rand(i, 2) * 0.2)) * a + w(3),
        sy * o * (1 - (0.1 + rand(i, 1) * 0.1)) * a + w(5),
        sz * o * (1 - (0.1 + rand(i, 4) * 0.15)) * a + w(7),
      );
      c.near = Math.abs(i - q) < 0.75; // on screen
      c.focus = 1 - Math.min(1, Math.abs(i - q) / 0.35); // centred, for the HUD
      const plume = c.group.children[1].material.uniforms;
      plume.uTime.value = time;
      plume.uFade.value = Math.max(0, 1 - Math.abs(a) * 20);
    });
    this.pointer = pointer;
    this.dt = dt;
    if (this.detail.p > 0) this.page?.update(time, dt, pointer);
  }

  // Pre-pass + main pass into this.target (the storm blends it over the hero).
  render(renderer) {
    const prev = renderer.getRenderTarget();
    this.scene.updateMatrixWorld();
    // The brush follows the mouse itself: a still cursor over a crystal that
    // scrolls or turns under it doesn't paint (igloo brushes on mouse moves).
    // Between mouse events (they come slower than frames) the brush holds its
    // last point; 0.15 s without a move ends the stroke (igloo's timeout).
    const ndc = this.pointer?.ndc;
    const moved = !!ndc && (!this.lastNdc || ndc.distanceToSquared(this.lastNdc) > 1e-8);
    if (ndc) (this.lastNdc ??= ndc.clone()).copy(ndc);
    if (moved) this.lastMove = this.time;
    const stroking = this.time - (this.lastMove ?? -1) < 0.15;
    // only the crystals on screen are drawn; the centred one takes the brush
    for (const c of this.crystals) {
      c.group.visible = c.near;
      if (!c.near) continue;
      if (!stroking || !this.brush || c.focus <= 0.5) c.frost.hit = null;
      else if (moved) c.frost.aim(c.crystal, this.camera, ndc, this.pointer.active);
      c.frost.step(renderer, this.dt ?? 0);
      c.crystal.material.userData.uniforms.tFrost.value = c.frost.texture;
    }

    // Clear explicitly: the renderer is shared with the hero's postprocessing
    // composer, which turns autoClear off (stale depth + colour would smear).
    this.camera.layers.set(PRE);
    renderer.setRenderTarget(this.transmission);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    const size = this.transmission.width;
    for (const c of this.crystals) {
      const u = c.crystal.material.userData.uniforms;
      u.tTransmission.value = this.transmission.texture;
      u.uTransmissionSize.value.set(size, this.transmission.height);
    }
    this.camera.layers.set(MAIN);
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }

  renderToScreen(renderer) {
    this.renderTo(renderer, null);
  }

  // The same frame into a target (section 3 wipes in over it).
  renderTo(renderer, target) {
    const d = this.detail;
    const pageOnly = d.p >= 1 && d.p2 >= 1;
    if (!pageOnly) this.render(renderer); // the crystals (not needed once the page covers them)
    if (d.p > 0 && this.page) this.page.render(renderer);
    const u = this.outQuad.material.uniforms;
    u.uTime.value = this.time;
    u.uDetail.value = d.p;
    u.uDetail2.value = d.p2;
    u.tDetail.value = this.page?.texture ?? null;
    renderer.setRenderTarget(target);
    // clear explicitly: the shared renderer has autoClear off (the composers)
    if (target) renderer.clear(true, true, false);
    renderer.render(this.outQuad, this.outCamera);
    if (target) renderer.setRenderTarget(null);
  }

  setSize(w, h, dpr) {
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    this.target.setSize(W, H);
    this.transmission.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    // the backdrop fills the view at its depth
    const height = 2 * Math.tan((fitFov(this.v.camera.fov, this.camera.aspect, this.v.camera) * Math.PI) / 360) * 14 * 1.15;
    this.backdrop.scale.set(height * this.camera.aspect, height, 1);
    this.backdrop.material.uniforms.uAspect.value = this.camera.aspect;
    this.outQuad.material.uniforms.uAspect.value = this.camera.aspect;
    this.page?.setSize(w, h, dpr);
    this.size = [w, h, dpr];
  }

  // Compile the vault's shaders before it is first seen.
  compile(renderer) {
    return renderer.compileAsync(this.scene, this.camera).then(() => this.render(renderer));
  }

  dispose() {
    this.target.dispose();
    this.transmission.dispose();
    for (const c of this.crystals) c.frost.dispose();
    this.envMap?.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    this.outQuad.geometry.dispose();
    this.outQuad.material.dispose();
  }
}
