// Sand-frosted quartz (igloo's ice cubes, re-themed): three's physical
// material for the environment reflections, baked normals and frost
// roughness, with its transmission replaced by igloo's trick. The glass
// refracts a texture of what is behind it (VaultScene's pre-pass: backdrop +
// the relic, which is drawn nowhere else), blurred by the frost and split a
// little by dispersion. tFrost (FrostBrush, in the crystal's UV1) clears the
// frost where the mouse brushed it off and lights the patch's rim gold.
import { Color, MeshPhysicalMaterial, ShaderChunk, Vector2 } from 'three';

const SAMPLES = 2; // jittered refraction samples per channel

export function createCrystalMaterial({ glass, normalMap, roughnessMap, envMap, rimColor }) {
  const material = new MeshPhysicalMaterial({
    color: new Color(glass.tint),
    roughness: glass.roughness,
    roughnessMap,
    normalMap,
    envMap,
    envMapIntensity: glass.envIntensity,
    ior: glass.ior,
    metalness: 0,
    transmission: 0, // our own refraction below, not three's transmission pass
  });
  const uniforms = {
    tTransmission: { value: null },
    uTransmissionSize: { value: new Vector2(1, 1) },
    tFrost: { value: null },
    uFrostRim: { value: new Color(rimColor) },
    uIor: { value: glass.ior },
    uThickness: { value: glass.thickness },
    uDispersion: { value: glass.dispersion },
    uFrostVeil: { value: glass.frostVeil },
    uFrostColor: { value: new Color(glass.frostColor) },
  };
  material.userData.uniforms = uniforms;
  material.customProgramCacheKey = () => 'vault-crystal';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <uv_pars_vertex>',
        `#include <uv_pars_vertex>
        attribute vec2 uv1;
        varying vec2 vFrostUv;
        varying vec3 vCrystalWorld;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vFrostUv = uv1;
        vCrystalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <uv_pars_fragment>',
        `#include <uv_pars_fragment>
        varying vec2 vFrostUv;
        varying vec3 vCrystalWorld;
        uniform sampler2D tFrost;
        uniform vec3 uFrostRim;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `vec2 frostData = texture2D(tFrost, vFrostUv).rg;
        float brushed = clamp(frostData.r, 0.0, 1.0); // frost brushed off here
        float brushRim = clamp(frostData.g, 0.0, 1.0); // the growing edge of the patch
        #include <clipping_planes_fragment>`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness * (1.0 - brushed);
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D(roughnessMap, vRoughnessMapUv).g;
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - brushed);'),
      )
      .replace(
        '#include <transmission_pars_fragment>',
        `uniform sampler2D tTransmission;
        uniform vec2 uTransmissionSize;
        uniform float uIor, uThickness, uDispersion, uFrostVeil;
        uniform vec3 uFrostColor;
        uniform mat4 modelMatrix;
        uniform mat4 projectionMatrix;
        float crystalHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // What is seen through the glass along the refracted ray, blurred by
        // the frost (a coarser mip of the pre-pass).
        vec3 refracted(vec3 n, vec3 v, vec3 pos, float ior, float thickness, float lod) {
          vec3 r = normalize(refract(-v, n, 1.0 / ior));
          vec3 scale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
          vec4 ndc = projectionMatrix * viewMatrix * vec4(pos + r * thickness * scale, 1.0);
          return textureLod(tTransmission, ndc.xy / ndc.w * 0.5 + 0.5, lod).rgb;
        }`,
      )
      .replace(
        '#include <transmission_fragment>',
        `{
          vec3 v = normalize(cameraPosition - vCrystalWorld);
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          // frost: rougher -> a blurrier mip, and the rays scatter a little
          float lod = log2(uTransmissionSize.x) * roughnessFactor * clamp(uIor * 2.0 - 2.0, 0.0, 1.0) * 2.2;
          vec3 seen = vec3(0.0);
          for (int i = 0; i < ${SAMPLES}; i++) {
            float j = (float(i) + crystalHash(gl_FragCoord.xy + float(i) * 7.3)) / float(${SAMPLES});
            float th = uThickness * (1.0 + 0.25 * roughnessFactor * j);
            seen.r += refracted(n, v, vCrystalWorld, uIor, th, lod).r;
            seen.g += refracted(n, v, vCrystalWorld, uIor * (1.0 + uDispersion * j), th, lod).g;
            seen.b += refracted(n, v, vCrystalWorld, uIor * (1.0 + 2.0 * uDispersion * j), th, lod).b;
          }
          seen /= float(${SAMPLES});
          // sand frost scatters light: a milky warm veil over what's behind,
          // gone where the frost is brushed off
          seen = mix(seen, uFrostColor * (0.55 + 0.45 * dot(seen, vec3(0.3, 0.5, 0.2)) * 2.0), clamp(roughnessFactor * uFrostVeil, 0.0, 0.85));
          vec3 F = EnvironmentBRDF(n, v, material.specularColor, material.specularF90, material.roughness);
          totalDiffuse = (1.0 - F) * material.diffuseColor * seen;
        }`,
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `// the brushed patch's rim glows, with a fine glint of sand crystals in it
        vec2 g = vFrostUv * 140.0;
        float glint = step(0.93, crystalHash(floor(g))) * (1.0 - smoothstep(0.2, 0.5, length(fract(g) - 0.5)));
        totalEmissiveRadiance += uFrostRim * (brushRim * 6.0 + glint * brushRim * 20.0 + glint * brushed * brushed * 0.6);
        vec3 outgoingLight = clamp(totalDiffuse + totalSpecular + totalEmissiveRadiance, 0.0, 1.0);`,
      );
  };
  return material;
}
