// Section 4, the room's particle sculpture (igloo's footer "container
// particles"): 150 000 particles simulated on the GPU that gather into the
// current link's shape, spin slowly, and scatter where the pointer stirs them.
//
// Each particle has a home on the shape's surface and, every frame (per
// 60 Hz frame, scaled by dtRatio), igloo's forces:
//   - a spring back home, which loses its hold on particles the pointer pushes
//   - the shape: its distance field (volumes.js), sampled at the particle.
//     igloo pulls particles in along the surface normal from outside (0.0015
//     x 0.6) and leaves those inside free; ours holds them onto the surface
//     from both sides, near home (see below)
//   - the pointer: a screen-space fluid (FluidSim) pushes it along the
//     camera's right / up (0.0005 x the room's interaction ramp)
//   - a divergence-free flow noise (0.00014, + 0.0004 while bursting)
//   - friction (x 0.9), then a cylinder (r 0.275, y -0.34..0.35) holds it.
// Each particle also keeps its light (wrapped diffuse from the shape's normal,
// x 0.2 deep inside) and a smoothed speed. Drawn as lit round sprites: dark
// to light by that light, brighter when fast, fainter when very fast (a
// poor man's motion blur), blended so dark particles darken the room behind
// them and light ones stay light.
//
// Where ours differs: igloo scatters the homes through the cube (spring
// 0.001) and turns the shape through still particles. That suits its solid
// penguin, but on thin glyphs most particles landed on the strokes' sides and
// the faces came out patchy, and spinning left ragged trails. So here each
// shape brings its own homes, spread evenly over its surface, the spring is
// firm enough to settle them (0.003, about critically damped), the surface
// pull only acts within a few cm of home and towards it (it stranded
// particles on the nearest stroke and hung strings of them in the gaps), and
// the particles live in the shape's own frame: the whole cloud turns with it.
//
// igloo reads a per-particle random number in its simulation, but its
// full-screen pass never supplies one, so every particle runs with the
// defaults (0, 0, 0, 1). The numbers below are the ones it actually runs with.
import gsap from 'gsap';
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  AddEquation,
  Data3DTexture,
  DataTexture,
  FloatType,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  Points,
  RGBAFormat,
  ShaderMaterial,
  SrcAlphaFactor,
  SrcColorFactor,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { FluidSim } from './FluidSim.js';

const CUBE = 0.65; // the volume's cube (m) at scale 1; the particles start scattered through it
const SPIN = 0.75; // rad/s (igloo: 0.00075 per ms)
const HOME_PULL = 0.003; // per frame, of the way home (igloo: 0.001, to homes in the cube)

// Gradient noise with its analytic gradient (quintic fade, integer-hashed
// corner gradients), and a flow made of two of them: cross(grad a, grad b) has
// no divergence, so the particles swirl without bunching up.
const FLOW_GLSL = /* glsl */ `
  uvec3 hash3u(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
  }
  vec3 cornerGrad(vec3 c) { return vec3(hash3u(uvec3(ivec3(c) + 32768))) * (2.0 / 4294967295.0) - 1.0; }
  vec3 noiseGrad(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    vec3 g000 = cornerGrad(i), g100 = cornerGrad(i + vec3(1, 0, 0)), g010 = cornerGrad(i + vec3(0, 1, 0)), g110 = cornerGrad(i + vec3(1, 1, 0));
    vec3 g001 = cornerGrad(i + vec3(0, 0, 1)), g101 = cornerGrad(i + vec3(1, 0, 1)), g011 = cornerGrad(i + vec3(0, 1, 1)), g111 = cornerGrad(i + vec3(1, 1, 1));
    float v000 = dot(g000, f), v100 = dot(g100, f - vec3(1, 0, 0)), v010 = dot(g010, f - vec3(0, 1, 0)), v110 = dot(g110, f - vec3(1, 1, 0));
    float v001 = dot(g001, f - vec3(0, 0, 1)), v101 = dot(g101, f - vec3(1, 0, 1)), v011 = dot(g011, f - vec3(0, 1, 1)), v111 = dot(g111, f - vec3(1, 1, 1));
    // the corner gradients blended, plus the change of the blend weights
    vec3 g = mix(mix(mix(g000, g100, u.x), mix(g010, g110, u.x), u.y), mix(mix(g001, g101, u.x), mix(g011, g111, u.x), u.y), u.z);
    float kx = mix(mix(v100 - v000, v110 - v010, u.y), mix(v101 - v001, v111 - v011, u.y), u.z);
    float ky = mix(mix(v010 - v000, v110 - v100, u.x), mix(v011 - v001, v111 - v101, u.x), u.z);
    float kz = mix(mix(v001 - v000, v101 - v100, u.x), mix(v011 - v010, v111 - v110, u.x), u.y);
    return g + du * vec3(kx, ky, kz);
  }
  vec3 flow(vec3 p, float t) {
    return cross(noiseGrad(p + vec3(0.0, 0.0, t)), noiseGrad(p + vec3(31.416, 17.17 + t, 47.9))) * 0.6;
  }
`;

const SIM_VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SIM_FRAG = /* glsl */ `
  precision highp sampler3D;
  #define outPos pc_fragColor
  layout(location = 1) out highp vec4 outVel;
  uniform sampler2D tPos, tVel, tHome, tFluid;
  uniform sampler3D tVolume;
  uniform mat4 uModelMatrix, uViewMatrix, uProjMatrix;
  uniform vec3 uLightPos;
  uniform float uRotation, uRebase, uVolumeScale, uInteractForce, uAdditionalNoise, uShowNoise, uTime, uDtRatio;
  ${FLOW_GLSL}
  mat3 spinY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  void main() {
    ivec2 id = ivec2(gl_FragCoord.xy);
    vec4 pos = texelFetch(tPos, id, 0);
    vec4 vel = texelFetch(tVel, id, 0);
    float dt = uDtRatio;

    // positions are in the shape's frame (turned by uRotation to the room's,
    // igloo's spin); a link change re-bases them so nothing on screen jumps
    mat3 rebase = spinY(uRebase);
    pos.xyz = rebase * pos.xyz;
    vel.xyz = rebase * vel.xyz;
    mat3 toRoom = transpose(spinY(uRotation));

    // the shape: distance (volume units) and outward normal
    vec4 vol = texture(tVolume, pos.xyz / ${CUBE.toFixed(2)} * uVolumeScale + 0.5);
    vec3 normal = normalize(vol.rgb * 2.0 - 1.0);
    float dist = (vol.a * 2.0 - 1.0) * 2.0;

    // the pointer's fluid where the particle shows on screen pushes it along
    // the camera's right and up; pushed particles let go of their homes
    vec4 clip = uProjMatrix * uViewMatrix * uModelMatrix * vec4(toRoom * pos.xyz, 1.0);
    vec2 fluid = texture(tFluid, clip.xy / clip.w * 0.5 + 0.5).xy;
    vec3 camRight = vec3(uViewMatrix[0][0], uViewMatrix[1][0], uViewMatrix[2][0]);
    vec3 camUp = vec3(uViewMatrix[0][1], uViewMatrix[1][1], uViewMatrix[2][1]);
    vel.xyz += ((camRight * fluid.x + camUp * fluid.y) * toRoom) * 0.0005 * dt * uInteractForce;
    float hold = 1.0 - length(fluid) * 0.65 * uInteractForce;

    // swirl (stronger while bursting into a new shape or fading in)
    float burst = max(uAdditionalNoise, uShowNoise);
    vel.xyz += flow(pos.xyz * 7.0, uTime) * (0.00014 + 0.0004 * burst) * dt;

    // home, and the shape's pull (outside: 0.6, on the surface: 0.3, inside: none)
    vec3 toHome = texelFetch(tHome, id, 0).xyz * (${CUBE.toFixed(2)} / uVolumeScale) - pos.xyz;
    vel.xyz += toHome * ${HOME_PULL} * dt * hold;
    // the shape holds particles onto its surface (igloo's pull, 0.0009, from
    // outside; ours also from inside, so the swirl can't dent the strokes),
    // but only within a few cm of home and where that heads homewards:
    // otherwise it strands particles on the nearest stroke or hangs them in
    // the gap between two strokes, short of homes on the other
    float onto = -clamp(dist / 0.01, -1.0, 1.0); // along the normal: in from outside, out from inside
    float near = 1.0 - smoothstep(0.01, 0.04, length(toHome));
    near *= smoothstep(-0.2, 0.2, sign(onto) * dot(normal, toHome) / max(length(toHome), 1e-5));
    vel.xyz += normal * onto * 0.0009 * dt * hold * near;

    vel.xyz *= pow(0.9, dt);
    pos.xyz += vel.xyz * dt;

    // the containment cylinder
    pos.y = clamp(pos.y, -0.34, 0.35);
    float r = length(pos.xz);
    if (r > 0.275) pos.xz *= 0.275 / r;

    // light: wrapped diffuse from the shape's normal plus a little bounce,
    // dimmed deep inside; held while bursting
    vec3 L = normalize(uLightPos) * toRoom; // the room's light, in the shape's frame
    float dp = dot(L, normal);
    float light = max(0.0, (dp + 0.25) / 1.25) + max(0.0, -dp) * 0.1;
    pos.w = mix(mix(light * 0.2, light, smoothstep(-0.05, -0.001, dist)), pos.w, burst);
    // the speed, smoothed (0.035 per frame)
    vel.w = mix(vel.w, length(vel.xyz), 1.0 - pow(0.965, dt));

    outPos = pos;
    outVel = vel;
  }
`;

const INIT_FRAG = /* glsl */ `
  #define outPos pc_fragColor
  layout(location = 1) out highp vec4 outVel;
  uniform sampler2D tPos;
  void main() {
    outPos = texelFetch(tPos, ivec2(gl_FragCoord.xy), 0);
    outVel = vec4(0.0);
  }
`;

const DRAW_VERT = /* glsl */ `
  attribute vec2 texuv;
  uniform sampler2D tPos, tVel;
  uniform vec2 uResolution;
  uniform float uSize, uRotation;
  varying float vLight, vSpeed;
  void main() {
    vec4 p = texture2D(tPos, texuv);
    vLight = p.w;
    vSpeed = texture2D(tVel, texuv).w;
    float c = cos(uRotation), s = sin(uRotation);
    vec3 room = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); // the shape's frame turned into the room's
    vec4 mv = modelViewMatrix * vec4(room, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize / length(mv.xyz) * (uResolution.y / 1300.0);
  }
`;

const DRAW_FRAG = /* glsl */ `
  uniform vec3 uDark, uLight, uFast, uGlow, uLightPos;
  uniform float uVisible, uAlpha, uInitialGlow;
  varying float vLight, vSpeed;
  float ramp(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float alpha = step(dot(q, q), 1.0) * uVisible;
    if (alpha < 0.001) discard;
    // a sphere's normal across the sprite (igloo's, tilted up), lit from the
    // light swung half a turn round
    vec3 n = vec3(q, sqrt(1.0 - clamp(dot(q, q), 0.0, 1.0)));
    n.y = 1.0 - n.y;
    float shade = max(0.0, dot(normalize(uLightPos * vec3(-1.0, 1.0, -1.0)), normalize(n))) * vLight;
    vec3 color = mix(uDark, uLight, shade);
    float fast = ramp(vSpeed, 0.003, 0.005);
    color = mix(color, uFast, fast * fast);
    float blur = 1.0 - ramp(vSpeed, 0.002, 0.007);
    alpha *= max(uInitialGlow, blur * blur * 0.5 + 0.5);
    // fading in: white, warming to the glow colour, then the shading takes over
    color = mix(color, mix(vec3(1.0), uGlow, clamp(uAlpha, 0.0, 1.0)), uInitialGlow);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha * uAlpha);
  }
`;

// ---------------------------------------------------------------- shapes
let worker = null;
let jobs = 0;
const pending = new Map();

async function buildOnMainThread(name, opts) {
  const { buildShape } = await import('./volumes.js');
  return buildShape(name, opts);
}

// A shape's distance field and surface homes ({ volume, homes }), built in a
// worker (or here if workers or OffscreenCanvas aren't available).
function shapeData(name, opts) {
  if (!worker) {
    try {
      worker = new Worker(new URL('./volumeWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error) buildOnMainThread(job.name, job.opts).then(job.resolve, job.reject);
        else job.resolve({ volume: data.volume, homes: data.homes });
      };
      worker.onerror = () => {
        for (const job of pending.values()) buildOnMainThread(job.name, job.opts).then(job.resolve, job.reject);
        pending.clear();
        worker = false;
      };
    } catch {
      worker = false;
    }
  }
  if (worker === false) return buildOnMainThread(name, opts);
  return new Promise((resolve, reject) => {
    const id = ++jobs;
    pending.set(id, { name, opts, resolve, reject });
    worker.postMessage({ id, name, opts });
  });
}

// (all shapes built: the worker isn't needed again)
function closeWorker() {
  if (!worker || pending.size) return;
  worker.terminate();
  worker = null;
}

function homesTexture(data, size) {
  const t = new DataTexture(data, size, size, RGBAFormat, FloatType);
  t.needsUpdate = true;
  return t;
}

function volumeTexture(data, size) {
  const t = new Data3DTexture(data, size, size, size);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.minFilter = t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------- sculpture
export class ParticleSculpture {
  // c: cfg.room; shapes: [{ shape, scale }] per link; resolution: the drawing
  // buffer size uniform ({ value: Vector2 }).
  constructor(c, { shapes, resolution }) {
    this.c = c;
    this.shapes = shapes;
    this.count = c.particles;
    this.size = Math.max(Math.ceil(Math.sqrt(this.count) / 4) * 4, 4); // igloo's texture size
    this.resolution = resolution;
    this.volumes = shapes.map(() => null);
    this.homes = shapes.map(() => null);
    this.link = 0;
    this.rebase = 0; // turn to apply to the particles' frame on the next step (rad)
    this.group = new Group(); // the sculpture's place in the room; the arrows hang off it
    this.ready = false;
    this.fluid = new FluidSim();
    this.pointer01 = new Vector2(0.5, 0.5);
  }

  async load(renderer) {
    this.renderer = renderer;
    const n = this.size;
    const opts = { size: this.c.volumeSize, count: this.count, tex: n };
    const keep = (i, { volume, homes }) => {
      this.volumes[i] = volumeTexture(volume, opts.size);
      this.homes[i] = homesTexture(homes, n);
    };
    // the first shape before anything shows, the rest behind it (igloo)
    keep(0, await shapeData(this.shapes[0].shape, opts));
    Promise.all(
      this.shapes.slice(1).map((s, i) =>
        shapeData(s.shape, opts)
          .then((d) => keep(i + 1, d))
          .catch((err) => console.error('[room] shape failed', s.shape, err)),
      ),
    ).then(closeWorker);

    // the particles start scattered through the cube (w: a random starting light)
    const start = new Float32Array(n * n * 4);
    for (let i = 0; i < this.count; i++) {
      start[i * 4] = (Math.random() - 0.5) * CUBE;
      start[i * 4 + 1] = (Math.random() - 0.5) * CUBE;
      start[i * 4 + 2] = (Math.random() - 0.5) * CUBE;
      start[i * 4 + 3] = Math.random();
    }
    const startTexture = new DataTexture(start, n, n, RGBAFormat, FloatType);
    startTexture.needsUpdate = true;
    const target = () =>
      new WebGLRenderTarget(n, n, {
        count: 2,
        type: FloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
      });
    this.targets = [target(), target()];
    this.current = 0;

    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new Mesh(tri);
    this.quad.frustumCulled = false;
    this.quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // both targets start there, standing still
    const init = new ShaderMaterial({ uniforms: { tPos: { value: startTexture } }, vertexShader: SIM_VERT, fragmentShader: INIT_FRAG, depthTest: false, depthWrite: false });
    for (const t of this.targets) this.pass(init, t);
    init.dispose();
    startTexture.dispose();

    const light = new Vector3(...this.c.lightPos);
    this.sim = new ShaderMaterial({
      uniforms: {
        tPos: { value: null },
        tVel: { value: null },
        tHome: { value: this.homes[0] },
        tFluid: this.fluid.texture,
        tVolume: { value: this.volumes[0] },
        uModelMatrix: { value: new Matrix4() },
        uViewMatrix: { value: new Matrix4() },
        uProjMatrix: { value: new Matrix4() },
        uLightPos: { value: light },
        uRotation: { value: 0 },
        uRebase: { value: 0 },
        uVolumeScale: { value: this.shapes[0].scale },
        uInteractForce: { value: 0 },
        uAdditionalNoise: { value: 0 },
        uShowNoise: { value: 0 },
        uTime: { value: 0 },
        uDtRatio: { value: 1 },
      },
      vertexShader: SIM_VERT,
      fragmentShader: SIM_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    const geo = new BufferGeometry();
    const uv = new Float32Array(this.count * 2);
    const half = 0.5 / n;
    for (let i = 0; i < this.count; i++) {
      uv[i * 2] = (i % n) / n + half;
      uv[i * 2 + 1] = Math.floor(i / n) / n + half;
    }
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.count * 3), 3));
    geo.setAttribute('texuv', new BufferAttribute(uv, 2));
    const col = this.c.colors;
    this.material = new ShaderMaterial({
      uniforms: {
        tPos: { value: null },
        tVel: { value: null },
        uResolution: this.resolution,
        uSize: { value: 10 },
        uRotation: this.sim.uniforms.uRotation,
        uDark: { value: new Color(col.dark) },
        uLight: { value: new Color(col.light) },
        uFast: { value: new Color(col.fast) },
        uGlow: { value: new Color(col.glow) },
        uLightPos: { value: light },
        uVisible: { value: 0 },
        uAlpha: { value: 1 },
        uInitialGlow: { value: 0 },
      },
      vertexShader: DRAW_VERT,
      fragmentShader: DRAW_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: SrcAlphaFactor,
      blendDst: SrcColorFactor,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.bindTextures();
    this.ready = true;
  }

  get uniforms() {
    return this.sim.uniforms;
  }

  pass(material, target) {
    const r = this.renderer;
    const before = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.quad.material = material;
    r.setRenderTarget(target);
    r.render(this.quad, this.quadCamera);
    r.setRenderTarget(before);
    r.autoClear = autoClear;
  }

  bindTextures() {
    const t = this.targets[this.current];
    this.material.uniforms.tPos.value = t.textures[0];
    this.material.uniforms.tVel.value = t.textures[1];
  }

  // One step of the simulation: read the current target, write the other.
  step(camera, dtRatio, time) {
    const u = this.sim.uniforms;
    const read = this.targets[this.current];
    const write = this.targets[1 - this.current];
    u.tPos.value = read.textures[0];
    u.tVel.value = read.textures[1];
    u.uModelMatrix.value.copy(this.points.matrixWorld);
    u.uViewMatrix.value.copy(camera.matrixWorldInverse);
    u.uProjMatrix.value.copy(camera.projectionMatrix);
    u.uTime.value = time;
    u.uDtRatio.value = dtRatio;
    u.uRebase.value = this.rebase;
    this.pass(this.sim, write);
    this.rebase = u.uRebase.value = 0;
    this.current = 1 - this.current;
    this.bindTextures();
  }

  // igloo simulates for a second before the sculpture first shows: steps
  // run at load (behind the hero) so the shape has formed by the room.
  warm(camera, steps = 60) {
    if (!this.ready) return;
    this.group.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    for (let i = 0; i < steps; i++) this.step(camera, 1, i / 60);
    this.material.uniforms.uVisible.value = 1;
  }

  // Switch to link i: burst (extra swirl easing off over 0.5 s), the new
  // shape and its homes, turned side-on (it spins round to face the room in
  // ~2 s). The particles' frame turns back by as much, so they stay put.
  setLink(i) {
    this.link = i;
    const u = this.sim.uniforms;
    gsap.fromTo(u.uAdditionalNoise, { value: 1 }, { value: 0, duration: 0.5, ease: 'power2.inOut', overwrite: true });
    this.useShape(i);
    u.uVolumeScale.value = this.shapes[i].scale;
    this.rebase += Math.PI * 1.5 - u.uRotation.value;
    u.uRotation.value = Math.PI * 1.5;
  }

  // (a shape still being built when its link comes up: swap it in when ready)
  useShape(i) {
    if (this.link !== i) return;
    if (!this.volumes[i]) return setTimeout(() => this.useShape(i), 50);
    this.sim.uniforms.tVolume.value = this.volumes[i];
    this.sim.uniforms.tHome.value = this.homes[i];
  }

  // Every frame the sculpture is on screen. p: section 3's progress; pointer:
  // { ndc, active }; aspect: the screen's.
  update(time, dt, { camera, p, pointer, aspect }) {
    if (!this.ready) return;
    const dtRatio = Math.min(5, dt * 60);
    const u = this.sim.uniforms;
    u.uRotation.value = (u.uRotation.value - dt * SPIN) % (Math.PI * 2);
    // the pointer only stirs the particles in the room (igloo's window)
    const ss = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    u.uInteractForce.value = ss(0.45, 0.65, p) * (1 - ss(0.8, 0.93, p));
    if (pointer?.ndc) this.pointer01.set(pointer.ndc.x * 0.5 + 0.5, pointer.ndc.y * 0.5 + 0.5);
    this.fluid.update(this.renderer, time, dtRatio, this.pointer01, aspect);
    camera.updateMatrixWorld();
    this.group.updateMatrixWorld(true);
    this.step(camera, dtRatio, time);
  }

  dispose() {
    this.targets?.forEach((t) => t.dispose());
    this.volumes.forEach((v) => v?.dispose());
    this.homes.forEach((h) => h?.dispose());
    this.sim?.dispose();
    this.material?.dispose();
    this.points?.geometry.dispose();
    this.quad?.geometry.dispose();
    this.fluid.dispose();
  }
}
