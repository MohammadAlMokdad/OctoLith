// Unlit baked material for the world (terrain, landmark pyramids):
// bake * live detail, the blowing dust haze, scene fog, and the Phase E stepped
// reveal (discard until revealed, bright band at the front, tiny vertical pop
// on fresh cells).
// hero (the sand around the pyramid only): igloo's ground glow in gold, a
// glow around the base that swells with the block pulse wave, and a pool of
// light under the mouse point.
import { ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { DETAIL_GLSL, HAZE_GLSL, HAZE_UNIFORMS, NOISE_GLSL, REVEAL_GLSL } from './common.js';

export function createBakedMaterial({ bake, sandDetail, stoneDetail, kind, reveal, hero = null }) {
  const uniforms = UniformsUtils.merge([UniformsLib.fog]);
  Object.assign(uniforms, {
    uBake: { value: bake },
    uSandDetail: { value: sandDetail },
    uStoneDetail: { value: stoneDetail },
  });
  // Reveal, haze (and hero) uniforms are shared objects so one tween drives every material.
  Object.assign(uniforms, reveal, HAZE_UNIFORMS);
  if (hero) Object.assign(uniforms, hero);

  return new ShaderMaterial({
    fog: true,
    uniforms,
    defines: { DETAIL_SAND: kind === 'sand' ? 1 : 0, HERO_GLOW: hero ? 1 : 0 },
    vertexShader: /* glsl */ `
      ${NOISE_GLSL}
      ${REVEAL_GLSL}
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vWorld;
      varying vec3 vNrm;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vPos = position;
        vNrm = normal;
        vec4 world = modelMatrix * vec4(position, 1.0);
        // Fresh cells rise a touch, then settle.
        float behind = revealBehind(world.xz);
        world.y += uPop * smoothstep(0.0, 0.6, behind) * (1.0 - smoothstep(0.6, 2.4, behind));
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${REVEAL_GLSL}
      ${DETAIL_GLSL}
      ${HAZE_GLSL}
      uniform sampler2D uBake;
      uniform vec3 uBandColor;
      #if HERO_GLOW
        uniform vec3 uGroundMouse, uGlow;
        uniform float uPulse, uHover, uTime, uGroundGlow, uMouseGlow;
      #endif
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vWorld;
      varying vec3 vNrm;
      #include <fog_pars_fragment>
      void main() {
        float behind = revealBehind(vWorld.xz);
        if (behind < 0.0) discard;
        vec3 c = texture2D(uBake, vUv).rgb;
        #if DETAIL_SAND
          c *= sandDetail(vWorld.xz);
        #else
          c *= stoneDetail(vPos, normalize(vNrm), 0.0);
        #endif
        #if HERO_GLOW
          // Around the base (distance to the pyramid's footprint), riding the
          // same wave along +x as the emissive blocks.
          vec2 q = abs(vWorld.xz) - 2.1;
          float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float base = exp(-max(edge, 0.0) / 0.8) * (sin(vWorld.x - uTime + 3.2) * 0.5 + 0.5);
          // Under the mouse point, stronger the higher it is over the pyramid.
          float under = (1.0 - clamp(distance(uGroundMouse, vec3(vWorld.x, 0.0, vWorld.z)), 0.0, 5.0) / 5.0)
                      * smoothstep(-0.5, 2.0, uGroundMouse.y)
                      * (1.0 - clamp(length(vWorld), 0.0, 9.0) / 9.0) * 2.0;
          c += uGlow * (c.r * (base * uGroundGlow * uPulse + under * uMouseGlow * uHover));
        #endif
        // Freshly revealed cells flash gold at the front (goes into bloom).
        c += uBandColor * (1.1 * (1.0 - smoothstep(0.0, uBandWidth, behind)));
        c = dustHaze(c, vWorld);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}
