// Phase material for the pyramid's solid blocks. States, blended by uniforms:
//   energy   (D) overexposed warm white above the fill plane, hot band at the front,
//            back faces show as a flat bright cross-section through the cut
//   flash    (D) whole object white-hot for a moment
//   x-ray    dark body with a strong fresnel rim (kept, but the intro no
//            longer uses it: the energy fades straight into the physical look)
//   physical (D->F) baked colour with live stone detail
// Live hero (our GLB + BlockMotion): each block moves as BlockMotion says and
// glows gold from inside: on its sides, back, bottom and the part of its top
// under the next course, brightest toward its back, so the light shows in the
// joints and grows in the gaps as blocks part. Its front and the visible strip
// of its step never glow and keep their resting bake; the faces a separating
// block uncovers blend to the exploded bake.
import { Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { BLOCK_GLSL, DETAIL_GLSL, NOISE_GLSL } from './common.js';

export function createPyramidMaterial({ bake, exploded, stoneDetail, hasBlockAttributes, motion = null, cfg }) {
  const c = cfg.colors;
  const b = cfg.blocks;
  return new ShaderMaterial({
    side: DoubleSide,
    defines: {
      HAS_BLOCKS: hasBlockAttributes ? 1 : 0, // our GLB: per-block _rand + a baked UV atlas
      BLOCK_MOTION: hasBlockAttributes && motion ? 1 : 0,
    },
    uniforms: {
      uBake: { value: bake },
      uExploded: { value: exploded },
      uStoneDetail: { value: stoneDetail },
      uSandDetail: { value: null },
      uFillY: { value: -1 }, // the solid exists above this plane (sweeps apex -> base)
      uBandWidth: { value: 0.16 },
      uEnergy: { value: 3.2 }, // HDR brightness of the energy fill
      uEnergyColor: { value: new Color(c.energy) },
      uFlash: { value: 0 },
      uXray: { value: 0 },
      uFinal: { value: 1 },
      uXrayBody: { value: new Color(c.xrayBody) },
      uXrayRim: { value: new Color(c.xrayRim) },
      uScanBg: { value: new Color(c.scanBg) },
      uToSun: { value: new Vector3(-0.37, 0.423, -0.825).normalize() },
      uTime: { value: 0 },
      uExplodedMix: { value: b.explodedBake },
      uGlow: { value: new Color(c.glow) },
      uBlockGlow: { value: b.blockGlow },
      uLive: motion ? motion.uniforms.uPulse : { value: 0 }, // the idle joint wave fades in with the live hero
      uBlockState: motion ? motion.uniforms.uBlockState : { value: null }, // shared with BlockMotion
    },
    vertexShader: /* glsl */ `
      #if HAS_BLOCKS
        attribute float _rand;
        attribute vec3 _centr;
      #endif
      #if BLOCK_MOTION
        attribute float _blockid;
        ${BLOCK_GLSL}
      #endif
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNrm;
      varying vec3 vWorld;
      varying vec3 vWorldNrm;
      varying float vRand;
      varying float vPush;
      varying float vFront;
      varying float vTop;
      varying float vReach;
      void main() {
        vUv = uv;
        vPos = position; // rest pose: the stone detail sticks to the block as it moves
        vNrm = normal;
        vec3 p = position;
        vec3 n = normal;
        vPush = 0.0;
        #if BLOCK_MOTION
          vec4 turn = blockTexel(_blockid, 0);
          vec4 state = blockTexel(_blockid, 1);
          p = _centr * (1.0 + state.y) + quatRotate(turn, position - _centr);
          n = quatRotate(turn, normal);
          vPush = state.x;
        #endif
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vWorldNrm = normalize(mat3(modelMatrix) * n);
        #if HAS_BLOCKS
          vRand = _rand;
          // Rest pose. vReach: how far this block's course reaches from the
          // pyramid's axis (its outer faces). A face is a front if stepping out
          // of it leaves the course (corner blocks have two).
          vReach = max(abs(_centr.x), abs(_centr.z)) + 0.18;
          vec2 out2 = position.xz + normal.xz * 0.25;
          vFront = step(0.3, length(normal.xz)) * step(vReach + 0.05, max(abs(out2.x), abs(out2.y)));
          vTop = smoothstep(0.5, 0.9, normal.y);
        #else
          vRand = 0.0;
          vFront = 0.0;
          vTop = 0.0;
          vReach = 0.0;
        #endif
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${DETAIL_GLSL}
      uniform sampler2D uBake, uExploded;
      uniform float uFillY, uBandWidth, uEnergy, uFlash, uXray, uFinal, uTime;
      uniform float uExplodedMix, uBlockGlow, uLive;
      uniform vec3 uXrayBody, uXrayRim, uToSun, uScanBg, uEnergyColor, uGlow;
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNrm;
      varying vec3 vWorld;
      varying vec3 vWorldNrm;
      varying float vRand;
      varying float vPush;
      varying float vFront;
      varying float vTop;
      varying float vReach;
      void main() {
        if (vWorld.y < uFillY) discard;
        float energyOn = 1.0 - uXray;           // interior/cap only while energised
        if (!gl_FrontFacing) {
          // Interior faces are only visible through the cut: a flat hot cross-section.
          if (energyOn < 0.01 || uFinal > 0.99) discard;
          gl_FragColor = vec4(uEnergyColor * (uEnergy * 1.4 * energyOn), 1.0);
          return;
        }
        vec3 N = normalize(vWorldNrm);
        vec3 V = normalize(cameraPosition - vWorld);

        // Energy: overexposed white, lightly shaded so the stepped form still reads.
        float ndl = max(dot(N, uToSun), 0.0);
        vec3 energy = uEnergyColor * (uEnergy * (0.8 + 0.25 * ndl));
        float band = 1.0 - smoothstep(0.0, uBandWidth, vWorld.y - uFillY);
        energy += uEnergyColor * (uEnergy * 1.6 * band);

        // X-ray hologram: dark, slightly see-through body; only truly grazing
        // surfaces (silhouette, bevelled block edges) light up as a rim.
        float grazing = 1.0 - clamp(dot(N, V), 0.0, 1.0);
        float fres = pow(smoothstep(0.5, 1.0, grazing), 1.4);
        vec3 body = mix(uXrayBody, uScanBg, 0.22);
        vec3 xray = mix(body, uXrayRim * 3.0, fres);

        // Physical: bake + live stone detail, and the block's inner glow.
        #if HAS_BLOCKS
          // How deep inside its block a point is (0 at the front, ~0.37 at the
          // back) and whether it is on a face that shows at rest: the front, or
          // the strip of the top not covered by the next course (the step).
          // Varyings are clamped: with MSAA, thin bevel triangles can evaluate
          // them outside the triangle.
          float depthIn = vReach - max(abs(vPos.x), abs(vPos.z));
          float stepStrip = clamp(vTop, 0.0, 1.0) * (1.0 - smoothstep(0.12, 0.16, depthIn));
          float shown = max(clamp(vFront, 0.0, 1.0), stepStrip);
          vec3 physical = texture2D(uBake, vUv).rgb;
          physical = mix(physical, texture2D(uExploded, vUv).rgb, clamp(uExplodedMix * vPush, 0.0, 1.0) * (1.0 - shown));
        #else
          vec3 physical = vec3(0.68, 0.50, 0.32) * (0.45 + 0.55 * ndl);
        #endif
        physical *= stoneDetail(vPos, normalize(vNrm), vRand);
        #if HAS_BLOCKS
          // Gold from inside the block, never on what shows at rest; brightest
          // toward its back. It grows as the block pushes out, and a slow wave
          // along +x lights the joints.
          float inside = (1.0 - shown) * mix(0.35, 1.0, smoothstep(0.0, 0.3, depthIn));
          float wave = sin(vWorld.x - uTime + 3.2) * 0.5 + 0.5;
          physical += uGlow * (uBlockGlow * inside * (clamp(vPush, 0.0, 1.0) + 0.5 * wave * uLive));
        #endif

        vec3 col = mix(energy, xray, uXray);
        col = mix(col, physical, uFinal);
        col += uEnergyColor * (uFlash * 6.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
