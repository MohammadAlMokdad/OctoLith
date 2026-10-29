#!/usr/bin/env node
// Trim the hero world to what its cameras can ever see, after a Blender export
// (30_bake_s1.py + 40_export_s1.py):
//   node tools/trim-world.mjs          (--dry: report only, write nothing)
//
// Cameras: the intro timeline (replayed with the real createIntroTimeline,
// reveal radius included), the hero with the mouse parallax and idle drift at
// their extremes, and the pull-back to cfg.camera.exit as the page scrolls on
// into section 2, on screens up to cfg.camera.maxAspect wide (wider ones keep
// that horizontal field of view, see IntroScene.resize).
//
// A triangle is kept unless, for every camera, all of its corners lie outside
// the same frustum plane (conservative: nothing that could show is dropped),
// plus a one-triangle ring around what is kept. DUNE_Far and the landmarks also
// drop faces that never face a camera (their materials are front-side only);
// DUNE_Base keeps its back slopes, since the sand grains' height map is
// rasterised from it. Landmark copies no camera sees are removed.
//
// The bakes of the trimmed meshes are cropped to the part their kept
// triangles use (+ PAD px) and the UVs remapped to match. The GLBs are marked
// (asset.extras.trimWorld), so a second run does nothing until the next export.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { INTRO_CONFIG as cfg } from '../src/config/introConfig.js';
import { createIntroTimeline } from '../src/timeline/introTimeline.js';
import { exitOffsets } from '../src/transition/exitPath.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'public/assets/models');
const TEXTURES = path.join(ROOT, 'public/assets/textures');
const DRY = process.argv.includes('--dry');
const FOV_MARGIN = 1.04; // a little wider than the real lens
const BACKFACE_TOL = -0.02; // keep faces within ~1 deg of edge-on
const PAD = 32; // px kept around the used part of a bake (mip filtering)

// ---------------------------------------------------------------- GLB io
function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const TYPES = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
  const accessor = (i) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const n = SIZES[a.type];
    const T = TYPES[a.componentType];
    if (v.byteStride && v.byteStride !== n * T.BYTES_PER_ELEMENT) throw new Error('interleaved buffers are not supported');
    const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return { array: new T(bin.buffer.slice(off, off + a.count * n * T.BYTES_PER_ELEMENT)), size: n, type: a.type };
  };
  const meshes = json.meshes.map((m) => {
    if (m.primitives.length !== 1) throw new Error(`${m.name}: one primitive per mesh expected`);
    const p = m.primitives[0];
    const attributes = Object.fromEntries(Object.entries(p.attributes).map(([k, i]) => [k, accessor(i)]));
    return { name: m.name, attributes, index: accessor(p.indices).array };
  });
  return { json, meshes, size: buf.length };
}

function writeGlb(file, { json, meshes }) {
  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;
  const push = (array, target) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes);
    offset += bytes.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return views.length - 1;
  };
  const COMP = (a) => (a instanceof Float32Array ? 5126 : a instanceof Uint32Array ? 5125 : 5123);
  const out = { ...json, meshes: [], accessors, bufferViews: views };
  for (const m of meshes) {
    const attributes = {};
    for (const [name, a] of Object.entries(m.attributes)) {
      const acc = { bufferView: push(a.array, 34962), componentType: 5126, count: a.array.length / a.size, type: a.type };
      if (name === 'POSITION') {
        acc.min = [Infinity, Infinity, Infinity];
        acc.max = [-Infinity, -Infinity, -Infinity];
        a.array.forEach((x, i) => {
          acc.min[i % 3] = Math.min(acc.min[i % 3], x);
          acc.max[i % 3] = Math.max(acc.max[i % 3], x);
        });
      }
      accessors.push(acc);
      attributes[name] = accessors.length - 1;
    }
    accessors.push({ bufferView: push(m.index, 34963), componentType: COMP(m.index), count: m.index.length, type: 'SCALAR' });
    out.meshes.push({ name: m.name, primitives: [{ attributes, indices: accessors.length - 1 }] });
  }
  out.buffers = [{ byteLength: offset }];
  const jsonBuf = Buffer.from(JSON.stringify(out));
  const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20);
  const binBuf = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonBuf.length + jsonPad.length + 8 + binBuf.length;
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHead = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  fs.writeFileSync(
    file,
    Buffer.concat([header, chunkHead(jsonBuf.length + jsonPad.length, 0x4e4f534a), jsonBuf, jsonPad, chunkHead(binBuf.length, 0x004e4942), binBuf]),
  );
  return total;
}

// ---------------------------------------------------------------- PNG io (8-bit RGB / RGBA, no interlace)
function readPng(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let w, h, ctype;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ctype = data[9];
      if (data[8] !== 8 || ![2, 6].includes(ctype) || data[12] !== 0) throw new Error(`${file}: only 8-bit RGB/RGBA, non-interlaced PNGs`);
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, ctype, px };
}

function writePng(file, { w, h, bpp, ctype, px }) {
  const stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = up ? up[i] : 0;
        const c = up && i >= bpp ? up[i - bpp] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - pred) & 255;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ctype;
  const out = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, out);
  return out.length;
}

// ---------------------------------------------------------------- cameras
function cameraSamples() {
  const C = cfg.camera;
  // The real intro timeline on stand-in targets: only the numbers matter.
  const uni = () => ({ value: 0 });
  // (gsap warns about any property missing here: add new tweened ones.)
  const parts = {
    scene: { rig: { azimuth: 0, elevation: 0, distance: 0, targetY: 0, parallax: 0, idle: 0 }, post: { bloomIntensity: 0, chromatic: 0 }, atmosphere: 0 },
    pyramid: {
      uniforms: { uFillY: uni(), uFinal: uni(), uXray: uni(), uFlash: uni() },
      apex: { y: 3.2 },
      baseY: 0,
      seedIntensity: 0,
      wireProgress: 0,
      wireFade: 0,
      wireWarm: 0,
      live: 0,
    },
    network: { progress: 0, fade: 0 },
    ground: { reveal: 0, dotsProgress: 0, dotsFade: 0 },
    sand: { intensity: 0 },
    ui: { blocks: [], reveal() {} },
  };
  const tl = createIntroTimeline(parts, cfg);
  const rigs = [];
  const sway = (r) => {
    const az = C.parallax * r.parallax + C.idleDrift * r.idle;
    const el = C.parallax * 0.5 * r.parallax;
    if (!az && !el) return [r];
    const out = [];
    for (const a of [-1, 0, 1]) for (const e of [-1, 0, 1]) out.push({ ...r, azimuth: r.azimuth + a * az, elevation: r.elevation + e * el });
    return out;
  };
  for (let t = 0; t <= tl.duration() + 1e-6; t += 0.05) {
    tl.seek(t);
    const reveal = parts.ground.reveal;
    if (reveal <= 0) continue; // nothing of the world is drawn yet
    rigs.push(...sway({ ...parts.scene.rig, reveal }));
  }
  tl.seek(tl.duration());
  // The pull-back into section 2: the same path StormTransition drives
  // (igloo's curve between cfg.camera.hero and cfg.camera.exit), and the
  // straight line between them for good measure.
  const hero = { ...parts.scene.rig, reveal: Infinity };
  for (let s = 0; s <= 1 + 1e-6; s += 0.025) {
    const o = exitOffsets(s, C);
    rigs.push(...sway({ ...hero, ...Object.fromEntries(Object.keys(o).map((k) => [k, hero[k] + o[k]])) }));
    const lerp = (k) => hero[k] + (C.exit[k] - hero[k]) * s;
    rigs.push(...sway({ ...hero, azimuth: lerp('azimuth'), elevation: lerp('elevation'), distance: lerp('distance'), targetY: lerp('targetY') }));
  }
  const camera = new THREE.PerspectiveCamera(C.fov * FOV_MARGIN, C.maxAspect, 0.1, 2000);
  return rigs.map((r) => {
    const az = THREE.MathUtils.degToRad(r.azimuth);
    const el = THREE.MathUtils.degToRad(r.elevation);
    const target = new THREE.Vector3(C.target[0], r.targetY, C.target[2]);
    camera.position.set(
      target.x + r.distance * Math.cos(el) * Math.cos(az),
      target.y + r.distance * Math.sin(el),
      target.z + r.distance * Math.cos(el) * Math.sin(az),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return { vp: vp.elements.slice(), pos: camera.position.clone(), reveal: r.reveal };
  });
}

// ---------------------------------------------------------------- visibility
// Returns per-triangle flags: 1 = in some frustum, 2 = also faces that camera.
function visibility(mesh, matrix, cams) {
  const P = mesh.attributes.POSITION.array;
  const idx = mesh.index;
  const nV = P.length / 3;
  const nT = idx.length / 3;
  const wp = new Float32Array(nV * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < nV; i++) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(matrix);
    wp.set([v.x, v.y, v.z], i * 3);
  }
  // per-triangle centroid, normal, min |xz| and longest xz edge (for the reveal disc)
  const cen = new Float32Array(nT * 3);
  const nrm = new Float32Array(nT * 3);
  const rMin = new Float32Array(nT);
  for (let f = 0; f < nT; f++) {
    const [a, b, c] = [idx[f * 3] * 3, idx[f * 3 + 1] * 3, idx[f * 3 + 2] * 3];
    const e1 = [wp[b] - wp[a], wp[b + 1] - wp[a + 1], wp[b + 2] - wp[a + 2]];
    const e2 = [wp[c] - wp[a], wp[c + 1] - wp[a + 1], wp[c + 2] - wp[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    nrm.set([n[0] / l, n[1] / l, n[2] / l], f * 3);
    let r = Infinity;
    let edge = 0;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      r = Math.min(r, Math.hypot(wp[p], wp[p + 2]));
      edge = Math.max(edge, Math.hypot(wp[p] - wp[q], wp[p + 2] - wp[q + 2]));
    }
    rMin[f] = r - edge;
    for (let k = 0; k < 3; k++) cen[f * 3 + k] = (wp[a + k] + wp[b + k] + wp[c + k]) / 3;
  }
  const flags = new Uint8Array(nT);
  const clip = new Float32Array(nV * 4);
  for (const cam of cams) {
    const m = cam.vp;
    for (let i = 0; i < nV; i++) {
      const x = wp[i * 3], y = wp[i * 3 + 1], z = wp[i * 3 + 2];
      clip[i * 4] = m[0] * x + m[4] * y + m[8] * z + m[12];
      clip[i * 4 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      clip[i * 4 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      clip[i * 4 + 3] = m[3] * x + m[7] * y + m[11] * z + m[15];
    }
    for (let f = 0; f < nT; f++) {
      if (flags[f] === 3 || rMin[f] > cam.reveal) continue;
      let out = 63;
      for (let k = 0; k < 3; k++) {
        const j = idx[f * 3 + k] * 4;
        const X = clip[j], Y = clip[j + 1], Z = clip[j + 2], W = clip[j + 3];
        out &= (X < -W) | ((X > W) << 1) | ((Y < -W) << 2) | ((Y > W) << 3) | ((Z < -W) << 4) | ((Z > W) << 5);
      }
      if (out) continue;
      flags[f] |= 1;
      const dx = cam.pos.x - cen[f * 3], dy = cam.pos.y - cen[f * 3 + 1], dz = cam.pos.z - cen[f * 3 + 2];
      if ((nrm[f * 3] * dx + nrm[f * 3 + 1] * dy + nrm[f * 3 + 2] * dz) / Math.hypot(dx, dy, dz) > BACKFACE_TOL) flags[f] |= 2;
    }
  }
  return flags;
}

// Keep the selected triangles plus every triangle sharing a corner with one.
function grow(mesh, keep) {
  const idx = mesh.index;
  const touched = new Uint8Array(mesh.attributes.POSITION.array.length / 3);
  for (let f = 0; f < keep.length; f++) if (keep[f]) for (let k = 0; k < 3; k++) touched[idx[f * 3 + k]] = 1;
  const out = keep.slice();
  for (let f = 0; f < keep.length; f++) if (!out[f] && (touched[idx[f * 3]] || touched[idx[f * 3 + 1]] || touched[idx[f * 3 + 2]])) out[f] = 1;
  return out;
}

// New mesh with only the kept triangles and the vertices they use.
function compact(mesh, keep) {
  const idx = mesh.index;
  const remap = new Int32Array(mesh.attributes.POSITION.array.length / 3).fill(-1);
  const order = [];
  const tris = [];
  for (let f = 0; f < keep.length; f++) {
    if (!keep[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k];
      if (remap[v] < 0) {
        remap[v] = order.length;
        order.push(v);
      }
      tris.push(remap[v]);
    }
  }
  const attributes = {};
  for (const [name, a] of Object.entries(mesh.attributes)) {
    const arr = new Float32Array(order.length * a.size);
    order.forEach((v, i) => arr.set(a.array.subarray(v * a.size, (v + 1) * a.size), i * a.size));
    attributes[name] = { ...a, array: arr };
  }
  const index = order.length > 65535 ? Uint32Array.from(tris) : Uint16Array.from(tris);
  return { name: mesh.name, attributes, index };
}

// Crop a bake to the part the mesh's UVs use and remap them. The used u range
// may run across the 0/1 seam of a wrapped unwrap (the far dunes' ring):
// the image is rolled so the largest unused stretch of u sits at the seam.
function cropBake(mesh, file) {
  const img = readPng(file);
  const uv = mesh.attributes.TEXCOORD_0.array;
  const BINS = 2048;
  const used = new Uint8Array(BINS);
  const idx = mesh.index;
  for (let f = 0; f < idx.length / 3; f++) {
    const us = [0, 1, 2].map((k) => uv[idx[f * 3 + k] * 2]);
    for (let b = Math.floor(Math.min(...us) * BINS); b <= Math.floor(Math.max(...us) * BINS); b++) used[Math.min(BINS - 1, Math.max(0, b))] = 1;
  }
  // largest circular run of unused bins -> the seam goes in its middle
  let best = 0, bestStart = 0;
  for (let s = 0; s < BINS; s++) {
    if (used[s] || !used[(s + BINS - 1) % BINS]) continue;
    let n = 0;
    while (n < BINS && !used[(s + n) % BINS]) n++;
    if (n > best) {
      best = n;
      bestStart = s;
    }
  }
  const seam = ((bestStart + best / 2) / BINS) % 1; // u that becomes the new 0
  const shift = used[0] && used[BINS - 1] ? 1 - seam : 0; // roll only when the used part crosses u = 0/1
  const shiftPx = Math.round(shift * img.w);
  const wrapU = (u) => {
    const s = u + shiftPx / img.w;
    return s >= 1 + 1e-6 ? s - 1 : s;
  };
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.length; i += 2) {
    const u = wrapU(uv[i]);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, uv[i + 1]);
    v1 = Math.max(v1, uv[i + 1]);
  }
  const x0 = Math.max(0, Math.floor(u0 * img.w) - PAD);
  const x1 = Math.min(img.w, Math.ceil(u1 * img.w) + PAD);
  const y0 = Math.max(0, Math.floor(v0 * img.h) - PAD);
  const y1 = Math.min(img.h, Math.ceil(v1 * img.h) + PAD);
  const w = x1 - x0;
  const h = y1 - y0;
  const px = Buffer.alloc(w * h * img.bpp);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (((x0 + x - shiftPx) % img.w) + img.w) % img.w;
      img.px.copy(px, (y * w + x) * img.bpp, ((y0 + y) * img.w + sx) * img.bpp, ((y0 + y) * img.w + sx + 1) * img.bpp);
    }
  }
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = (wrapU(uv[i]) * img.w - x0) / w;
    uv[i + 1] = (uv[i + 1] * img.h - y0) / h;
  }
  const before = fs.statSync(file).size;
  const after = DRY ? null : writePng(file, { ...img, w, h, px });
  return { file: path.basename(file), from: [img.w, img.h], to: [w, h], rect: [x0, y0, w, h], rollPx: shiftPx, before, after };
}

// ---------------------------------------------------------------- main
const terrainFile = path.join(MODELS, 'terrain.glb');
const landmarksFile = path.join(MODELS, 'landmarks.glb');
const terrain = readGlb(terrainFile);
const landmarks = readGlb(landmarksFile);
if (terrain.json.asset.extras?.trimWorld || landmarks.json.asset.extras?.trimWorld) {
  console.log('Already trimmed (asset.extras.trimWorld). Re-export from Blender first (30_bake_s1.py + 40_export_s1.py).');
  process.exit(0);
}
const cams = cameraSamples();
console.log(`${cams.length} camera samples (intro, hero, pull-back to cfg.camera.exit; aspect up to ${cfg.camera.maxAspect})`);
const report = [];
const nodeMatrix = (n) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
  );

// Terrain: DUNE_Base by frustum only, DUNE_Far by frustum + facing.
const bakes = { DUNE_Base: 'ground_color.png', DUNE_Far: 'far_color.png' };
const crops = [];
terrain.meshes = terrain.meshes.map((mesh, mi) => {
  const node = terrain.json.nodes.find((n) => n.mesh === mi);
  const flags = visibility(mesh, nodeMatrix(node), cams);
  const need = mesh.name === 'DUNE_Base' ? 1 : 3;
  const keep = grow(mesh, Uint8Array.from(flags, (f) => ((f & need) === need ? 1 : 0)));
  const out = compact(mesh, keep);
  report.push([mesh.name, mesh.index.length / 3, out.index.length / 3, mesh.attributes.POSITION.array.length / 3, out.attributes.POSITION.array.length / 3]);
  if (bakes[mesh.name]) crops.push(cropBake(out, path.join(TEXTURES, bakes[mesh.name])));
  return out;
});

// Landmarks: drop the copies no camera sees; trim the shared mesh to faces any kept copy shows.
const lmMesh = landmarks.meshes[0];
const lmKeep = new Uint8Array(lmMesh.index.length / 3);
const keptNodes = [];
for (const n of landmarks.json.nodes) {
  const flags = visibility(lmMesh, nodeMatrix(n), cams);
  const seen = flags.some((f) => f & 1);
  report.push([n.name, lmMesh.index.length / 3, seen ? 'kept' : 'removed', '', '']);
  if (!seen) continue;
  keptNodes.push(n);
  flags.forEach((f, i) => f === 3 && (lmKeep[i] = 1));
}
landmarks.meshes = [compact(lmMesh, grow(lmMesh, lmKeep))];
report.push(['LAND_Pyramid (shared)', lmMesh.index.length / 3, landmarks.meshes[0].index.length / 3, lmMesh.attributes.POSITION.array.length / 3, landmarks.meshes[0].attributes.POSITION.array.length / 3]);
landmarks.json.nodes = keptNodes;
landmarks.json.scenes[0].nodes = keptNodes.map((_, i) => i);

console.log('\nmesh                       tris before -> after        verts before -> after');
for (const [name, a, b, c, d] of report) console.log(`${name.padEnd(26)} ${String(a).padStart(7)} -> ${String(b).padEnd(9)} ${String(c).padStart(12)} -> ${d}`);
for (const c of crops)
  console.log(`${c.file}: ${c.from.join('x')} -> ${c.to.join('x')} (rect ${c.rect.join(',')}, rolled ${c.rollPx} px) ${(c.before / 1e6).toFixed(1)} MB -> ${c.after ? (c.after / 1e6).toFixed(1) + ' MB' : '(dry run)'}`);

if (!DRY) {
  const mark = { trimWorld: { date: new Date().toISOString().slice(0, 10), cameras: cams.length, maxAspect: cfg.camera.maxAspect, exit: cfg.camera.exit, crops: crops.map(({ file, rect, rollPx }) => ({ file, rect, rollPx })) } };
  for (const [file, glb] of [[terrainFile, terrain], [landmarksFile, landmarks]]) {
    glb.json.asset.extras = { ...glb.json.asset.extras, ...mark };
    const before = glb.size;
    const after = writeGlb(file, glb);
    console.log(`${path.basename(file)}: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
  }
}
