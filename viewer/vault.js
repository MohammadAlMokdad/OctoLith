// Scene 2 asset viewer: quartz containers with their relics.
// Glass is three's MeshPhysicalMaterial transmission with the baked roughness
// and normal maps; relics render unlit from their baked colour maps.
//
// URL params: ?view=all|1|2|3  ?frost=0..1  ?bare (hide glass)  ?shot (hide UI)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { INTRO_CONFIG as cfg } from '../src/config/introConfig.js';

const params = new URLSearchParams(location.search);
if (params.has('shot')) document.body.classList.add('shot');

// The site's crystals, relics and bakes (INTRO_CONFIG.vault.relics), side by
// side as in Blender's preview layout (SLOT_X) converted to three.js space.
const SLOTS = cfg.vault.relics.map((r, i) => ({ x: (i - 1) * 3.3, ...r }));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
// Bakes are already display-referred (Blender AgX), so don't tone map them again.
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#140d08');
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Backdrop: warm dusty radial gradient behind the items (also seen through the glass).
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 34),
  new THREE.ShaderMaterial({
    uniforms: { uInner: { value: new THREE.Color('#6b4a30') }, uOuter: { value: new THREE.Color('#120b07') } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uInner, uOuter; varying vec2 vUv;
      void main() { float d = length((vUv - 0.5) * vec2(1.6, 1.0));
        gl_FragColor = vec4(mix(uInner, uOuter, smoothstep(0.0, 0.55, d)), 1.0);
        #include <colorspace_fragment>
      }`,
  }),
);
backdrop.position.set(0, 0, -7);
scene.add(backdrop);

const texLoader = new THREE.TextureLoader();
function tex(name, color) {
  const t = texLoader.load(`/assets/textures/${name}.png`);
  t.flipY = false;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

const [vault, relics, envTex] = await Promise.all([
  new GLTFLoader().loadAsync('/assets/models/vault.glb').then((g) => g.scene),
  new GLTFLoader().loadAsync('/assets/models/relics.glb').then((g) => g.scene),
  new EXRLoader().loadAsync('/assets/textures/env_vault.exr'),
]);
envTex.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = new THREE.PMREMGenerator(renderer).fromEquirectangular(envTex).texture;

const crystals = [];
const glassMats = [];
SLOTS.forEach((slot, i) => {
  const group = new THREE.Group();
  group.position.x = slot.x;
  const relic = relics.getObjectByName(slot.relic);
  relic.material = new THREE.MeshBasicMaterial({ map: tex(`relic_${slot.bake}_color`, true) });
  const crystal = vault.getObjectByName(slot.crystal);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(1.0, 0.97, 0.92),
    transmission: 1,
    ior: 1.54,
    thickness: 1.1,
    roughness: 1,
    roughnessMap: tex(`${slot.maps}_roughness`, false),
    normalMap: tex(`${slot.maps}_normal`, false),
    normalScale: new THREE.Vector2(0.8, 0.8),
    attenuationColor: new THREE.Color(1.0, 0.86, 0.68),
    attenuationDistance: 2.2,
    dispersion: 0.35,
    envMapIntensity: 1.3,
  });
  crystal.material = mat;
  glassMats.push(mat);
  relic.position.set(0, 0, 0);
  crystal.position.set(0, 0, 0);
  group.add(relic, crystal);
  scene.add(group);
  crystals.push({ group, crystal, phase: i * 1.7 });
});

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
function setView(v) {
  if (v === 'all') {
    camera.fov = 40;
    camera.position.set(0, 0.4, 11);
    controls.target.set(0, 0, 0);
  } else {
    const x = SLOTS[Number(v) - 1].x;
    camera.fov = 45;
    camera.position.set(x, 0, 5);
    controls.target.set(x, 0, 0);
  }
  camera.updateProjectionMatrix();
  controls.update();
}
function setFrost(f) {
  // Scales the baked roughness: 0 = fully rubbed clear, 1 = as baked.
  for (const m of glassMats) m.roughness = THREE.MathUtils.lerp(0.04, 1, f);
}
$('view').value = params.get('view') ?? 'all';
$('frost').value = params.get('frost') ?? 1;
$('bare').checked = params.has('bare');
setView($('view').value);
setFrost(Number($('frost').value));
const applyBare = () => crystals.forEach((c) => { c.crystal.visible = !$('bare').checked; });
applyBare();
$('view').addEventListener('change', (e) => setView(e.target.value));
$('frost').addEventListener('input', (e) => setFrost(Number(e.target.value)));
$('bare').addEventListener('change', applyBare);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  for (const c of crystals) {
    c.group.rotation.y = Math.sin(t * 0.35 + c.phase) * 0.22;
    c.group.rotation.x = Math.sin(t * 0.27 + c.phase) * 0.05;
  }
  controls.update();
  renderer.render(scene, camera);
  if (params.has('debug') && !document.body.dataset.dbg) {
    document.body.dataset.dbg = JSON.stringify({
      cam: camera.position.toArray().map((v) => +v.toFixed(2)),
      target: controls.target.toArray(), fov: camera.fov,
      crystals: crystals.map((c) => { const b = new THREE.Box3().setFromObject(c.group);
        return [b.min.toArray().map((v) => +v.toFixed(2)), b.max.toArray().map((v) => +v.toFixed(2))]; }),
    });
  }
});
