// Fat lines that are DRAWN rather than faded in: every segment endpoint carries
// aDist (0..1); fragments beyond uProgress are discarded and a hot "head" band
// sits at the drawing front. Built on three's LineSegments2/LineMaterial.
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { BLOCK_GLSL, NOISE_GLSL, REVEAL_GLSL } from './common.js';

// positions: Float32Array of segment endpoints (xyz xyz per segment)
// perSegment: Float32Array with [distStart, distEnd, alpha, twinkle] per segment
// opts.blockIds (optional): Float32Array with the block id of each segment, so
// the lines follow the live block motion (opts.blockState, see BLOCK_GLSL).
export function createDrawLines(positions, perSegment, opts) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const buf = new InstancedInterleavedBuffer(perSegment, 4, 1);
  geometry.setAttribute('aDistStart', new InterleavedBufferAttribute(buf, 1, 0));
  geometry.setAttribute('aDistEnd', new InterleavedBufferAttribute(buf, 1, 1));
  geometry.setAttribute('aAlpha', new InterleavedBufferAttribute(buf, 1, 2));
  geometry.setAttribute('aTwinkle', new InterleavedBufferAttribute(buf, 1, 3));
  if (opts.blockIds) geometry.setAttribute('aBlock', new InstancedBufferAttribute(opts.blockIds, 1));
  const material = createDrawLineMaterial({ ...opts, blockState: opts.blockIds ? opts.blockState : null });
  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

export function createDrawLineMaterial({
  color = '#ffffff',
  linewidth = 1.25,
  headWidth = 0.05,
  headBoost = 3,
  intensity = 1.4, // HDR multiplier so lines can feed the bloom
  distanceFade = null, // [start, end] in aDist units: fade toward the far end
  twinkleDepth = 0.45, // how far a twinkling segment dims (0.5: igloo's full 0..1 pulse)
  reveal = null, // shared RevealGround uniforms: fade where the world has appeared
  blockState = null, // shared BlockMotion uniform: segments move with their block
} = {}) {
  const material = new LineMaterial({
    color: new Color(color),
    linewidth,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.toneMapped = false;
  Object.assign(material.uniforms, {
    uProgress: { value: 0 },
    uHeadWidth: { value: headWidth },
    uHeadBoost: { value: headBoost },
    uIntensity: { value: intensity },
    uFade: { value: 1 },
    uTime: { value: 0 },
    uDistFade: { value: distanceFade ?? [2, 3] },
    uTwinkleDepth: { value: twinkleDepth },
  });
  if (blockState) material.uniforms.uBlockState = blockState;
  material.defines.USE_BLOCK_MOTION = blockState ? 1 : 0;
  if (reveal) Object.assign(material.uniforms, reveal);
  material.defines.USE_REVEAL_FADE = reveal ? 1 : 0;

  material.vertexShader = material.vertexShader
    .replace(
      'void main() {',
      /* glsl */ `
      attribute float aDistStart;
      attribute float aDistEnd;
      attribute float aAlpha;
      attribute float aTwinkle;
      varying float vDist;
      varying float vAlpha;
      varying float vTwinkle;
      varying vec3 vWorld;
      #if USE_BLOCK_MOTION
        attribute float aBlock;
        ${BLOCK_GLSL}
      #endif
      void main() {
        #if USE_BLOCK_MOTION
          vec3 pStart = blockMove(instanceStart, aBlock);
          vec3 pEnd = blockMove(instanceEnd, aBlock);
        #else
          vec3 pStart = instanceStart;
          vec3 pEnd = instanceEnd;
        #endif
        bool isStart = position.y < 0.5;
        vDist = isStart ? aDistStart : aDistEnd;
        vAlpha = aAlpha;
        vTwinkle = aTwinkle;
        vWorld = (modelMatrix * vec4(isStart ? pStart : pEnd, 1.0)).xyz;`,
    )
    .replace('vec4( instanceStart, 1.0 )', 'vec4( pStart, 1.0 )')
    .replace('vec4( instanceEnd, 1.0 )', 'vec4( pEnd, 1.0 )');

  material.fragmentShader = material.fragmentShader
    .replace(
      'void main() {',
      /* glsl */ `
      uniform float uProgress, uHeadWidth, uHeadBoost, uIntensity, uFade, uTime, uTwinkleDepth;
      uniform vec2 uDistFade;
      varying float vDist;
      varying float vAlpha;
      varying float vTwinkle;
      varying vec3 vWorld;
      #if USE_REVEAL_FADE
        ${NOISE_GLSL}
        ${REVEAL_GLSL}
      #endif
      void main() {`,
    )
    .replace(
      'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
      /* glsl */ `
      if (vDist > uProgress) discard;
      float head = smoothstep(uProgress - uHeadWidth, uProgress, vDist);
      float twinkle = vTwinkle > 0.0 ? 1.0 - uTwinkleDepth + uTwinkleDepth * sin(uTime * (3.0 + vTwinkle * 5.0) + vTwinkle * 40.0) : 1.0;
      alpha *= vAlpha * uFade * twinkle * (1.0 - smoothstep(uDistFade.x, uDistFade.y, vDist));
      #if USE_REVEAL_FADE
        alpha *= 1.0 - smoothstep(0.0, 2.5, revealBehind(vWorld.xz));
      #endif
      diffuseColor.rgb *= uIntensity * (1.0 + head * uHeadBoost);
      gl_FragColor = vec4( diffuseColor.rgb, alpha );`,
    );
  return material;
}
