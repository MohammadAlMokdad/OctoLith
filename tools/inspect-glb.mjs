#!/usr/bin/env node
// Print the structure of a GLB: nodes, meshes, primitive modes, attributes.
// With --check-centr, verifies that each vertex's _CENTR attribute is the
// centroid of its block (same _BLOCKID) in the same (Y-up) space as POSITION.
//
// Usage: node tools/inspect-glb.mjs <file.glb> [--check-centr]
import fs from 'node:fs';

const [, , file, flag] = process.argv;
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;

const MODES = ['POINTS', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'TRIANGLES'];
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function read(accIndex) {
  const acc = gltf.accessors[accIndex];
  const view = gltf.bufferViews[acc.bufferView];
  const n = SIZES[acc.type];
  const stride = view.byteStride ?? n * 4;
  const out = new Float32Array(acc.count * n);
  const base = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      out[i * n + c] = buf.readFloatLE(base + i * stride + c * 4);
    }
  }
  return out;
}

console.log(`${file}  ${(buf.length / 1024).toFixed(0)} KB`);
for (const node of gltf.nodes ?? []) {
  if (node.mesh === undefined) continue;
  const mesh = gltf.meshes[node.mesh];
  const t = node.translation ? ` t=[${node.translation.map((v) => v.toFixed(1))}]` : '';
  const s = node.scale ? ` s=${node.scale[0].toFixed(2)}` : '';
  console.log(`  node ${node.name} -> mesh#${node.mesh} ${mesh.name}${t}${s}`);
}
gltf.meshes.forEach((mesh, mi) => {
  mesh.primitives.forEach((p) => {
    const count = gltf.accessors[p.attributes.POSITION].count;
    const idx = p.indices !== undefined ? gltf.accessors[p.indices].count : 0;
    console.log(`  mesh#${mi} ${mesh.name} ${MODES[p.mode ?? 4]} verts=${count} indices=${idx}`);
    console.log(`    attrs: ${Object.keys(p.attributes).join(', ')}`);
  });
});

if (flag === '--check-centr') {
  for (const mesh of gltf.meshes) {
    for (const p of mesh.primitives) {
      if (!('_CENTR' in p.attributes) || !('_BLOCKID' in p.attributes)) continue;
      const pos = read(p.attributes.POSITION);
      const centr = read(p.attributes._CENTR);
      const ids = read(p.attributes._BLOCKID);
      // Compare against each block's bounding-box centre: glTF splits vertices
      // along sharp edges, which skews a plain vertex average.
      const boxes = new Map();
      for (let i = 0; i < ids.length; i++) {
        const b = boxes.get(ids[i]) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 3; c++) {
          b[c] = Math.min(b[c], pos[i * 3 + c]);
          b[c + 3] = Math.max(b[c + 3], pos[i * 3 + c]);
        }
        boxes.set(ids[i], b);
      }
      const maxErr = [0, 0, 0];
      for (let i = 0; i < ids.length; i++) {
        const b = boxes.get(ids[i]);
        for (let c = 0; c < 3; c++) {
          maxErr[c] = Math.max(maxErr[c], Math.abs((b[c] + b[c + 3]) / 2 - centr[i * 3 + c]));
        }
      }
      // Up to ~1 cm is expected from per-corner jitter; a swapped axis shows up as metres.
      const errs = maxErr.map((e) => e.toFixed(4)).join(', ');
      console.log(`  ${mesh.name}: blocks=${boxes.size} max |bbox centre - _CENTR| (x,y,z) = ${errs} m`);
    }
  }
}
