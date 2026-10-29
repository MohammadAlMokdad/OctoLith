// The relic's own page (igloo's project detail scene), in the vault's palette:
// a dark chamber with a diagonal gradient, a soft shaft of light from the top
// right, a pool of light with bokeh at the bottom left, drifting dust, and the
// relic itself (its dark bake) barely lit, with light rippling over it like
// caustics. The camera dollies in as it opens. Rendered into this.target;
// VaultScene dissolves it in over the crystals.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { fitFov } from '../scene/fitFov.js';

const rand = (i, k) => {
  const x = Math.sin(i * 91.7 + k * 47.3) * 43758.5453;
  return x - Math.floor(x);
};

const NOISE = /* glsl */ `
  uniform sampler2D uNoise;
  float N(vec2 q) { return texture2D(uNoise, q * 0.0625).r; }
`;

export class DetailScene {
  constructor(cfg, { noise, mobile = false }) {
    this.cfg = cfg;
    this.d = cfg.vault.detail;
    this.noise = noise;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.d.camera.fov, 1, 0.1, 50);
    this.camera.position.set(0, 0, this.d.camera.from);
    this.target = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, colorSpace: SRGBColorSpace, samples: mobile ? 0 : 4 });
    this.dolly = { z: this.d.camera.from };
    this.relicX = this.d.camera.x; // right of centre; centred on portrait screens (setSize)
    this.wobble = { value: 0 };
    this.relics = [];
    this.time = 0;
    this.sway = { x: 0, y: 0 };
    this.light = new Color(this.d.light);
    this.buildBackground();
    this.buildLights();
    this.buildDust();
  }

  get texture() {
    return this.target.texture;
  }

  // ---------------------------------------------------------------- chamber
  buildBackground() {
    const [c1, c2] = this.d.bg;
    this.bg = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { uColor1: { value: new Color(c1) }, uColor2: { value: new Color(c2) }, uAspect: { value: 1 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.999, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor1, uColor2;
          uniform float uAspect, uTime;
          varying vec2 vUv;
          float hash12(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * .1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }
          void main() {
            // igloo: a diagonal gradient, mostly dark, dithered against banding
            vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 0.5;
            float a = -0.66;
            uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv + 0.5;
            float g = pow(clamp(uv.y, 0.0, 1.0), 3.0) * 0.5;
            g += (hash12(vUv * 1000.0 + uTime) - 0.5) * 0.01;
            gl_FragColor = vec4(mix(uColor1, uColor2, g), 1.0);
          }`,
      }),
    );
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.scene.add(this.bg);
  }

  // igloo's light shaft (top right) and light pool with bokeh (bottom left).
  buildLights() {
    const plane = (fragment, opacity) =>
      new Mesh(
        new PlaneGeometry(1, 1),
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { uNoise: { value: this.noise }, uColor: { value: this.light }, uTime: { value: 0 }, uOpacity: { value: opacity } },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            ${NOISE}
            uniform vec3 uColor;
            uniform float uTime, uOpacity;
            varying vec2 vUv;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            void main() {
              float round = pow(1.0 - clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0), 2.0);
              ${fragment}
              gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
            }`,
        }),
      );
    // shaft: two layers of noise drifting through a soft round falloff
    this.shaft = plane(
      `float t = uTime * 0.12;
       float n = N(vUv * vec2(4.0, 1.8) + vec2(t, t * 0.323)) + N(vUv * vec2(2.0, 1.0) + vec2(-t * 0.77, -t * 0.414));
       float a = round * n;`,
      0.09,
    );
    this.shaft.position.set(1.67, 0.79, 0);
    this.shaft.scale.set(1.5, 3, 1);
    this.shaft.rotation.z = (-40 * Math.PI) / 180;
    // pool: a soft glow with bokeh discs flickering in it
    this.pool = plane(
      `vec2 g = vUv * 9.0;
       vec2 id = floor(g);
       float disc = step(0.72, hash(id)) * smoothstep(0.42, 0.3, length(fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.3));
       float bokeh = disc * N(vUv * 6.0 + uTime * 0.6) * 2.5;
       float a = round + bokeh * round;`,
      0.12,
    );
    this.pool.position.set(-2.05, -0.87, 1);
    this.pool.scale.set(4, 4, 4);
    this.scene.add(this.shaft, this.pool);
  }

  // Bokeh motes (igloo's 250) and fine dust, drifting slowly.
  buildDust() {
    const make = (count, size, alpha) => {
      const pos = new Float32Array(count * 3);
      const rnd = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos.set([rand(i, 1) * 4 - 2, rand(i, 2) * 4 - 2, (i / count - 0.5) * 2], i * 3);
        rnd.set([rand(i, 3), rand(i, 4), rand(i, 5)], i * 3);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('aRand', new BufferAttribute(rnd, 3));
      const points = new Points(
        geo,
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { uColor: { value: this.light }, uTime: { value: 0 }, uSize: { value: size }, uAlpha: { value: alpha }, uPixelRatio: { value: 1 } },
          vertexShader: /* glsl */ `
            attribute vec3 aRand;
            uniform float uTime, uSize, uPixelRatio;
            varying float vAlpha;
            void main() {
              float t = uTime * 0.1;
              vec3 p = position;
              p.x += sin(t * 0.4 + position.y * 2.5);
              p.y += sin(t * 0.2 + position.x * 2.5);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              // bigger and softer toward the screen's edges (out of focus)
              vec2 ndc = gl_Position.xy / gl_Position.w;
              float edge = smoothstep(0.2, 1.2, length(ndc));
              gl_PointSize = uSize * mix(0.4, 1.0, aRand.x) * (1.0 + edge * 2.0) * uPixelRatio / max(-mv.z, 0.3);
              vAlpha = mix(0.25, 1.0, aRand.y) * (0.5 + 0.5 * sin(uTime * (0.5 + aRand.z) + aRand.x * 30.0)) / (1.0 + edge * 2.0);
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uAlpha;
            varying float vAlpha;
            void main() {
              float d = length(gl_PointCoord - 0.5);
              float a = smoothstep(0.5, 0.15, d) * vAlpha * uAlpha;
              gl_FragColor = vec4(uColor * a, 1.0);
            }`,
        }),
      );
      points.frustumCulled = false;
      return points;
    };
    this.motes = make(250, 40, 0.18);
    this.fine = make(600, 6, 0.5);
    this.scene.add(this.motes, this.fine);
  }

  // The relics, sharing VaultScene's loaded geometry, in their dark bakes
  // with light rippling over them.
  setRelics(meshes, darkBakes) {
    this.relics = meshes.map((src, i) => {
      const m = new Mesh(
        src.geometry,
        new ShaderMaterial({
          uniforms: {
            uMap: { value: darkBakes[i] },
            uNoise: { value: this.noise },
            uLight: { value: this.light },
            uTime: { value: 0 },
          },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            varying vec3 vPos;
            void main() {
              vUv = uv;
              vPos = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            ${NOISE}
            uniform sampler2D uMap;
            uniform vec3 uLight;
            uniform float uTime;
            varying vec2 vUv;
            varying vec3 vPos;
            // ridged noise: thin bright lines where it crosses its middle;
            // two layers drifting apart, kept where both are bright (igloo: min)
            float ripple(vec2 p) { return 1.0 - abs(N(p) * 2.0 - 0.94); }
            void main() {
              // igloo: the object barely lit (a few % of its bake), shown by
              // light rippling over it, brighter where its surface is bright
              vec3 base = texture2D(uMap, vUv).rgb;
              float t = uTime;
              vec3 col = base * mix(0.025, 0.12, N(vPos.xy * 2.4 + vec2(-t * 0.1, t * 0.023)));
              float c = min(ripple(vPos.xy * 5.0 + vec2(-t * 0.1, t * 0.023)), ripple(vPos.xy * 6.5 + vec2(t * 0.05, -t * 0.013) + 7.1));
              c = pow(c, 12.0);
              col += uLight * c * (0.06 + dot(base, vec3(0.3, 0.5, 0.2)) * 1.1);
              gl_FragColor = vec4(col, 1.0);
              #include <colorspace_fragment>
            }`,
        }),
      );
      m.visible = false;
      m.userData.rand = rand(i, 11);
      // centred on its own bounds (some relics sit off their origin)
      src.geometry.computeBoundingBox();
      m.userData.centre = src.geometry.boundingBox.getCenter(new Vector3());
      this.scene.add(m);
      return m;
    });
  }

  show(index) {
    this.relics.forEach((m, i) => (m.visible = i === index));
    this.index = index;
  }

  update(time, dt, pointer) {
    this.time = time;
    const k = 1 - Math.exp(-dt * 2);
    this.sway.x += ((pointer?.look?.x ?? 0) * 0.05 - this.sway.x) * k;
    this.sway.y += ((pointer?.look?.y ?? 0) * 0.03 - this.sway.y) * k;
    // igloo's slow camera shake + the dolly
    const shake = (s) => Math.sin(time * 0.05 * 6.28 + s) * 0.05;
    this.camera.position.set(this.sway.x + shake(1.3), this.sway.y + shake(4.1), this.dolly.z);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.bg.material.uniforms.uTime.value = time;
    for (const m of [this.shaft, this.pool, this.motes, this.fine]) m.material.uniforms.uTime.value = time;
    this.pool.position.x = -2.2 + Math.sin(time * 0.3) * 0.2;
    this.pool.position.y = -0.87 + Math.cos(time * 0.24) * 0.2;
    const m = this.relics[this.index];
    if (m) {
      m.material.uniforms.uTime.value = time;
      const s = 0.035 * this.wobble.value;
      const r = m.userData.rand;
      const w = (k2) => Math.sin(time * 0.3 + r * k2) * s * Math.sign(r - 0.5);
      m.rotation.set(w(12.4), w(43.0) + 0.25, w(2.5)); // turned a little toward the text
      const c = m.userData.centre;
      m.position.set(this.relicX - c.x, -c.y, -c.z);
    }
  }

  render(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false); // autoClear is off (shared with the composer)
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }

  setSize(w, h, dpr) {
    this.target.setSize(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    this.camera.fov = fitFov(this.d.camera.fov, aspect, this.d.camera);
    this.camera.updateProjectionMatrix();
    // the text takes the whole width of a portrait screen: the relic moves to the middle
    this.relicX = this.d.camera.x * Math.min(1, Math.max(0, (aspect - 0.7) / 0.5));
    this.bg.material.uniforms.uAspect.value = aspect;
    for (const p of [this.motes, this.fine]) p.material.uniforms.uPixelRatio.value = dpr * (h / 900);
  }

  dispose() {
    this.target.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        if (!this.relics.includes(o)) o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
}
