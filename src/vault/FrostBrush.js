// Brushing the sand frost off a crystal (igloo's mouse frost): a small
// ping-pong simulation in the crystal's second UV set. Each step the cleared
// area drifts a little (noise advection), spreads to its neighbours, gets the
// mouse's stroke painted in, and fades back to frosted. R = how clear, G = the
// patch's growing edge (the shader lights it). Steps at most ~66 per second
// so the feel doesn't depend on the frame rate.
import { Color, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, Raycaster, ShaderMaterial, Vector2, WebGLRenderTarget } from 'three';

export class FrostBrush {
  constructor({ size = 512, radius = 0.05, damping = 0.985, noise }) {
    const rt = () => new WebGLRenderTarget(size, size, { type: HalfFloatType, depthBuffer: false });
    this.targets = [rt(), rt()];
    this.index = 0;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tBuffer: { value: null },
        tNoise: { value: noise },
        uFrom: { value: new Vector2(-1, -1) },
        uTo: { value: new Vector2(-1, -1) },
        uRadius: { value: 0 },
        uDamping: { value: damping },
        uTexel: { value: 1 / size },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBuffer, tNoise;
        uniform vec2 uFrom, uTo;
        uniform float uRadius, uDamping, uTexel;
        varying vec2 vUv;
        float segment(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
          return length(pa - ba * h);
        }
        void main() {
          // drift: advected by a slow noise field
          vec2 adv = vec2(texture2D(tNoise, vUv * 0.19).r, texture2D(tNoise, vUv * 0.19 + 0.37).r) * 2.0 - 0.94;
          vec2 uv = vUv + adv * uTexel;
          // spread: the cleared patch grows into its neighbours
          float l = texture2D(tBuffer, uv - vec2(uTexel, 0.0)).r;
          float r = texture2D(tBuffer, uv + vec2(uTexel, 0.0)).r;
          float t = texture2D(tBuffer, uv + vec2(0.0, uTexel)).r;
          float b = texture2D(tBuffer, uv - vec2(0.0, uTexel)).r;
          float next = max(max(l, r), max(t, b));
          // the brush stroke since the last step
          float d = segment(vUv, uFrom, uTo) / max(uRadius, 1e-5);
          float s = clamp(1.0 - d, 0.0, 1.0);
          next += uRadius > 0.0 ? s * s * s : 0.0;
          next = min(next * uDamping, 1.0);
          float rim = max(next - texture2D(tBuffer, uv).r, 0.0);
          gl_FragColor = vec4(next, rim, 0.0, 1.0);
        }`,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.radius = radius;
    this.raycaster = new Raycaster();
    this.raycaster.layers.enableAll(); // the crystals live on VaultScene's main-pass layer
    this.hit = null; // brush position in UV1 (null = not on the crystal)
    this.last = new Vector2();
    this.speed = 0;
    this.clock = 0;
    this.pending = false;
  }

  get texture() {
    return this.targets[this.index].texture;
  }

  // Fully frosted.
  reset(renderer) {
    const prev = renderer.getRenderTarget();
    const color = renderer.getClearColor(this.clearColor ?? (this.clearColor = new Color()));
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of this.targets) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setClearColor(color, alpha);
    renderer.setRenderTarget(prev);
  }

  // Where the pointer touches the crystal (in its UV1), or null.
  aim(mesh, camera, ndc, active) {
    if (!active) {
      this.hit = null;
      return null;
    }
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    this.hit = hit?.uv1 ? hit.uv1.clone() : null;
    return hit ?? null;
  }

  // Advance the simulation (only while the crystal is on screen).
  step(renderer, dt) {
    this.clock += dt;
    if (this.clock < 0.015) return;
    this.clock = 0;
    const u = this.material.uniforms;
    // Brush size follows the stroke's speed: a still pointer clears nothing.
    let from = this.last;
    if (this.hit) {
      const moved = this.hit.distanceTo(this.last);
      if (moved > 0.3 || !this.pending) from = this.hit; // a jump (new stroke): no line across the crystal
      this.speed = this.speed * 0.8 + Math.min(moved * 40, 1) * 0.2;
      u.uFrom.value.copy(from);
      u.uTo.value.copy(this.hit);
      u.uRadius.value = this.radius * smoothstep(0.1, 1, this.speed);
      this.last.copy(this.hit);
      this.pending = true;
    } else {
      this.speed = 0;
      u.uRadius.value = 0;
      this.pending = false;
    }
    u.tBuffer.value = this.targets[this.index].texture;
    this.index ^= 1;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.targets[this.index]);
    renderer.render(this.quad, this.camera);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
