// Post-processing: radial chromatic aberration + bloom + tone mapping +
// vignette in one full-screen pass, then SMAA anti-aliasing + film grain in a
// second. Bloom and CA strength are animated by the timeline. A third pass,
// the sandstorm into section 2 (SandstormEffect), only runs while it's on
// screen (stormOn). renderTo() catches the frame in a texture instead (the
// hero wiping in over section 3 at the end of the loop).
// No MSAA: 4x multisampling of the half-float scene buffer cost ~29 ms a frame
// on integrated GPUs at 2560x1600; SMAA gives clean edges for a fraction of that.
import { HalfFloatType, Uniform } from 'three';
import {
  BlendFunction,
  BloomEffect,
  CopyPass,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { SandstormEffect } from './SandstormEffect.js';

// Red/cyan fringing that points away from the screen centre and grows toward
// the edges (the stock ChromaticAberrationEffect uses one fixed direction).
class RadialChromaticAberration extends Effect {
  constructor() {
    super(
      'RadialChromaticAberration',
      /* glsl */ `
        uniform float amount;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec2 d = uv - 0.5;
          float r = length(d);
          vec2 dir = r > 1e-5 ? d / r : vec2(0.0);
          vec2 off = dir * amount * pow(r / 0.7071, 1.5);   // 'amount' at the corners
          float red = texture2D(inputBuffer, uv - off).r;
          float blue = texture2D(inputBuffer, uv + off).b;
          outputColor = vec4(red, inputColor.g, blue, inputColor.a);
        }`,
      { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['amount', new Uniform(0)]]) },
    );
  }
}

const TONE_MAPPING = {
  ACES_FILMIC: ToneMappingMode.ACES_FILMIC,
  NEUTRAL: ToneMappingMode.NEUTRAL,
  AGX: ToneMappingMode.AGX,
  LINEAR: ToneMappingMode.LINEAR,
};

export class PostFX {
  // storm: SandstormEffect options (noise, colors, wind, parallax, fringe, reducedMotion).
  constructor(renderer, scene, camera, cfg, { mobile = false, storm } = {}) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType, // keep HDR for bloom
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: cfg.bloomThreshold,
      luminanceSmoothing: 0.15,
      intensity: cfg.bloomRest,
      radius: 0.8,
    });
    if (mobile) this.bloom.resolution.scale = cfg.mobileBloomScale ?? 0.5;
    this.ca = new RadialChromaticAberration();
    this.toneMapping = new ToneMappingEffect({ mode: TONE_MAPPING[cfg.toneMapping] ?? ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: cfg.vignette });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY });
    this.grain.blendMode.opacity.value = cfg.grain;

    // The aberration splits the scene before bloom is added, so the soft glow
    // itself isn't fringed (invisible at rest, ~2 px at the corners).
    this.composer.addPass(new EffectPass(camera, this.ca, this.bloom, this.toneMapping, this.vignette));
    // SMAA works on the tone-mapped image; grain after it so it isn't treated as edges.
    this.smaa = new SMAAEffect({ preset: mobile ? SMAAPreset.LOW : SMAAPreset.MEDIUM });
    this.smaaPass = new EffectPass(camera, this.smaa, this.grain);
    this.composer.addPass(this.smaaPass);
    this.storm = new SandstormEffect(storm);
    this.stormPass = new EffectPass(camera, this.storm);
    this.composer.addPass(this.stormPass);
    // off unless renderTo(): the frame into this.copy.texture (linear)
    this.copy = new CopyPass();
    this.composer.addPass(this.copy);
    this.copy.enabled = false;
    this.copy.renderToScreen = false;
    this.stormOn = false;

    this.chromatic = cfg.caRest;
  }

  // The storm pass draws to the screen while it runs; otherwise SMAA does.
  // (Each switch swaps shader variants: IntroScene.compile warms both.)
  get stormOn() {
    return this.stormPass.enabled;
  }

  set stormOn(on) {
    if (this._stormOn === on) return;
    this._stormOn = on;
    this.stormPass.enabled = on;
    this.stormPass.renderToScreen = on;
    this.smaaPass.renderToScreen = !on;
  }

  get chromatic() {
    return this.ca.uniforms.get('amount').value;
  }

  set chromatic(v) {
    this.ca.uniforms.get('amount').value = v;
  }

  get bloomIntensity() {
    return this.bloom.intensity;
  }

  set bloomIntensity(v) {
    this.bloom.intensity = v;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }

  // The frame into a texture (this.texture, linear, before the screen's sRGB).
  renderTo(dt) {
    const last = this.stormOn ? this.stormPass : this.smaaPass;
    last.renderToScreen = false;
    this.copy.enabled = true;
    this.composer.render(dt);
    this.copy.enabled = false;
    last.renderToScreen = true;
    return this.copy.texture;
  }

  get texture() {
    return this.copy.texture;
  }

  dispose() {
    this.composer.dispose();
  }
}
