// The hero pyramid. Representations driven by the intro:
//   seed   - glowing point at the apex (phase B)
//   wire   - fat-line wireframe DRAWN from the apex (phase C); a depth-only
//            proxy of the solid hides the back edges so it reads as a shape
//   solid  - blocks mesh with the phase material (phases D-F)
// Live hero (our GLB only): igloo's idle pulse and hover on the blocks
// (BlockMotion), each block glowing gold from inside (pyramidMaterial). The
// seam lines move with their blocks. The block shell is hollow (PYR_Core, the
// filler inside it, isn't used), so a gap shows the pyramid's own blocks from
// the inside, like igloo's hollow dome.
// Works with our exported pyramid.glb (PYR_Blocks + PYR_Edges) or any other GLB:
// its largest mesh is auto-centred, scaled to BASE_WIDTH and gets generated
// edges (EdgesGeometry).
import {
  AdditiveBlending,
  Box3,
  Color,
  CanvasTexture,
  EdgesGeometry,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { BlockMotion } from './BlockMotion.js';
import { createDrawLines } from './shaders/drawLines.js';
import { createPyramidMaterial } from './shaders/pyramidMaterial.js';

const BASE_WIDTH = 5; // the scene is laid out around a 5 m pyramid

export class PyramidModel {
  constructor(assets, cfg, { reducedMotion = false } = {}) {
    this.cfg = cfg;
    const root = assets.models.pyramid;
    let blocks = root.getObjectByName('PYR_Blocks');
    this.isOurs = !!blocks?.geometry.attributes._blockid;
    if (!blocks) {
      root.traverse((o) => {
        if (o.isMesh && (!blocks || o.geometry.attributes.position.count > blocks.geometry.attributes.position.count)) blocks = o;
      });
      normalise(blocks);
    }
    blocks.removeFromParent();
    blocks.frustumCulled = false; // blocks move beyond the rest bounds
    this.blocks = blocks;
    blocks.geometry.computeBoundingBox();
    const bb = blocks.geometry.boundingBox;
    this.apex = new Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2);
    this.baseY = bb.min.y;
    this.height = bb.max.y - bb.min.y;

    this.motion = this.isOurs ? new BlockMotion(blocks.geometry, cfg, { reducedMotion }) : null;
    this.material = createPyramidMaterial({
      bake: assets.bakes.pyramid,
      exploded: assets.bakes.pyramid_exploded,
      stoneDetail: assets.details.stone,
      hasBlockAttributes: this.isOurs,
      motion: this.motion,
      cfg,
    });
    blocks.material = this.material;
    this.uniforms = this.material.uniforms;

    this.buildWire(root.getObjectByName('PYR_Edges'));
    this.buildSeed();
  }

  // ---------------------------------------------------------------- live hero
  // 0 during the intro, 1 in the live hero: gates both the idle pulse and the
  // hover (animated by the timeline).
  get live() {
    return this.motion?.pulse ?? 0;
  }

  set live(v) {
    if (!this.motion) return;
    this.motion.pulse = v;
    this.motion.hover = v;
  }

  // ---------------------------------------------------------------- wire
  buildWire(edgesObj) {
    let positions;
    let blockIds = null;
    if (edgesObj) {
      const g = edgesObj.geometry.index ? edgesObj.geometry.toNonIndexed() : edgesObj.geometry;
      positions = g.attributes.position.array;
      if (this.motion && g.attributes._rand) blockIds = this.edgeBlockIds(g);
    } else {
      positions = new EdgesGeometry(this.blocks.geometry, 25).attributes.position.array;
    }
    const count = positions.length / 6;
    const dist = (i) =>
      Math.hypot(positions[i] - this.apex.x, positions[i + 1] - this.apex.y, positions[i + 2] - this.apex.z);
    let max = 0;
    for (let i = 0; i < positions.length; i += 3) max = Math.max(max, dist(i));
    const per = new Float32Array(count * 4);
    for (let s = 0; s < count; s++) {
      per[s * 4] = dist(s * 6) / max;
      per[s * 4 + 1] = dist(s * 6 + 3) / max;
      per[s * 4 + 2] = 0.55; // alpha: dense block edges, keep them fine
      per[s * 4 + 3] = 0;
    }
    const w = this.cfg.wire;
    this.wire = createDrawLines(new Float32Array(positions), per, {
      color: this.cfg.colors.line,
      linewidth: w.lineWidth,
      headWidth: w.headWidth,
      headBoost: w.headBoost,
      intensity: 1.3,
      blockIds,
      blockState: this.motion?.uniforms.uBlockState,
    });
    this.wire.renderOrder = 2;
    this.lineColor = new Color(this.cfg.colors.line);
    this.seamColor = new Color(this.cfg.colors.seamGlow);

    // Depth-only copy of the solid so back edges are hidden behind the shape.
    this.occluder = new Mesh(this.blocks.geometry, new MeshBasicMaterial({ colorWrite: false }));
    this.occluder.renderOrder = 1;
  }

  // Block id of every edge segment. Edges carry their block's _rand, which is
  // unique per block, so it identifies the block.
  edgeBlockIds(g) {
    const b = this.blocks.geometry.attributes;
    const idByRand = new Map();
    for (let v = 0; v < b._rand.count; v++) idByRand.set(b._rand.getX(v), b._blockid.getX(v));
    const rand = g.attributes._rand;
    const ids = new Float32Array(g.attributes.position.count / 2);
    for (let s = 0; s < ids.length; s++) ids[s] = idByRand.get(rand.getX(s * 2)) ?? 0;
    return ids;
  }

  get wireProgress() {
    return this.wire.material.uniforms.uProgress.value;
  }

  set wireProgress(v) {
    this.wire.material.uniforms.uProgress.value = v;
  }

  // 0 = white scan lines, 1 = warm seam glow (colors.seamGlow).
  get wireWarm() {
    return this._wireWarm ?? 0;
  }

  set wireWarm(v) {
    this._wireWarm = v;
    this.wire.material.color.lerpColors(this.lineColor, this.seamColor, v);
  }

  get wireFade() {
    return this.wire.material.uniforms.uFade.value;
  }

  set wireFade(v) {
    this.wire.material.uniforms.uFade.value = v;
    this.wire.visible = v > 0.001;
  }

  // ---------------------------------------------------------------- seed
  buildSeed() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.06, 'rgba(255,255,255,1)');
    grad.addColorStop(0.16, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.seed = new Sprite(
      new SpriteMaterial({
        map: new CanvasTexture(c),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.seed.position.copy(this.apex).add(new Vector3(0, 0.02, 0));
    this.seedColor = new Color(this.cfg.colors.line).lerp(new Color(1, 1, 1), 0.35); // hot gold-white core
    this.seed.renderOrder = 10;
    this.seedIntensity = 0;
  }

  get seedIntensity() {
    return this._seed ?? 0;
  }

  set seedIntensity(v) {
    this._seed = v;
    this.seed.visible = v > 0.001;
  }

  // ---------------------------------------------------------------- module API
  objects() {
    return [this.blocks, this.occluder, this.wire, this.seed];
  }

  update(time, dt, scene) {
    this.wire.material.uniforms.uTime.value = time;
    const pulse = 1 + 0.12 * Math.sin(time * 7.0);
    const s = 0.9 * pulse * (0.4 + 0.6 * this.seedIntensity);
    this.seed.scale.set(s, s, s);
    this.seed.material.color.copy(this.seedColor).multiplyScalar(7.0 * this.seedIntensity);
    this.uniforms.uTime.value = time;
    // The depth-only proxy is only needed until the solid is fully drawn.
    this.occluder.visible = this.uniforms.uFinal.value < 1;
    this.motion?.update(time, dt, scene.camera, scene.target, scene.pointer.ndc);
  }

  resize(w, h) {
    this.wire.material.resolution.set(w, h);
  }

  dispose() {
    this.wire.geometry.dispose();
    this.wire.material.dispose();
    this.occluder.material.dispose();
    this.seed.material.map.dispose();
    this.seed.material.dispose();
    this.motion?.dispose();
  }
}

// Centre on the origin (xz), rest the base on y = 0 and scale to BASE_WIDTH.
function normalise(mesh) {
  const g = mesh.geometry;
  mesh.updateWorldMatrix(true, false);
  g.applyMatrix4(mesh.matrixWorld);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  const bb = new Box3().setFromBufferAttribute(g.attributes.position);
  const size = bb.getSize(new Vector3());
  const s = BASE_WIDTH / Math.max(size.x, size.z);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.scale(s, s, s);
  g.computeVertexNormals();
}
