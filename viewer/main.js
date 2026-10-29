// Scene 1 asset viewer: loads the exported GLBs with their baked colour maps,
// rendered unlit as on the final site, plus a minimal block-displacement
// shader to exercise the per-block attributes and the two pyramid bakes.
//
// Bakes hold only low-frequency colour; grains, specks and crack lines are
// drawn live from high-pass detail textures (see 13_detail_textures.py):
// colour = bake * 2 * detail, which averages out to the bake with distance.
//
// URL params: ?explode=0..1  ?shot (hide UI)  ?cage ?points ?outline
//             ?cam=hero|detail|ground
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

const params = new URLSearchParams(location.search);
if (params.has('shot')) document.body.classList.add('shot');

const GOLD = new THREE.Color(1.0, 0.72, 0.3);
const HORIZON = new THREE.Color('#e6c9a8');
const ZENITH = new THREE.Color('#8b9fc6');
// Sun direction from Blender (to_sun, Z-up) converted to three.js (Y-up).
const TO_SUN = new THREE.Vector3(-0.37, 0.423, -0.825).normalize();

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Aerial perspective: near sand stays crisp, hills and far pyramids fade into
// the horizon haze.
scene.fog = new THREE.FogExp2(HORIZON, 0.0048);

// Hero camera from igloo.inc: three.js (-14, 4, 14) looking at (0, 1, 0), 30 deg FOV.
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 2000);
const CAMS = {
  hero: { pos: [-14, 4, 14], target: [0, 1, 0] },
  detail: { pos: [-5.2, 1.3, 3.4], target: [-0.6, 1.1, 0.9] }, // Blender CAM_Detail
  ground: { pos: [-7.5, 1.2, 6.5], target: [-3.0, 0.1, 2.0] },   // close on the sand
};
const cam = CAMS[params.get('cam')] ?? CAMS.hero;
camera.position.set(...cam.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...cam.target);
controls.enableDamping = true;
controls.update();

// Sky gradient dome.
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(800, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: HORIZON }, uZenith: { value: ZENITH } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uHorizon; uniform vec3 uZenith; varying vec3 vDir;
      void main() { gl_FragColor = vec4(mix(uHorizon, uZenith, smoothstep(0.0, 0.45, vDir.y)), 1.0);
      #include <colorspace_fragment>
      }`,
  }),
));

const texLoader = new THREE.TextureLoader();
function bake(name) {
  const t = texLoader.load(`/assets/textures/${name}_color.png`);
  t.flipY = false; // glTF UV convention
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function detail(name) {
  const t = texLoader.load(`/assets/textures/detail/${name}_detail.png`);
  t.colorSpace = THREE.NoColorSpace;           // a linear multiplier, not a colour
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const SAND_DETAIL = detail('sand');
const STONE_DETAIL = detail('stone');

// Shared GLSL: world-space sand detail (two tilings blended by noise so the
// 1.6 m tile doesn't repeat visibly) and triplanar stone detail.
const DETAIL_GLSL = /* glsl */ `
  uniform sampler2D uSandDetail, uStoneDetail;
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  vec3 sandDetail(vec2 p) {
    vec3 a = texture2D(uSandDetail, p / 1.6).rgb;
    vec3 b = texture2D(uSandDetail, mat2(0.8, -0.6, 0.6, 0.8) * p / 2.6 + vec2(0.37, 0.61)).rgb;
    return mix(a, b, smoothstep(0.35, 0.65, vnoise(p * 0.08))) * 2.0;
  }
  vec3 stoneDetail(vec3 pos, vec3 nrm, float rnd) {
    vec3 w = pow(abs(nrm), vec3(4.0));
    w /= dot(w, vec3(1.0));
    vec3 q = pos / 0.9 + vec3(13.7, 7.1, 3.3) * rnd;
    return (texture2D(uStoneDetail, q.zy).rgb * w.x + texture2D(uStoneDetail, q.xz).rgb * w.y
          + texture2D(uStoneDetail, q.xy).rgb * w.z) * 2.0;
  }
`;

// Unlit baked material with live detail and fog. kind: 'sand' | 'stone'.
function baked(name, kind) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  uniforms.uBake = { value: bake(name) };
  uniforms.uSandDetail = { value: SAND_DETAIL };
  uniforms.uStoneDetail = { value: STONE_DETAIL };
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNrm;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vPos = position;
        vNrm = normal;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uBake;
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNrm;
      #include <fog_pars_fragment>
      ${DETAIL_GLSL}
      void main() {
        vec3 c = texture2D(uBake, vUv).rgb;
        c *= ${kind === 'sand' ? 'sandDetail(vPos.xz)' : 'stoneDetail(vPos, normalize(vNrm), 0.0)'};
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

const gltf = new GLTFLoader();
const load = (file) => gltf.loadAsync(`/assets/models/${file}`).then((g) => g.scene);
const meta = await fetch('/assets/models/bake_meta.json').then((r) => r.json());

const [pyramid, terrain, landmarks, envTex] = await Promise.all([
  ...['pyramid.glb', 'terrain.glb', 'landmarks.glb'].map(load),
  new EXRLoader().loadAsync('/assets/textures/env_desert.exr'),
]);
envTex.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromEquirectangular(envTex).texture;
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.8, 0.6), 3.0);
sun.position.copy(TO_SUN).multiplyScalar(20);
scene.add(sun);

terrain.getObjectByName('DUNE_Base').material = baked('ground', 'sand');
terrain.getObjectByName('DUNE_Far').material = baked('far', 'sand');
const landmarkMat = baked('landmark', 'stone');
landmarks.traverse((o) => { if (o.isMesh) o.material = landmarkMat; });

// ---------------------------------------------------------------- pyramid
const uniforms = {
  uAssembled: { value: bake('pyramid') },
  uExploded: { value: bake('pyramid_exploded') },
  uExplode: { value: Number(params.get('explode') ?? 0) },
  uMouse: { value: new THREE.Vector3(0, -100, 0) },
  uHover: { value: 0 },
  uTime: { value: 0 },
  uGold: { value: GOLD },
  uBase: { value: meta.explode.base },
  uRand: { value: meta.explode.rand },
  uSandDetail: { value: SAND_DETAIL },
  uStoneDetail: { value: STONE_DETAIL },
};
const blocks = pyramid.getObjectByName('PYR_Blocks');
blocks.material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    attribute vec3 _centr;
    attribute vec3 _dir;
    attribute float _rand;
    attribute float _emission;
    uniform float uExplode, uHover, uTime, uBase, uRand;
    uniform vec3 uMouse;
    varying vec2 vUv;
    varying float vMove;
    varying float vGlow;
    varying vec3 vRestPos;
    varying vec3 vNrm;
    varying float vRand;
    void main() {
      vRestPos = position;             // detail sticks to the stone as it moves
      vNrm = normal;
      vRand = _rand;
      float full = uBase + uRand * _rand;
      float hover = uHover * smoothstep(1.3, 0.0, distance(_centr, uMouse)) * (0.2 + 0.12 * _rand);
      float breathe = 0.004 * sin(uTime * 1.3 + _rand * 6.2832);
      float m = uExplode * full + hover + breathe;
      vMove = clamp(m / full, 0.0, 1.0);
      vGlow = _emission;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position + _dir * m, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uAssembled, uExploded;
    uniform vec3 uGold;
    varying vec2 vUv;
    varying float vMove;
    varying float vGlow;
    varying vec3 vRestPos;
    varying vec3 vNrm;
    varying float vRand;
    ${DETAIL_GLSL}
    void main() {
      vec3 c = mix(texture2D(uAssembled, vUv).rgb, texture2D(uExploded, vUv).rgb, vMove);
      c *= stoneDetail(vRestPos, normalize(vNrm), vRand);
      // Flagged stones turn gilded (texture kept) as they separate.
      c = mix(c, c * vec3(1.25, 0.98, 0.58) + uGold * 0.06, vGlow * vMove);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
});

const cap = pyramid.getObjectByName('PYR_Cap');   // only on the khafre / cased styles
if (cap) cap.material = new THREE.MeshStandardMaterial({
  color: new THREE.Color(1.0, 0.78, 0.42), metalness: 1.0, roughness: 0.28,
  envMap, envMapIntensity: 2.2,
});
const core = pyramid.getObjectByName('PYR_Core');
// Dark at rest (so joints read as shadow), glowing gold as blocks separate.
const CORE_DARK = new THREE.Color(0.05, 0.04, 0.03);
const CORE_GLOW = new THREE.Color(1.0, 0.62, 0.18);
core.material = new THREE.MeshBasicMaterial({ color: CORE_DARK.clone() });

const lineMat = new THREE.LineBasicMaterial({
  color: GOLD, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
});
const cage = pyramid.getObjectByName('PYR_Cage');
const outline = pyramid.getObjectByName('PYR_Outline');
cage.material = outline.material = lineMat;
const points = pyramid.getObjectByName('PYR_IntroPoints');
points.material = new THREE.PointsMaterial({ color: GOLD, size: 0.07, sizeAttenuation: true });

scene.add(terrain, landmarks, pyramid);

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const toggles = { cage, outline, points };
for (const [id, obj] of Object.entries(toggles)) {
  $(id).checked = params.has(id);
  obj.visible = $(id).checked;
  $(id).addEventListener('change', () => { obj.visible = $(id).checked; });
}
$('explode').value = uniforms.uExplode.value;
$('explode').addEventListener('input', (e) => { uniforms.uExplode.value = Number(e.target.value); });

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverTarget = 0;
addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = $('hover').checked && raycaster.intersectObject(blocks)[0];
  if (hit) uniforms.uMouse.value.copy(hit.point);
  hoverTarget = hit ? 1 : 0;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  uniforms.uTime.value += dt;
  uniforms.uHover.value += (hoverTarget - uniforms.uHover.value) * Math.min(1, dt * 6);
  if (cap) cap.position.y = uniforms.uExplode.value * meta.explode.capLift;
  const glow = Math.min(1, uniforms.uExplode.value * 2 + uniforms.uHover.value);
  core.material.color.lerpColors(CORE_DARK, CORE_GLOW, glow);
  controls.update();
  renderer.render(scene, camera);
});
document.body.dataset.ready = '1';
