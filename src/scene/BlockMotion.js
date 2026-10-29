// igloo.inc's block behaviour on our pyramid, simulated per block on the CPU
// and handed to the shaders as a small float texture (see BLOCK_GLSL):
//   pulse  idle swell: a wave travelling along +x, sin(x - 2t), under a slow
//          global envelope, cos(t), with a random amplitude per block
//   hover  blocks within 1-3 m of the mouse point are pushed out; the mouse
//          point is the pointer projected onto a camera-facing plane just in
//          front of the look-at target (no raycast against the mesh)
// Every block moves out along its centroid, to centroid * (1 + push * travel)
// (igloo: travel 1; ours is lower because our blocks are much smaller next to
// their distance from the centre). The push follows its target through two
// smoothing stages, the bottom courses stay put, and blocks wobble a little
// while they are out. 'pulse' and 'hover' (0..1) gate the two effects and are
// animated by the intro timeline.
//   explode  coming back round the loop (StormTransition): igloo's scroll
//          displacement. The upper blocks (60 % of them, at random) fly out
//          along their centroid by up to 2x its length, tumbling, and come back
//          as the hero arrives; smoothed like igloo's (0.075 per frame, twice).
import { DataTexture, FloatType, Plane, Quaternion, Raycaster, RGBAFormat, Vector3 } from 'three';

const TEXELS = 3; // per block: rotation, (push, travel), centroid
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const rot = new Quaternion();
const turn = new Quaternion();
const tmp = new Vector3();

// "Move k of the way per 60 fps frame", independent of the frame rate.
const follow = (k, dt) => 1 - Math.pow(1 - k, dt * 60);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (id, k) => {
  const s = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export class BlockMotion {
  // reducedMotion: no idle pulse (the hover still answers the pointer).
  constructor(geometry, cfg, { reducedMotion = false } = {}) {
    this.cfg = cfg.blocks;
    this.pulseAmount = reducedMotion ? 0 : this.cfg.pulse;
    const { _blockid: ids, _centr: centr, _rand: rand } = geometry.attributes;
    this.blocks = [];
    for (let i = 0; i < ids.count; i++) {
      const id = Math.round(ids.getX(i));
      if (this.blocks[id]) continue;
      const centroid = new Vector3().fromBufferAttribute(centr, i);
      this.blocks[id] = {
        id,
        centroid,
        rand: new Vector3(rand.getX(i), hash(id, 1), hash(id, 2)),
        position: centroid.clone(), // where the block is now
        push: 0, // outward push (fraction of the centroid length), smoothed twice
        pushSmooth: 0,
        target: 0, // the push it is heading for (no smoothing)
        scroll1: 0, // the explode displacement, smoothed twice (igloo's scrollDisplacement)
        scroll2: 0,
      };
    }
    this.top = Math.max(...this.blocks.filter(Boolean).map((b) => b.centroid.y)) || 1;
    this.explode = 0; // 0..1, set by the transition

    const size = Math.ceil(Math.sqrt(this.blocks.length * TEXELS));
    this.texture = new DataTexture(new Float32Array(size * size * 4), size, size, RGBAFormat, FloatType);
    const data = this.texture.image.data;
    for (const b of this.blocks) {
      const o = b.id * TEXELS * 4;
      data[o + 3] = 1; // identity rotation
      data.set([b.centroid.x, b.centroid.y, b.centroid.z], o + 8);
    }
    this.texture.needsUpdate = true;

    this.raycaster = new Raycaster();
    this.plane = new Plane();
    this.normal = new Vector3();
    this.hit = new Vector3();
    this.pointerPoint = new Vector3(0, 1, 0); // where the pointer is now: the plexus
    this.mouse = new Vector3(0, 1, 0); // smoothed mouse point: the blocks
    this.groundMouse = new Vector3(0, 1, 0); // slower copy: the glow on the sand
    // Shared with the block, seam-line and sand shaders.
    this.uniforms = {
      uBlockState: { value: this.texture },
      uGroundMouse: { value: this.groundMouse },
      uPulse: { value: 0 },
      uHover: { value: 0 },
      uTime: { value: 0 },
    };
  }

  // 0..1 gates, tweened by the timeline.
  get pulse() {
    return this.uniforms.uPulse.value;
  }

  set pulse(v) {
    this.uniforms.uPulse.value = v;
  }

  get hover() {
    return this.uniforms.uHover.value;
  }

  set hover(v) {
    this.uniforms.uHover.value = v;
  }

  // camera: with an up-to-date matrixWorld; pointer: normalised device
  // coordinates (-1..1). Like igloo, the pointer starts at the screen centre
  // and keeps its last position when it leaves.
  update(time, dt, camera, target, pointer) {
    const c = this.cfg;
    this.uniforms.uTime.value = time;
    this.normal.copy(camera.position).sub(target).normalize();
    this.plane.setFromNormalAndCoplanarPoint(this.normal, tmp.copy(target).addScaledVector(this.normal, c.planeOffset));
    this.raycaster.setFromCamera(pointer, camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
      this.pointerPoint.copy(this.hit);
      this.mouse.lerp(this.hit, follow(0.05, dt));
      this.groundMouse.lerp(this.hit, follow(0.03, dt));
    }

    const kPush = follow(c.smoothing, dt);
    const kScroll = follow(0.075, dt);
    const [near, far] = c.hoverRadius;
    const data = this.texture.image.data;
    for (const b of this.blocks) {
      const p = b.centroid;
      const r = b.rand;
      // Idle pulse: travelling wave x slow swell x random amplitude.
      let push =
        this.pulseAmount *
        (Math.sin(-time * 2 + p.x) * 0.5 + 0.5) *
        (Math.cos(-time) * 0.5 + 0.5) *
        (0.5 + 1.5 * r.z) *
        0.5 *
        this.pulse;
      // Hover: full push near the mouse point, none beyond 'far'; the amount
      // drifts a little per block.
      const jitter = Math.sin(time + r.x * 12.342) * r.y;
      const reach = 1 - smoothstep(near, far, p.distanceTo(this.mouse));
      push = Math.max(push, reach * (c.hover + c.hoverJitter * jitter) * this.hover);

      push = Math.max(0, push * smoothstep(c.lock[0], c.lock[1], p.y));
      b.target = push;
      b.pushSmooth += (push - b.pushSmooth) * kPush;
      b.push += (b.pushSmooth - b.push) * kPush;
      // Explode (the loop's arrival): igloo's upper-block scroll displacement,
      // on our pyramid's height (igloo's 0.3..1 m of a ~2.5 m dome).
      const up = smoothstep(0.12, 0.4, p.y / this.top);
      const share = Math.min(1, Math.max(0, (r.x - 0.4) / 0.6)) * 2;
      b.scroll1 += (this.explode * up * share - b.scroll1) * kScroll;
      b.scroll2 += (b.scroll1 - b.scroll2) * kScroll;
      const e = b.scroll2;
      b.position.copy(p).multiplyScalar(1 + b.push * c.travel + e);

      // Wobble: a small turn about each axis that grows with the push, plus
      // the tumble of an exploded block.
      const d = b.push;
      rot
        .setFromAxisAngle(AXIS_Y, Math.cos(d * 2 + r.z * 30) * d * c.spin - e * r.z * 1.5)
        .multiply(turn.setFromAxisAngle(AXIS_Z, Math.cos(d * 2 + r.x * 30) * d * c.spin - e * r.x * 1.5))
        .multiply(turn.setFromAxisAngle(AXIS_X, Math.cos(d * 2 + r.y * 30) * d * c.spin - e * r.y * 1.5));

      const o = b.id * TEXELS * 4;
      data[o] = rot.x;
      data[o + 1] = rot.y;
      data[o + 2] = rot.z;
      data[o + 3] = rot.w;
      data[o + 4] = Math.max(d, Math.min(1, e)); // an exploded block glows like a pushed one
      data[o + 5] = d * c.travel + e;
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
