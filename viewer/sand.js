// Sand-wind test bench: the finished hero view (camera, baked desert, pyramid,
// post) with only the SandWind module, so the wind can be tuned without
// playing the intro.
// URL: ?t=5 freeze at 5 s (stills)  ?wisps=0  ?grains=0  ?cam=close
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { INTRO_CONFIG as cfg } from '../src/config/introConfig.js';
import { PostFX } from '../src/post/PostFX.js';
import { SandWind } from '../src/scene/SandWind.js';
import { hazeNoiseTexture } from '../src/scene/shaders/common.js';

const params = new URLSearchParams(location.search);
const frozen = params.has('t') ? parseFloat(params.get('t')) : null;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, cfg.performance.maxDpr));
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const horizon = new THREE.Color(cfg.colors.horizon);
scene.fog = new THREE.FogExp2(horizon, 0.0048);
scene.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uHorizon: { value: horizon }, uZenith: { value: new THREE.Color(cfg.colors.zenith) } },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uHorizon, uZenith; varying vec3 vDir;
        void main() { gl_FragColor = vec4(mix(uHorizon, uZenith, smoothstep(0.0, 0.45, vDir.y)), 1.0);
        #include <colorspace_fragment>
        }`,
    }),
  ),
);

// Hero camera (or a closer look at the sand).
const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.1, 2000);
const hero = cfg.camera.hero;
const close = params.get('cam') === 'close';
const az = THREE.MathUtils.degToRad(hero.azimuth);
const el = THREE.MathUtils.degToRad(close ? 6 : hero.elevation);
const dist = close ? 9 : hero.distance;
const target = new THREE.Vector3(close ? -1.5 : 0, close ? 0.6 : hero.targetY, close ? 3 : 0);
camera.position.set(
  target.x + dist * Math.cos(el) * Math.cos(az),
  target.y + dist * Math.sin(el),
  target.z + dist * Math.cos(el) * Math.sin(az),
);
camera.lookAt(target);

// Unlit bake x live detail, as on the site (without the intro reveal).
const texLoader = new THREE.TextureLoader();
const tex = (url, srgb) => {
  const t = texLoader.load(url);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
};
const detail = (name) => {
  const t = tex(`/assets/textures/detail/${name}_detail.png`, false);
  t.flipY = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
const SAND = detail('sand');
const STONE = detail('stone');
const bakes = {};
const bake = (name) => (bakes[name] ??= tex(`/assets/textures/${name}_color.png`, true));

function baked(name, kind) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, { uBake: { value: bake(name) }, uDetail: { value: kind === 'sand' ? SAND : STONE } });
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNrm; varying vec3 vPos;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vPos = position; vNrm = normal;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uBake, uDetail;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNrm; varying vec3 vPos;
      #include <fog_pars_fragment>
      void main() {
        vec3 c = texture2D(uBake, vUv).rgb;
        ${
          kind === 'sand'
            ? 'c *= texture2D(uDetail, vWorld.xz / 1.6).rgb * 2.0;'
            : `vec3 w = pow(abs(normalize(vNrm)), vec3(4.0)); w /= dot(w, vec3(1.0));
               vec3 q = vPos / 0.9;
               c *= (texture2D(uDetail, q.zy).rgb * w.x + texture2D(uDetail, q.xz).rgb * w.y + texture2D(uDetail, q.xy).rgb * w.z) * 2.0;`
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

const gltf = new GLTFLoader();
const load = (n) => gltf.loadAsync(`/assets/models/${n}.glb`).then((g) => g.scene);
const [terrain, landmarks, pyramid] = await Promise.all(['terrain', 'landmarks', 'pyramid'].map(load));
terrain.getObjectByName('DUNE_Base').material = baked('ground', 'sand');
terrain.getObjectByName('DUNE_Far').material = baked('far', 'sand');
const land = baked('landmark', 'stone');
landmarks.traverse((o) => o.isMesh && (o.material = land));
const blocks = pyramid.getObjectByName('PYR_Blocks');
blocks.material = baked('pyramid', 'stone');
scene.add(terrain, landmarks, blocks);

// Everything revealed: a reveal radius far beyond the terrain.
const reveal = {
  uReveal: { value: 1e5 },
  uCellSize: { value: cfg.reveal.cellSize },
  uNoiseAmt: { value: cfg.reveal.noiseAmount },
  uNoiseScale: { value: cfg.reveal.noiseScale },
  uBandWidth: { value: cfg.reveal.bandWidth },
  uPop: { value: 0 },
};
const assets = { models: { terrain }, bakes: { ground: bake('ground') } };
const sand = new SandWind(assets, cfg, { reveal });
for (const o of sand.objects()) scene.add(o);
sand.intensity = 1;
if (params.get('wisps') === '0') sand.wisps.visible = false;
if (params.get('grains') === '0') sand.grains.visible = false;

// PostFX builds the sandstorm pass too (idle here), so give it its inputs as IntroScene does.
const c = cfg.colors;
const t = cfg.transition;
const post = new PostFX(renderer, scene, camera, { ...cfg.post, mobileBloomScale: 0.5 }, {
  storm: {
    noise: hazeNoiseTexture(),
    colors: { light: c.stormLight, mid: c.stormMid, deep: c.stormDeep },
    wind: t.wind, parallax: t.parallax, fringe: t.fringe,
  },
});

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sand.resize(w, h, renderer.getPixelRatio());
}
addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
let time = 0;
renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  time = frozen ?? time + dt;
  sand.update(time, dt);
  post.render(dt);
});
document.body.dataset.ready = '1';
