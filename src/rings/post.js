// Post for section 3, the rings.
//   ringFlashEffect  igloo's entry-scene post pass: as the camera nears a ring
//                    (uRingProximity 0 -> 1 -> 0) the picture smears round the
//                    screen centre, blocks of it jump (glitch squares) and it
//                    brightens; a warm glare always breathes in the top-right.
//   WipePass         the last pass: section 3 rising in over section 2 through
//                    igloo's noise-edged diagonal cut (its section-to-section
//                    transition), with spectral fringing along the front, then
//                    out to the screen (sRGB). Swapped (uSwap), it is the end
//                    of the loop: the hero rising in over section 3.
//   scrollData()     our own data texture for both: r a cloudy edge, g blocks
//                    of random value (the "tech" glitch), b a slow wobble.
import { Effect, EffectAttribute, Pass } from 'postprocessing';
import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, ShaderMaterial, Uniform, UnsignedByteType, Vector2, Vector3 } from 'three';

let scroll = null;
export function scrollData(size = 256) {
  if (scroll) return scroll;
  const hash = (x, y, o) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(o + 1, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  // periodic value noise, `cells` lattice cells across the texture
  const noise = (u, v, cells, o) => {
    const x = u * cells;
    const y = v * cells;
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const w = (k) => ((k % cells) + cells) % cells;
    const ux = fade(x - X);
    const uy = fade(y - Y);
    const a = hash(w(X), w(Y), o);
    const b = hash(w(X + 1), w(Y), o);
    const c = hash(w(X), w(Y + 1), o);
    const d = hash(w(X + 1), w(Y + 1), o);
    return a + (b - a) * ux + (c - a + (d - b - c + a) * ux) * uy;
  };
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      // r: cloudy (5 octaves)
      let r = 0;
      let amp = 0.5;
      for (let o = 0; o < 5; o++) {
        r += amp * noise(u, v, 4 << o, o);
        amp *= 0.5;
      }
      // g: blocks, each coarse cell picks its own block size
      const cx = Math.floor(u * 8);
      const cy = Math.floor(v * 8);
      const sx = [8, 16, 32, 64][Math.floor(hash(cx, cy, 11) * 4)];
      const sy = [16, 32, 64, 128][Math.floor(hash(cx, cy, 12) * 4)];
      const g = hash(Math.floor(u * sx), Math.floor(v * sy), 13 + sx);
      // b: slow wobble
      const b = noise(u, v, 2, 21) * 0.6 + noise(u, v, 4, 22) * 0.4;
      const k = (j * size + i) * 4;
      data[k] = Math.round(Math.min(1, Math.max(0, (r - 0.5) * 1.6 + 0.5)) * 255);
      data[k + 1] = Math.round(g * 255);
      data[k + 2] = Math.round(b * 255);
      data[k + 3] = 255;
    }
  }
  scroll = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  scroll.wrapS = scroll.wrapT = RepeatWrapping;
  scroll.magFilter = scroll.minFilter = LinearFilter;
  scroll.needsUpdate = true;
  return scroll;
}

// igloo's chromatic aberration: 5 samples along a barrel distortion, each
// weighted by a colour of the spectrum (as in VaultScene's output pass).
const SPECTRAL = /* glsl */ `
  float caLin(float t) { return clamp(1.0 - abs(2.0 * t - 1.0), 0.0, 1.0); }
  float caRemap(float t, float a, float b) { return clamp((t - a) / (b - a), 0.0, 1.0); }
  vec2 caBarrel(vec2 c, float amt) { vec2 cc = c - 0.5; return c + cc * dot(cc, cc) * amt; }
  vec3 caSpectrum(float t) {
    float lo = step(t, 0.5);
    float w = caLin(caRemap(t, 1.0 / 6.0, 5.0 / 6.0));
    return pow(vec3(lo, 1.0, 1.0 - lo) * vec3(1.0 - w, w, 1.0 - w), vec3(1.0 / 2.2));
  }
  vec3 spectral(sampler2D tex, vec2 uv, float maxDistort, float bend) {
    vec3 sum = vec3(0.0), weights = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float t = float(i) / 5.0;
      vec3 w = caSpectrum(t);
      weights += w;
      sum += w * texture2D(tex, caBarrel(uv, bend * maxDistort * t)).rgb;
    }
    return sum / weights;
  }
`;

export class RingFlashEffect extends Effect {
  constructor({ glare }) {
    super(
      'RingFlashEffect',
      /* glsl */ `
      uniform sampler2D tScroll;
      uniform float uRingProximity;
      uniform vec3 uSquareAttr;   // xy: random offset, z: glitch strength
      uniform vec3 uGlare;
      uniform float uSeed;
      float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
      }
      vec3 hsv2rgb(vec3 c) {
        vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
        return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 n = vec3(h12(gl_FragCoord.xy + uSeed), h12(gl_FragCoord.xy * 1.7 + uSeed * 1.3), h12(gl_FragCoord.xy * 0.7 - uSeed));
        vec3 col = inputColor.rgb;
        if (uRingProximity > 0.0) {
          vec2 c = uv - 0.5;
          c.x *= aspect;
          float ang = atan(c.y, c.x) + 0.3 * (n.r - 0.5) * uRingProximity;   // +-0.15 rad per pixel
          vec2 u2 = vec2(cos(ang), sin(ang)) * length(c);
          u2.x /= aspect;
          u2 += 0.5;
          float squares = texture2D(tScroll, u2 * 1.5 + uSquareAttr.xy).g * 2.0 - 1.0;
          u2 += squares * 0.01 * uSquareAttr.z * uRingProximity;
          col = texture2D(inputBuffer, u2).rgb;
          if (length(col) < length(vec3(1.0))) {
            vec3 hsv = rgb2hsv(col);
            hsv.y += 0.05 * uRingProximity;
            hsv.z += 0.075 * uRingProximity;
            col = hsv2rgb(hsv);
          }
        }
        // the breathing glare in the top-right corner
        float diag = pow(uv.x * uv.y, 2.0);
        col += diag * (sin(uv.x * aspect * 3.0 + time * 0.5) * sin(uv.y * 4.0 - time * 0.3) * 0.4 + 0.4) * uGlare * n.b * 2.0;
        outputColor = vec4(col, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        uniforms: new Map([
          ['tScroll', new Uniform(scrollData())],
          ['uRingProximity', new Uniform(0)],
          ['uSquareAttr', new Uniform(new Vector3(0, 0, 1))],
          ['uGlare', new Uniform(glare)],
          ['uSeed', new Uniform(0)],
        ]),
      },
    );
  }

  update() {
    this.uniforms.get('uSeed').value = Math.random() * 100;
  }
}

// The last pass. tRings is the composer's own picture (this pass's input);
// tOther is the other section's finished frame: section 2 above (section 3
// comes in), or the hero below (uSwap: it comes in over section 3).
// uProgress = how far the incoming one has come in (0..1, screens). At 1 (not
// swapped) it is a plain copy of the rings.
export class WipePass extends Pass {
  constructor() {
    super('WipePass');
    this.needsSwap = false;
    this.fullscreenMaterial = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tRings: { value: null },
        tOther: { value: null },
        uSwap: { value: 0 },
        tScroll: { value: scrollData() },
        uProgress: { value: 1 },
        uAspect: { value: 1 },
        uResolution: { value: new Vector2(1, 1) },
        uSeed: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tRings, tOther, tScroll;
        uniform float uProgress, uAspect, uSeed, uSwap;
        uniform vec2 uResolution;
        varying vec2 vUv;
        ${SPECTRAL}
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        // igloo's falloff(x, 0, 1, margin, progress): 1 behind the front, 0 ahead of it
        float falloff(float x, float m, float p) { float q = mix(-m, 1.0, p); return clamp((q + m - x) / m, 0.0, 1.0); }
        void main() {
          vec3 col;
          if (uProgress >= 1.0 && uSwap < 0.5) {
            col = texture2D(tRings, vUv).rgb;
          } else {
            vec2 uvTex = (vUv - 0.5) * vec2(uAspect, 1.0) + 0.5;
            vec3 st = texture2D(tScroll, uvTex).rgb;
            float slope = 0.2 * uAspect;
            float inclination = vUv.x + (st.b * 2.0 - 1.0) * 0.4;
            float inc = uProgress * (1.0 + slope);
            float front = vUv.y + inclination * slope;               // rises from the bottom-left
            float blurBand = falloff(front, 2.0, inc);
            float dispBand = falloff(front, 0.9, inc);
            float cutDisp = falloff(st.g, 1.0, dispBand);
            float cutDiag = falloff(front, 0.2, inc);
            float cut = falloff(st.r, 2.0, cutDiag);                 // the cloudy edge
            vec2 nz = vec2(h12(gl_FragCoord.xy + uSeed), h12(gl_FragCoord.xy * 1.3 - uSeed));
            // igloo's modulator is 12; at our sizes that smears the incoming rings
            // well past igloo's look, so half
            float modulator = 6.0 * smoothstep(1.0, 0.7, abs(vUv.x * 2.0 - 1.0)) * smoothstep(1.0, 0.7, abs(vUv.y * 2.0 - 1.0));
            float p3 = uProgress * uProgress * uProgress;
            float q = 1.0 - uProgress;
            // the outgoing scene slides up; the incoming one (fringed near the
            // front, sharp behind it) rises into place
            vec2 uvOut = vUv - vec2(0.0, 0.4 * p3 + 0.025 * cutDisp);
            vec2 uvIn = vUv + vec2(0.0, 0.4 * q * q * q + 0.025 * (1.0 - cutDisp));
            float bendOut = blurBand * nz.x;
            float bendIn = pow(1.0 - blurBand, 2.0) * nz.y;
            // Only what shows: the outgoing picture ahead of the cut, the incoming
            // one behind it, and the 5-sample fringe only where its largest
            // shift (at the barrel's edge) is over half a pixel. This pass runs
            // over every pixel while a wipe is on: the full cost here tipped
            // slow GPUs into dropped frames.
            vec2 cc = vUv - 0.5;
            float reach = length(cc) * dot(cc, cc) * modulator * 0.8 * uResolution.y;
            vec3 a = vec3(0.0);
            vec3 b = vec3(0.0);
            if (cut < 0.999) {
              bool fringe = bendOut * reach > 0.5;
              a = uSwap > 0.5
                ? (fringe ? spectral(tRings, uvOut, modulator, bendOut) : texture2D(tRings, uvOut).rgb)
                : (fringe ? spectral(tOther, uvOut, modulator, bendOut) : texture2D(tOther, uvOut).rgb);
            }
            if (cut > 0.001) {
              bool fringe = bendIn * reach > 0.5;
              b = uSwap > 0.5
                ? (fringe ? spectral(tOther, uvIn, modulator, bendIn) : texture2D(tOther, uvIn).rgb)
                : (fringe ? spectral(tRings, uvIn, modulator, bendIn) : texture2D(tRings, uvIn).rgb);
            }
            col = mix(a, b, cut);
          }
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
          #include <colorspace_fragment>
        }`,
    });
  }

  render(renderer, inputBuffer) {
    const u = this.fullscreenMaterial.uniforms;
    u.tRings.value = inputBuffer.texture;
    u.uSeed.value = Math.random() * 100;
    renderer.setRenderTarget(this.renderToScreen ? null : this.outputTarget ?? null);
    renderer.render(this.scene, this.camera);
  }

  setSize(width, height) {
    const u = this.fullscreenMaterial.uniforms;
    u.uAspect.value = width / height;
    u.uResolution.value.set(width, height);
  }
}
