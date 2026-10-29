// Phase E: the environment (baked terrain, distant pyramids) revealed
// outward from the pyramid as a stepped, irregular blob. One set of shared
// uniforms drives every world material, so a single tween animates the reveal.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Points, ShaderMaterial } from 'three';
import { createBakedMaterial } from './shaders/bakedMaterial.js';
import { NOISE_GLSL, REVEAL_GLSL } from './shaders/common.js';

export class RevealGround {
  // hero: BlockMotion's shared uniforms, for the gold glow on the sand around
  // the pyramid (live hero).
  constructor(assets, cfg, { hero = null } = {}) {
    const r = cfg.reveal;
    this.cfg = cfg;
    this.uniforms = {
      uReveal: { value: 0 },
      uCellSize: { value: r.cellSize },
      uNoiseAmt: { value: r.noiseAmount },
      uNoiseScale: { value: r.noiseScale },
      uBandWidth: { value: r.bandWidth },
      uPop: { value: r.pop },
      uBandColor: { value: new Color(cfg.colors.revealBand) },
      uRevealDone: { value: 0 }, // 1 once everything is revealed: shaders skip the front's noise
    };
    const { terrain, landmarks } = assets.models;
    const B = assets.bakes;
    const D = assets.details;
    const mat = (bake, kind, heroGlow = null) =>
      createBakedMaterial({ bake: B[bake], sandDetail: D.sand, stoneDetail: D.stone, kind, reveal: this.uniforms, hero: heroGlow });
    const heroGlow = hero && {
      uGroundMouse: hero.uGroundMouse,
      uPulse: hero.uPulse,
      uHover: hero.uHover,
      uTime: hero.uTime,
      uGlow: { value: new Color(cfg.colors.glow) },
      uGroundGlow: { value: cfg.blocks.groundGlow },
      uMouseGlow: { value: cfg.blocks.mouseGlow },
    };

    terrain.getObjectByName('DUNE_Base').material = mat('ground', 'sand', heroGlow);
    terrain.getObjectByName('DUNE_Far').material = mat('far', 'sand');
    const landmark = mat('landmark', 'stone');
    landmarks.traverse((o) => {
      if (o.isMesh) o.material = landmark;
    });

    this.group = new Group();
    this.group.name = 'RevealGround';
    this.group.add(terrain, landmarks);
    this.dots = this.buildDots(terrain.getObjectByName('DUNE_Base'), cfg);
  }

  // Sparse dotted patch on the sand under the pyramid (sampled from the real
  // terrain so dots sit on it). Appears just before the ground and fades as
  // the reveal passes under each dot.
  buildDots(base, cfg) {
    const src = base.geometry.attributes.position;
    const pts = [];
    let seed = 1234;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < src.count; i++) {
      const x = src.getX(i);
      const z = src.getZ(i);
      const r = Math.hypot(x, z);
      if (r > 9.5 || (Math.abs(x) < 2.6 && Math.abs(z) < 2.6)) continue;
      if (rnd() > 0.28) continue; // sparse
      pts.push(x, src.getY(i) + 0.03, z, r / 9.5, rnd());
    }
    const n = pts.length / 5;
    const pos = new Float32Array(n * 3);
    const data = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos.set(pts.slice(i * 5, i * 5 + 3), i * 3);
      data.set(pts.slice(i * 5 + 3, i * 5 + 5), i * 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aData', new BufferAttribute(data, 2));
    const dots = new Points(
      geo,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        uniforms: {
          ...this.uniforms,
          uProgress: { value: 0 },
          uFade: { value: 0 },
          uPixelRatio: { value: 1 },
          uColor: { value: new Color(cfg.colors.line) },
        },
        vertexShader: /* glsl */ `
          attribute vec2 aData;
          uniform float uPixelRatio;
          varying vec2 vData;
          varying vec3 vWorld;
          void main() {
            vData = aData;
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_PointSize = 2.2 * uPixelRatio;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${NOISE_GLSL}
          ${REVEAL_GLSL}
          uniform float uProgress, uFade;
          uniform vec3 uColor;
          varying vec2 vData;
          varying vec3 vWorld;
          void main() {
            if (vData.x > uProgress) discard;
            float d = length(gl_PointCoord - 0.5);
            float a = (1.0 - smoothstep(0.3, 0.5, d)) * (0.35 + 0.5 * vData.y) * uFade;
            a *= 1.0 - smoothstep(0.0, 1.5, revealBehind(vWorld.xz));
            gl_FragColor = vec4(uColor * 1.4, a);
          }`,
      }),
    );
    dots.frustumCulled = false;
    dots.renderOrder = 3;
    return dots;
  }

  objects() {
    return [this.group, this.dots];
  }

  get dotsProgress() {
    return this.dots.material.uniforms.uProgress.value;
  }

  set dotsProgress(v) {
    this.dots.material.uniforms.uProgress.value = v;
  }

  get dotsFade() {
    return this.dots.material.uniforms.uFade.value;
  }

  set dotsFade(v) {
    this.dots.material.uniforms.uFade.value = v;
    this.dots.visible = v > 0.001;
  }

  resize(w, h, dpr) {
    this.dots.material.uniforms.uPixelRatio.value = dpr;
  }

  // Radius of the reveal front (m). 0 = nothing, cfg.reveal.maxRadius = all.
  get reveal() {
    return this.uniforms.uReveal.value;
  }

  set reveal(v) {
    this.uniforms.uReveal.value = v;
    this.uniforms.uRevealDone.value = v >= this.cfg.reveal.maxRadius ? 1 : 0;
  }
}
