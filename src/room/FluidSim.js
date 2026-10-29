// A small screen-space fluid (igloo's, for the room's sculpture: 128², no
// dye, no vorticity, 3 pressure iterations) stirred by the pointer. The
// sculpture's particles read its velocity where they fall on screen and get
// pushed along it.
//
// Each frame: the pointer's last move is splatted in as a line of force
// (radius 0.22, force 35, the first move after a 0.15 s pause only resets
// it), then the usual stable-fluids passes: divergence, pressure (decayed
// to 0.86 per 60 Hz frame first), gradient subtraction, self-advection
// (velocity kept at 0.98 per frame).
import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';

const VERT = /* glsl */ `
  uniform vec2 texelSize;
  varying vec2 vUv, vL, vR, vT, vB;
  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const pass = (uniforms, body) =>
  new ShaderMaterial({
    uniforms: { texelSize: { value: new Vector2() }, ...uniforms },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv, vL, vR, vT, vB;
      ${body}`,
    depthTest: false,
    depthWrite: false,
  });

function doubleTarget(res, filter) {
  const make = () => new WebGLRenderTarget(res, res, { type: HalfFloatType, format: RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false });
  const t = { read: make(), write: make() };
  t.swap = () => ([t.read, t.write] = [t.write, t.read]);
  return t;
}

export class FluidSim {
  constructor({ res = 128, radius = 0.22, force = 35, pressureIterations = 3, velocityDissipation = 0.98, pressureDissipation = 0.86 } = {}) {
    this.res = res;
    this.radius = radius;
    this.force = force;
    this.iterations = pressureIterations;
    this.velocityDissipation = velocityDissipation;
    this.pressureDissipation = pressureDissipation;
    this.velocity = doubleTarget(res, LinearFilter);
    this.pressure = doubleTarget(res, NearestFilter);
    this.divergence = new WebGLRenderTarget(res, res, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    this.texture = { value: this.velocity.read.texture }; // what the particles read
    // the pointer (0..1, y up)
    this.point = new Vector2(0.5, 0.5);
    this.prev = new Vector2(0.5, 0.5);
    this.lastUpdate = 0;
    this.lastSplat = 0;

    this.splat = pass(
      { uTarget: { value: null }, aspectRatio: { value: 1 }, color: { value: new Vector3() }, point: { value: new Vector2() }, prevPoint: { value: new Vector2() }, radius: { value: radius } },
      /* glsl */ `
      uniform sampler2D uTarget;
      uniform float aspectRatio, radius;
      uniform vec3 color;
      uniform vec2 point, prevPoint;
      float line(vec2 uv, vec2 a, vec2 b) {
        vec2 pa = uv - a, ba = b - a;
        pa.x *= aspectRatio;
        ba.x *= aspectRatio;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
        return length(pa - ba * h);
      }
      void main() {
        float k = clamp(1.0 - line(vUv, prevPoint, point) / radius, 0.0, 1.0);
        gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + k * k * k * color, 1.0);
      }`,
    );
    this.div = pass(
      { uVelocity: { value: null } },
      /* glsl */ `
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }`,
    );
    this.clear = pass(
      { uTexture: { value: null }, value: { value: 1 } },
      /* glsl */ `
      uniform sampler2D uTexture;
      uniform float value;
      void main() { gl_FragColor = vec4(value * texture2D(uTexture, vUv).rgb, 1.0); }`,
    );
    this.jacobi = pass(
      { uPressure: { value: null }, uDivergence: { value: null } },
      /* glsl */ `
      uniform sampler2D uPressure, uDivergence;
      void main() {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        gl_FragColor = vec4((L + R + B + T - texture2D(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
      }`,
    );
    this.gradient = pass(
      { uPressure: { value: null }, uVelocity: { value: null } },
      /* glsl */ `
      uniform sampler2D uPressure, uVelocity;
      void main() {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        gl_FragColor = vec4(texture2D(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
      }`,
    );
    this.advect = pass(
      { uVelocity: { value: null }, dt: { value: 1 }, dissipation: { value: 1 } },
      /* glsl */ `
      uniform sampler2D uVelocity;
      uniform vec2 texelSize;
      uniform float dt, dissipation;
      void main() {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        gl_FragColor = vec4(texture2D(uVelocity, coord).rgb * dissipation, 1.0);
      }`,
    );
    for (const m of [this.splat, this.div, this.clear, this.jacobi, this.gradient, this.advect]) m.uniforms.texelSize.value.setScalar(1 / res);

    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new Mesh(tri, this.splat);
    this.quad.frustumCulled = false;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  run(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.quad, this.camera);
  }

  // time (s), dtRatio (60 Hz frames this frame), pointer (0..1, y up), aspect.
  update(renderer, time, dtRatio, pointer, aspect) {
    const before = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const v = this.velocity;
    this.point.copy(pointer);
    if (time - this.lastUpdate >= 0.016) {
      const dx = this.point.x - this.prev.x;
      const dy = this.point.y - this.prev.y;
      if (dx || dy) {
        const fresh = time - this.lastSplat > 0.15; // a first move after a pause: no push
        const u = this.splat.uniforms;
        u.uTarget.value = v.read.texture;
        u.aspectRatio.value = aspect;
        u.point.value.copy(this.point);
        u.prevPoint.value.copy(fresh ? this.point : this.prev);
        u.color.value.set(dx * aspect, dy, 0).multiplyScalar(fresh ? 0 : this.force);
        this.run(renderer, this.splat, v.write);
        v.swap();
        this.lastSplat = time;
      }
      this.lastUpdate = time;
      this.prev.copy(this.point);
    }
    this.div.uniforms.uVelocity.value = v.read.texture;
    this.run(renderer, this.div, this.divergence);
    this.clear.uniforms.uTexture.value = this.pressure.read.texture;
    this.clear.uniforms.value.value = this.pressureDissipation ** dtRatio;
    this.run(renderer, this.clear, this.pressure.write);
    this.pressure.swap();
    this.jacobi.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.iterations; i++) {
      this.jacobi.uniforms.uPressure.value = this.pressure.read.texture;
      this.run(renderer, this.jacobi, this.pressure.write);
      this.pressure.swap();
    }
    this.gradient.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradient.uniforms.uVelocity.value = v.read.texture;
    this.run(renderer, this.gradient, v.write);
    v.swap();
    this.advect.uniforms.uVelocity.value = v.read.texture;
    this.advect.uniforms.dt.value = dtRatio;
    this.advect.uniforms.dissipation.value = this.velocityDissipation ** dtRatio;
    this.run(renderer, this.advect, v.write);
    v.swap();
    this.texture.value = v.read.texture;
    renderer.setRenderTarget(before);
    renderer.autoClear = autoClear;
  }

  dispose() {
    for (const t of [this.velocity.read, this.velocity.write, this.pressure.read, this.pressure.write, this.divergence]) t.dispose();
    for (const m of [this.splat, this.div, this.clear, this.jacobi, this.gradient, this.advect]) m.dispose();
    this.quad.geometry.dispose();
  }
}
