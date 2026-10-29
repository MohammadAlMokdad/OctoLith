// Shaders for section 3, the rings. The motion, the distance-driven assembly
// and the timings are igloo's entry scene (numbers in comments); the looks are
// ours: sandstone rings with gold inlay, gold energy fields, sand dust, a dusky
// amber haze. All colours are linear (the composer works in linear HDR and the
// output pass encodes to sRGB).
import { AdditiveBlending, BackSide, Color, DoubleSide, ShaderMaterial, Vector2 } from 'three';

// Uniforms every rings material shares (one object: update once per frame).
export function sharedUniforms({ noise, stone, colors }) {
  return {
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uNoise: { value: noise }, // periodic fbm, 16 lattice cells across (hazeNoiseTexture)
    uStone: { value: stone }, // stone detail (high-pass, ~0.5 mean)
    uBg1: { value: new Color(colors.bgDark) },
    uBg2: { value: new Color(colors.bgLight) },
    uGold: { value: new Color(colors.glow) },
    uLight: { value: new Color(colors.light) },
    uDust: { value: new Color(colors.dust) },
  };
}

const COMMON = /* glsl */ `
  #define PI 3.14159265
  uniform float uTime;
  uniform vec2 uResolution;
  uniform sampler2D uNoise;
  uniform vec3 uBg1, uBg2, uGold, uLight, uDust;
  float N(vec2 q) { return texture2D(uNoise, q * 0.0625).r; }   // lattice-scale value noise
  float W(vec2 uv) { return texture2D(uNoise, uv).r; }            // texture-scale "wind" noise
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  vec3 rotate3D(vec3 v, vec3 axis, float a) {
    return v * cos(a) + cross(axis, v) * sin(a) + axis * dot(axis, v) * (1.0 - cos(a));
  }
  // igloo's backdrop: a slowly breathing screen-space diagonal gradient (dark
  // bottom-left -> light top-right; the product of two noises keeps it mostly dark)
  vec3 backdrop(vec2 s) {
    float g = (s.x + s.y) * 0.5;
    g *= N(vec2(s.x * 2.0, s.y * 2.0) * 2.0 + vec2(uTime * 0.31, uTime * 0.17)) * 1.2;
    g *= N(s * 6.0 + vec2(-uTime * 0.085, uTime * 0.05) + 7.3) * 1.2;
    return mix(uBg1, uBg2, clamp(g, 0.0, 1.0)) * 1.1;
  }
  // a 3-layer "wind" product (igloo's tWind octaves) at uv, drifting with t;
  // WIND_GAIN brings our softer fbm to the contrast of igloo's wind texture
  #define WIND_GAIN 1.4
  float wind3(vec2 uv, float t) {
    return W(uv * 3.0 + vec2(-t, 0.7 * t)) * W(uv * 4.0 + vec2(t * 0.6, -t)) * W(uv * 6.0 + vec2(t, t * 0.4)) * WIND_GAIN;
  }
`;

// ---------------------------------------------------------------- the rings
// igloo's ring material, driven by the camera's distance d to the ring:
//   far (d > 7.5)   tilted up to 54 deg about a diameter, spun up to 54 deg in
//                   its plane, each shard pushed out and tumbled about itself,
//                   breathing; fogged into the backdrop
//   d 7.5 -> 2.5    the tilt and the spin unwind: it swings flat into place
//   d 4.4 -> 2.6    the shards slide together into a whole ring
//   d < 2.6         the glow comes on (inner wall, the inlaid band and glyphs,
//                   the seams)
// Ring 0 is also pushed apart while the camera is off the shaft's axis (the
// wipe in) and snaps shut as it slides onto it.
export function ringMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U, uStoneColor: { value: new Color(0x9c7a55) } },
    vertexShader: /* glsl */ `
      ${COMMON}
      attribute vec3 centr;
      attribute vec3 rand;
      attribute float cut;
      varying vec3 vWorld, vNormalW, vLocal, vLocalN;
      varying float vFalloff, vFade, vCut;
      void main() {
        vec3 translation = modelMatrix[3].xyz;
        float firstRing = step(-1.7, translation.y);                 // ring 0 (y -1.65)
        float camFactor = clamp(-cameraPosition.z * 0.8, 0.0, 1.0);  // 1 while the camera is off-axis
        float dist = distance(cameraPosition, translation);
        float fall = smoothstep(-4.75, 8.25, dist);
        float explode = 1.0 - smoothstep(0.2, 0.4, 1.0 - fall);      // 1 beyond ~4.4, 0 inside ~2.6
        vec3 pos = position;
        vec3 nor = normal;
        vec3 pivot = centr * 0.3;
        vec3 axis = normalize(rand * 2.0 - 1.0 + 1e-4);
        float depth = -(modelViewMatrix * vec4(position, 1.0)).z;
        float tumble = 0.5 * smoothstep(1.5, 12.0, depth) + firstRing * camFactor * 0.5;
        pos = rotate3D(pos - pivot, axis, tumble) + pivot;
        nor = rotate3D(nor, axis, tumble);
        pos += centr * explode * mix(0.075, 0.15, rand.z);
        pos += rand.y * centr * explode * sin(rand.x * 5.0 + uTime * 0.5 + (centr.x + centr.y + centr.z) * 15.0) * 0.05;
        pos += centr * camFactor * 0.15 * firstRing;
        float tilt = smoothstep(2.5, 7.5, dist) * PI * 0.3;
        float spin = smoothstep(2.0, 10.0, dist) * PI * 0.3 + translation.y * 0.25 + 1.5;
        pos.xz = rot2(pos.xz, tilt);
        nor.xz = rot2(nor.xz, tilt);
        pos.xy = rot2(pos.xy, spin);
        nor.xy = rot2(nor.xy, spin);
        vFade = 1.0 - smoothstep(4.5, 13.5, dist);
        vFalloff = fall;
        vCut = cut;
        vLocal = position;
        vLocalN = normal;
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * nor);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform sampler2D uStone;
      uniform vec3 uStoneColor;
      varying vec3 vWorld, vNormalW, vLocal, vLocalN;
      varying float vFalloff, vFade, vCut;
      float stone(vec3 p, vec3 n) {
        vec3 w = pow(abs(n), vec3(4.0));
        w /= w.x + w.y + w.z;
        return texture2D(uStone, p.yz * 2.2).r * w.x + texture2D(uStone, p.xz * 2.2).r * w.y + texture2D(uStone, p.xy * 2.2).r * w.z;
      }
      void main() {
        vec3 n = normalize(vNormalW);
        if (!gl_FrontFacing) n = -n;
        // sandstone: the detail map (and a broad mottle) over a warm base
        float d = stone(vLocal * 3.0, vLocalN);
        float mottle = N(vLocal.xy * 40.0) * 0.6 + 0.7;
        vec3 base = uStoneColor * (0.35 + 1.3 * d) * mottle;
        base = mix(base, base * vec3(0.78, 0.66, 0.55), vCut * 0.6);   // the broken faces are rawer, darker
        // light from above the shaft (the camera looks down it), warm bounce, rim
        vec3 L = normalize(vec3(0.35, 1.0, 0.25));
        float diff = max(dot(n, L), 0.0) * 0.8 + 0.25;
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = base * diff * uLight + uBg2 * rim * 0.18;
        // fog into the backdrop with distance (igloo: mix(bg, color, vFade * 0.95))
        vec2 s = gl_FragCoord.xy / uResolution;
        col = mix(backdrop(s), col, vFade * 0.95);
        // glow mask: the inner wall, a band and glyph inlays on the top face, the seams
        float r = length(vLocal.xy);
        float top = smoothstep(0.75, 0.95, vLocalN.z) * (1.0 - vCut);
        float innerWall = (1.0 - smoothstep(0.282, 0.292, r)) * (1.0 - smoothstep(0.3, 0.7, abs(vLocalN.z))) * (1.0 - vCut);
        float band = top * (1.0 - smoothstep(0.003, 0.0055, abs(r - 0.34)));
        float a = atan(vLocal.y, vLocal.x);
        float cell = floor(a / 0.085);
        float h = hash12(vec2(cell, floor(r * 40.0)));
        float inCell = step(0.18, fract(a / 0.085)) * step(fract(a / 0.085), 0.82);
        float glyph = top * inCell * step(0.45, h) * (step(0.302, r) * step(r, 0.326) + step(0.354, r) * step(r, 0.378) * step(0.7, h));
        float mask = max(max(innerWall, band), glyph * 0.85) + vCut * 0.9;
        float glowOn = smoothstep(0.2, 0.4, 1.0 - vFalloff);                  // near: assembled
        float flick = (N(vWorld.xz * 30.0 + uTime * 0.5 + d * 5.0) * 0.5 + 0.5) * 0.5 + 0.5;
        float enter = pow(1.0 - clamp(-cameraPosition.z, 0.0, 1.0), 4.0);     // not while the scene wipes in
        col += mask * uGold * flick * glowOn * 0.7 * enter;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- force-field membranes
// igloo's ring membranes: a disc just above each ring filling its hole,
// rippling bands drawn with a triangle lattice, brighter toward the rim;
// within 3.5 -> 2.3 of the camera it closes in like an iris (the centre stays
// open: you fly through). Gold energy here.
export function membraneMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      ${COMMON}
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vNear;
      void main() {
        vec3 translation = modelMatrix[3].xyz;
        float first = step(-4.5, translation.y);                    // discs 0 and 1 don't tilt
        float dist = distance(cameraPosition, translation);
        vec3 pos = position;
        pos.xz = rot2(pos.xz, smoothstep(2.5, 7.5, dist) * PI * 0.25 * (1.0 - first));
        pos.xy = rot2(pos.xy, smoothstep(2.0, 10.0, dist) * PI * 0.25 + translation.y * 0.5);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vNear = smoothstep(3.5, 2.3, -mv.z);
        vUv = uv;
        vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vNear;
      // a slightly irregular triangle lattice (lines of three families)
      float lattice(vec2 p) {
        p += vec2(N(p * 3.0), N(p * 3.0 + 9.1)) * 0.35;
        float l = 1.0;
        for (int i = 0; i < 3; i++) {
          float ang = float(i) * PI / 3.0;
          float f = fract(dot(p, vec2(cos(ang), sin(ang))));
          l = min(l, min(f, 1.0 - f));
        }
        return 1.0 - smoothstep(0.0, 0.06, l);
      }
      void main() {
        float y = length(vUv - 0.5) * 2.0;
        float circleMask = 1.0 - step(0.98, y);
        float radialMask = smoothstep(0.5, 1.0, y);
        float edgeMask = smoothstep(0.9, 0.85, y);
        float noise = W(vUv * 0.25 + vec2(vWorld.y)) * W(vUv * 0.8 + vec2(vWorld.y));
        noise = sin(noise * 13.0 + uTime - y * 10.0) * 0.5 + 0.5;  // concentric moving ripples
        float mask = smoothstep(0.17, 0.23, noise) * (1.0 - noise * 0.75);
        float tri = lattice(vUv * 9.0 + noise * 0.4) * 4.0;
        float alpha = tri * mask + pow(mask, 5.0) * 0.5 + radialMask * 0.5;
        alpha = min(1.0, alpha * circleMask) * edgeMask;
        alpha *= smoothstep(0.45 - vNear * 0.25, 0.75 - vNear * 0.3, length(vUv - 0.5));  // the iris
        alpha *= 1.0 - clamp(-cameraPosition.z * 8.0, 0.0, 1.0);                         // only once the scene is in
        gl_FragColor = vec4(mix(uGold, uLight, 0.4) * 0.35 * alpha, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- plasma halos
// igloo's plasma: a soft swirling glow band hugging each ring, shown only
// while the camera is 0.4..4 from it.
export function plasmaMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vNear;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vNear = (1.0 - smoothstep(2.0, 4.0, d)) * smoothstep(0.4, 1.0, d);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec2 vUv;
      varying float vNear;
      void main() {
        vec2 uv = vUv * vec2(0.25, 0.5);
        float u = vUv.x;
        uv.x += uv.y;
        float t = -uTime * 0.075;
        float w = wind3(uv, t);
        float band = smoothstep(0.3, 0.4, u) * smoothstep(0.6, 0.5, u);
        float glow = smoothstep(0.3, 0.45, u) * smoothstep(0.8, 0.4, u);
        float value = w * band + glow * 0.3 + glow * glow * w * 0.2;
        float alpha = min(1.0, pow(value * 1.7, 4.0));
        alpha *= pow(1.0 - clamp(-cameraPosition.z, 0.0, 1.0), 4.0) * vNear;
        gl_FragColor = vec4(mix(uGold, uLight, 0.5) * alpha * 0.35, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- smoke arms / tunnel / ground + ceiling smoke
// igloo's smoke trails (wispy arms swirling off each ring), the tunnel's
// helical dust wall, and the room's ground and ceiling smoke: all the same
// idea, a wind-noise product faded at the edges. Sand dust here.
export function smokeMaterial(U, kind) {
  const frag = {
    // uv.x across the arm, uv.y along it
    trail: /* glsl */ `
      vec2 uv = vUv * vec2(0.25, 0.5);
      uv.x += vPos.z * 0.1;
      float t = uTime * 0.15;
      float v = wind3(uv, t);
      float fade = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.5, vUv.y) * (1.0 - abs(vUv.x * 2.0 - 1.0));
      float alpha = min(1.0, pow(v * fade * vNear * 2.75, 3.0));
      gl_FragColor = vec4(uDust * alpha * 0.55, 1.0);`,
    // the inside of the shaft: helical streaks
    tunnel: /* glsl */ `
      vec2 uv = vUv * vec2(1.0, 0.25);
      uv.x += uv.y;
      float t = uTime * 0.05;
      float v = wind3(uv, t);
      float fade = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
      float alpha = min(1.0, pow(v * fade, 3.0) * 3.0);
      gl_FragColor = vec4(uDust * alpha * 0.3, 1.0);`,
    // ground smoke (an annulus around the floor), uv.x radial
    ground: /* glsl */ `
      vec2 uv = vUv * vec2(0.25, 0.5);
      uv.x += uv.y;
      float t = uTime * 0.05 + 0.5;
      float v = wind3(uv, t);
      float fade = smoothstep(0.4, 0.5, vUv.x) * smoothstep(1.0, 0.4, vUv.x);
      vec2 s = gl_FragCoord.xy / uResolution;
      float alpha = pow(v * fade * 3.0, 3.0) * 0.4 + s.x * s.x * fade * 0.15;
      gl_FragColor = vec4(uDust * min(alpha, 1.0) * uAlpha, 1.0);`,
    // ceiling smoke (a disc over the room), uv.x radial
    ceiling: /* glsl */ `
      vec2 uv = vUv * vec2(0.5, 1.0);
      float t = -uTime * 0.075;
      float v = W(uv * 1.0 + vec2(t, 0.0)) * W(uv * 2.0 + vec2(0.0, t)) * W(uv * 3.0 + vec2(-t, t)) * WIND_GAIN;
      float fade = smoothstep(0.135, 0.25, vUv.x) * smoothstep(1.0, 0.3, vUv.x);
      vec2 s = gl_FragCoord.xy / uResolution;
      float alpha = pow(v * fade * 1.8, 2.0) + s.x * s.x * fade * 0.2;
      gl_FragColor = vec4(uDust * min(alpha, 1.0) * uAlpha, 1.0);`,
  }[kind];
  return new ShaderMaterial({
    uniforms: { ...U, uAlpha: { value: 1 } },
    transparent: true,
    depthTest: kind !== 'trail',
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      varying float vNear;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vNear = (1.0 - smoothstep(2.0, 15.0, d)) * smoothstep(0.5, 2.0, d);
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vPos;
      varying float vNear;
      void main() {
        ${frag}
      }`,
  });
}

// ---------------------------------------------------------------- the backdrop
// igloo's "light room": a big sphere showing the breathing screen-space
// gradient, plus a grid of dust specks that twinkle on and off.
export function backdropMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U },
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec2 vUv;
      void main() {
        vec2 s = gl_FragCoord.xy / uResolution;
        vec3 col = backdrop(s);
        vec2 g = vUv * vec2(200.0, 100.0);
        float dot = 1.0 - smoothstep(0.04, 0.09, length(fract(g) - 0.5));
        float tw = 1.0 - abs(fract(hash12(floor(g)) + uTime * 0.1) - 0.5) * 2.0;
        col += uLight * dot * tw * tw * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- dust motes
// igloo's snow (200 spinning flakes falling down the shaft, wrapped in a box)
// and its room motes (60 drifting specks): sand here.
export function motesMaterial(U, kind) {
  const fall = kind === 'shaft';
  return new ShaderMaterial({
    uniforms: { ...U, uAlpha: { value: 1 }, uBox: { value: fall ? [3, 8, 3] : [2.5, 0.5, 2.5] } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uBox;
      uniform float uAlpha;
      attribute vec3 rnd;
      varying float vAlpha;
      varying vec2 vRot;
      vec3 treadmill(vec3 p, vec3 box) { return mod(p + box * 0.5, box) - box * 0.5; }
      void main() {
        vec3 pos = position;
        float t = uTime * mix(0.2, 1.0, rnd.x);
        ${
          fall
            ? `pos.y -= mix(0.4, 0.7, fract(rnd.x + rnd.y + rnd.z)) * uTime;
               pos.x += sin(t * 0.5 + pos.y) * 0.4;
               pos.z += cos(t * 0.5 + pos.y) * 0.4;
               pos.xz = rot2(pos.xz, t * 0.5);
               pos = treadmill(pos, uBox);`
            : `float tt = uTime * 0.1;
               pos.x += sin(tt * 4.0 + pos.z * 2.5) * 0.75;
               pos.y += sin(tt * 2.0 + pos.x * 2.5) * 0.75 * 0.2;
               pos.z += sin(tt * 2.0 + pos.y * 2.5) * 0.75;`
        }
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vec4 mv = viewMatrix * world;
        float a = 1.0;
        ${
          fall
            ? `a *= smoothstep(8.0, 0.0, -world.y) * smoothstep(0.0, 2.0, -world.y + 0.5);
               a *= 1.0 - min(1.0, length(world.xz) * 0.5);
               a *= smoothstep(0.5, 1.0, -mv.z);
               a *= (sin(uTime * 3.0 + rnd.y * 20.0) * 0.4 + 0.6) * 0.3;`
            : `a *= (sin(uTime * 1.8 + rnd.y * 22.43) * 0.4 + 0.6) * 1.25;
               a *= smoothstep(0.2, 0.24, length(world.xz));`
        }
        vAlpha = a * uAlpha;
        vRot = vec2(cos(t * 3.0 + rnd.z * 6.28), sin(t * 3.0 + rnd.z * 6.28));
        gl_PointSize = ${fall ? '50.0 / length(mv.xyz) * uResolution.y / 1300.0' : 'mix(7.0, 12.0, rnd.x) * uResolution.y * 0.002'};
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying float vAlpha;
      varying vec2 vRot;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        ${
          fall
            ? `p = vec2(p.x * vRot.x - p.y * vRot.y, p.x * vRot.y + p.y * vRot.x);
               float d = length(p * vec2(1.0, 2.6));
               float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;`
            : `float d = length(p) * 2.0;
               float a = pow(max(0.0, 1.0 - d), 2.0) * vAlpha * 0.6;`
        }
        gl_FragColor = vec4(mix(uDust, uLight, 0.5) * a, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- glyph columns
// igloo's text cylinders (walls of blurred, flickering data readouts lining
// the shaft and the room): blurred glyph columns here. uFade: 1 = fade the
// bottom of each panel in (the room's), 0 = flat (the shaft's).
export function glyphMaterial(U, atlas, { strength, rising }) {
  return new ShaderMaterial({
    uniforms: { ...U, tAtlas: { value: atlas }, uAlpha: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      attribute float rand;
      varying vec2 vUv;
      varying float vRand;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vRand = rand;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform sampler2D tAtlas;
      uniform float uAlpha;
      varying vec2 vUv;
      varying float vRand;
      varying vec3 vPos;
      void main() {
        // each panel shows its own patch of the atlas
        vec2 uv = vec2(fract(vUv.x * 28.0) * 0.25 + floor(vRand * 4.0) * 0.25, vUv.y * 0.5 + fract(vRand * 7.0) * 0.5);
        float a = texture2D(tAtlas, uv).r;
        a *= sin(uTime * 2.0 + vRand * 10.0 + vPos.x * 2.0 + vPos.z * 2.0) * 0.5 + 0.5;
        ${rising ? 'a *= clamp(vPos.y * 2.0, 0.0, 1.0);' : ''}
        a *= ${strength.toFixed(3)} * uAlpha;
        gl_FragColor = vec4(mix(uLight, uGold, 0.4) * a, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- the room
// igloo's floor: concentric tiers, the middle four precessing like plates, the
// grooves between them glowing with a ripple travelling outward; revealed
// from the centre out (uAlpha). Sandstone with gold grooves here.
export function floorMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U, uAlpha: { value: 0 }, uRotationTime: { value: 0 } },
    transparent: true,
    vertexShader: /* glsl */ `
      ${COMMON}
      uniform float uRotationTime;
      attribute float animationmask, iteration, origY;
      varying vec3 vPos, vNormal2;
      varying float vOrigY;
      void main() {
        vec3 pos = position;
        vec3 nor = normal;
        float t = uRotationTime;
        vec3 axis = vec3(0.0, 0.5, 1.0);
        axis.xz = rot2(axis.xz, t * 1.25 + iteration * 1.2);
        axis = normalize(axis);
        pos = rotate3D(pos, axis, 0.03 * animationmask);
        nor = rotate3D(nor, axis, 0.03 * animationmask);
        pos.y -= sin(iteration - t) * 0.01 * animationmask + animationmask * 0.04;
        vPos = pos;
        vNormal2 = normalize(mat3(modelMatrix) * nor);
        vOrigY = origY;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform sampler2D uStone;
      uniform float uAlpha;
      varying vec3 vPos, vNormal2;
      varying float vOrigY;
      void main() {
        float r = length(vPos.xz);
        float d = texture2D(uStone, vPos.xz * 1.6).r;
        vec3 base = vec3(0.3, 0.22, 0.15) * (0.5 + d) * (0.85 + 0.3 * N(vPos.xz * 30.0));
        base *= mix(0.65, 1.0, vNormal2.y * 0.5 + 0.5);
        // concentric tool marks
        base *= 0.95 + 0.05 * sin(r * 260.0);
        // a soft moving shadow (igloo's fake caustic shadow)
        float sh = smoothstep(0.2, 0.9, length(vPos.xz * 1.5 + vec2(1.15, -0.55) + 0.1 * vec2(sin(uTime * 0.3), cos(uTime * 0.25))));
        vec3 col = mix(base * 0.55, base, sh);
        // the grooves glow, with a ripple travelling outward
        float low = smoothstep(0.087, -0.1, vOrigY) * (1.0 - smoothstep(1.4, 1.6, r));
        float ripple = smoothstep(0.087, 0.05, vOrigY) * (sin(vPos.z * 5.0 + r * 10.0 - uTime * 0.75) * 0.5 + 0.5);
        col += uGold * (low * 0.35 + ripple * 0.04);
        // revealed from the centre (r * 3 against uAlpha), faded at the rim
        float m = 3.0;
        float p = mix(-m, 6.0, uAlpha);
        float alpha = smoothstep(p + m, p, r * 3.0) * smoothstep(1.99, 1.3, r);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

// igloo's containment field: a holographic triangle-lattice cylinder lit only
// where noise bands sweep over it, brightest at its silhouette.
export function containmentMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U, uAlpha: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos, vN, vV;
      void main() {
        vUv = uv;
        vPos = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vPos, vN, vV;
      float lattice(vec2 p) {
        float l = 1.0;
        for (int i = 0; i < 3; i++) {
          float ang = float(i) * PI / 3.0;
          float f = fract(dot(p, vec2(cos(ang), sin(ang))));
          l = min(l, min(f, 1.0 - f));
        }
        return 1.0 - smoothstep(0.0, 0.03, l);
      }
      void main() {
        float n = N(vPos.xz * 6.0 + vPos.y * 3.0 + uTime * 0.2) * N(vPos.xy * 3.0 - uTime * 0.1);
        n = pow(sin(n * 15.0 - uTime * 7.0) * 0.5 + 0.5, 4.0);
        float tri = lattice(vUv * vec2(2.0, 1.0) * 6.0 + n * 0.05);
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float fres = mix(f, 1.0, 0.25) * (1.0 - smoothstep(0.65, 0.99, f));
        float alpha = (n * tri * 2.0 + n * 0.03) * fres * (1.0 - smoothstep(0.5, 1.0, vUv.y)) * uAlpha * 0.08;
        gl_FragColor = vec4(mix(uLight, uGold, 0.3) * alpha, 1.0);
      }`,
  });
}

// igloo's room light: a hot (HDR, it blooms) ring with two gaps, turning.
// One-sided, facing down: it only shows once the camera is below it, in the room.
export function ringLightMaterial(U) {
  return new ShaderMaterial({
    uniforms: { ...U },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      ${COMMON}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 pos = position;
        pos.xz = rot2(pos.xz, -uTime * 0.2);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5);
        float a = smoothstep(0.5, 0.3, d) * smoothstep(0.3, 0.4, d);
        a *= smoothstep(0.03, 0.1, abs(vUv.x - 0.5));
        a *= mix(1.0, 0.8, sin(uTime * 2.0 + d + vUv.x * 2.0 + vUv.y) * 0.5 + 0.5);
        gl_FragColor = vec4(mix(vec3(2.0), uGold * 2.4, 0.35) * a, 1.0);
      }`,
  });
}
