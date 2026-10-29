// The sandstorm between the hero and section 2: igloo's scene cut (a
// noise-edged front rising from the bottom while the hero slides up and the
// next section slides in from below), as a wall of sand. It rolls in from the
// bottom-left with the wind (left -> right on screen): billowing top lit by the
// sun, darker inside, raced through by streaks and grains. Ahead of it the
// blowing sand blurs and fringes the hero; behind it the dust thins out into
// section 2. Runs as the last post pass, only while the storm is on screen.
//   storm:    0..1 across the storm's screen of scroll (the wall's progress)
//   approach: 0..1 across the pull-back before it (sand lifting off the ground)
import { Color, Uniform } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const fragmentShader = /* glsl */ `
  uniform sampler2D tSceneB, tNoise;
  uniform float uStorm, uApproach, uTime, uWind, uParallax, uFringe, uMotion;
  uniform vec3 uLight, uMid, uDeep;

  // Tiling fbm (hazeNoiseTexture: 16 units per repeat), 0..~0.94, mean ~0.47.
  float N(vec2 q) { return texture2D(tNoise, q * 0.0625).r; }
  // ...without its finest octaves (a coarser mip): soft, rounded shapes.
  float Ns(vec2 q, float bias) { return texture2D(tNoise, q * 0.0625, bias).r; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  // Height of the wall's front at screen x: rises with the storm, higher on
  // the left where it arrives first, its top rolling in big lobes downwind.
  float frontAt(float x, float c, float w) {
    float lobes = N(vec2(x * aspect * 1.1 - w * 0.8, c * 1.5 + 3.1));
    return mix(-0.55, 1.95, c) - (x - 0.5) * 0.3 + (lobes - 0.47) * 0.55;
  }

  // Billowing puffs: soft domain-warped fbm racing downwind and slowly rolling.
  float billows(vec2 p, float w) {
    vec2 q = p * vec2(2.3, 2.7) + vec2(-w * 2.0, w * 0.25);
    q += (vec2(Ns(q * 0.45 + vec2(3.1, 7.7), 2.0), Ns(q * 0.45 + vec2(8.3, 1.9 + w * 0.3), 2.0)) - 0.47) * 1.6;
    return Ns(q, 1.6);
  }

  // The wall as a density field (> 0 inside): its edge follows the puffs'
  // contours, so the top breaks up into rounded billows.
  float wallAt(vec2 uv, float c, float w) {
    vec2 p = vec2(uv.x * aspect, uv.y);
    return (frontAt(uv.x, c, w) - uv.y) * 2.4 + (billows(p, w) - 0.47) * 1.1;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float c = uStorm;
    float w = uTime * uWind;
    vec2 p = vec2(uv.x * aspect, uv.y);

    // ---- the wall
    float dens = wallAt(uv, c, w);
    float inside = dens / 2.4; // ~ screen heights below the edge
    float cover = smoothstep(0.0, 0.1, dens);
    // Light from the upper left (the hero's sun): density falling toward the
    // light = a billow's lit face. Strongest on the wall's outer billows.
    float toLight = dens - wallAt(uv + vec2(-0.02, 0.03), c, w);
    float lit = smoothstep(0.0, 0.3, toLight);
    float depthIn = clamp(inside / 0.5, 0.0, 1.0);
    vec3 wall = mix(uMid, uDeep, smoothstep(0.05, 1.0, depthIn));
    wall = mix(wall, uLight, lit * (1.0 - 0.75 * depthIn));
    wall *= 1.0 - 0.18 * (1.0 - lit) * smoothstep(0.0, 0.3, dens); // self-shadow under each billow
    // Streaks of faster sand racing through it, bent by the billows (stretched
    // along the wind, but not so far that they read as ruled lines).
    float streak = N(vec2(p.x * 1.3 - w * 3.2, p.y * 12.0 + (dens - 0.5) * 1.5));
    wall *= 0.92 + 0.16 * smoothstep(0.4, 0.75, streak);
    // Plumes torn off the top by the wind, streaming downwind above the edge.
    float plume = smoothstep(-0.5, 0.0, dens) * (1.0 - cover);
    plume *= smoothstep(0.35, 0.8, Ns(vec2(p.x * 1.7 - w * 2.6, p.y * 5.0 + w * 0.2), 1.0)) * 0.65;
    // Warm fringes on the edge (the cover sampled a little left / right per channel).
    float fr = uFringe * (0.3 + 0.7 * c);
    vec3 coverRGB = vec3(smoothstep(0.0, 0.1, wallAt(uv + vec2(fr, 0.0), c, w)), cover,
                         smoothstep(0.0, 0.1, wallAt(uv - vec2(fr, 0.0), c, w)));

    // ---- the hero, sliding up, blurred and fringed by the sand blowing ahead of the wall
    float shift = uParallax * c * c * c * uMotion;
    vec2 uvA = vec2(uv.x, uv.y - shift);
    float ahead = 1.0 - smoothstep(0.0, 0.22, -inside); // the air just above the front
    ahead = max(ahead, uApproach * smoothstep(0.35, 0.0, uv.y) * 0.5); // sand lifting during the pull-back
    vec3 A;
    if (ahead > 0.002) {
      vec2 d = vec2(ahead * ahead * 0.005, 0.0);
      A = (texture2D(inputBuffer, uvA - 2.0 * d).rgb + texture2D(inputBuffer, uvA - d).rgb + texture2D(inputBuffer, uvA).rgb
         + texture2D(inputBuffer, uvA + d).rgb + texture2D(inputBuffer, uvA + 2.0 * d).rgb) * 0.2;
      // a little fringing right at the front (igloo's is much stronger: ice, not sand)
      float f = uFringe * ahead * ahead * 0.6 * uMotion;
      A.r = mix(A.r, texture2D(inputBuffer, uvA + vec2(f, 0.0)).r, ahead);
      A.b = mix(A.b, texture2D(inputBuffer, uvA - vec2(f, 0.0)).b, ahead);
      // dust in the air ahead of the wall
      float veil = ahead * ahead * (0.2 + 0.3 * smoothstep(0.3, 0.7, streak));
      A = mix(A, uLight, veil);
    } else {
      A = texture2D(inputBuffer, uvA).rgb;
    }

    // ---- section 2 behind the storm, sliding in from below as the dust thins
    // (the last of the dust clears off quickly near the end, so it is all gone
    // by c = 0.98, where StormTransition already hands over to section 2)
    float clearLine = mix(-1.9, 1.75, c) + smoothstep(0.85, 0.98, c) * 0.65 - (uv.x - 0.5) * 0.3 + (N(vec2(p.x * 1.1 - w * 0.7, 7.3)) - 0.47) * 0.6;
    float clear = smoothstep(0.0, 0.45, clearLine - uv.y + (streak - 0.47) * 0.2);
    float shiftB = uParallax * (1.0 - c) * (1.0 - c) * (1.0 - c) * uMotion;
    vec3 B = texture2D(tSceneB, vec2(uv.x, uv.y + shiftB)).rgb;
    // the vignette section 2 gets on its own (VaultScene output), so the handover is seamless
    B *= 1.0 - 0.35 * smoothstep(0.35, 1.0, length(uv - 0.5) * 1.25);
    // leftover dust drifting across section 2 until the storm has passed
    B = mix(B, uMid * 0.55, (1.0 - clear) * 0.6 + 0.25 * smoothstep(0.4, 0.8, streak) * (1.0 - c));

    vec3 col = mix(A, uLight * 0.96, plume);
    col = mix(col, wall, coverRGB);
    col = mix(col, B, clear);

    // ---- grains: thin streaks racing downwind in and just ahead of the wall,
    // each its own length, brightness and speed
    float grains = 0.0;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      vec2 g = vec2(p.x * (9.0 + fk * 5.0) - w * (13.0 + fk * 6.0), p.y * (170.0 + fk * 60.0) + fk * 0.5);
      vec2 id = floor(g);
      vec2 f = fract(g);
      float h = hash(id + fk * 17.0);
      float len = 0.25 + 0.6 * hash(id + 3.7);
      float x0 = hash(id + 9.2) * (1.0 - len);
      float dash = step(0.991, h) * smoothstep(x0, x0 + 0.1 * len, f.x) * (1.0 - smoothstep(x0 + 0.6 * len, x0 + len, f.x))
                 * (1.0 - smoothstep(0.15, 0.4, abs(f.y - 0.5)));
      grains += dash * (0.35 + 0.65 * hash(id + 5.1));
    }
    // mostly around the front, a few deeper in
    float grainZone = (smoothstep(-0.6, -0.05, -abs(dens - 0.1)) + 0.25 * cover) * (1.0 - clear);
    col += uLight * grains * grainZone * 0.4;

    outputColor = vec4(col, 1.0);
  }
`;

export class SandstormEffect extends Effect {
  // noise: hazeNoiseTexture() (tiling fbm); colors: linear THREE.Colors.
  constructor({ noise, colors, wind, parallax, fringe, reducedMotion = false }) {
    super('SandstormEffect', fragmentShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['tSceneB', new Uniform(null)],
        ['tNoise', new Uniform(noise)],
        ['uStorm', new Uniform(0)],
        ['uApproach', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uWind', new Uniform(reducedMotion ? 0 : wind)],
        ['uParallax', new Uniform(parallax)],
        ['uFringe', new Uniform(fringe)],
        ['uMotion', new Uniform(reducedMotion ? 0 : 1)],
        ['uLight', new Uniform(new Color(colors.light))],
        ['uMid', new Uniform(new Color(colors.mid))],
        ['uDeep', new Uniform(new Color(colors.deep))],
      ]),
    });
  }

  set(name, value) {
    this.uniforms.get(name).value = value;
  }
}
