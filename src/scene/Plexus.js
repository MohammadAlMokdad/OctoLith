// igloo.inc's hover plexus, drawn over everything (additive, no depth test):
//   markers  thin '+' on the pushed-out blocks nearest the mouse (at most 5),
//            turning into place as they appear
//   links    1 px lines to each marker's nearest markers (at most 2 each),
//            growing out of the marker that was there first
//   numbers  a 2-digit readout beside each marker: how far its block has
//            moved, metres x 50 (last two digits)
// At most one marker arrives and one leaves per frame (0.1 s in, 0.06 s out),
// which gives igloo's one-by-one build-up without lagging behind the cursor:
// the plexus follows the pointer itself, not the smoothed point the blocks
// follow. A marker only leaves while the cursor moves, so the plexus holds
// still when the cursor does.
// Runs once the live hero is fully on (both BlockMotion gates at 1).
import gsap from 'gsap';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

const toCamera = new Vector3();
const ref = new Vector3();
const out = new Vector3();
const tip = new Vector3();

export class Plexus {
  constructor(motion, cfg) {
    this.motion = motion;
    this.cfg = cfg.plexus;
    this.color = new Color(cfg.colors.plexus);
    this.active = []; // blocks that carry a marker (including ones fading out)
    this.lastRef = new Vector3(Infinity, 0, 0);
    for (const b of motion.blocks) {
      b.mark = { value: 0 }; // 0..1 appear progress
      b.leaving = false;
      b.links = [];
      b.ui = new Vector3(); // marker position: just outside the block
      b.dist = 0;
    }
    const c = this.cfg;
    this.maxSegments = Math.max(c.maxPoints * c.maxLinks, (c.maxPoints * (c.maxPoints - 1)) / 2);
    this.buildLines();
    this.buildMarkers();
    this.buildNumbers();
    this.visible = false;
  }

  // ---------------------------------------------------------------- build
  buildLines() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.maxSegments * 6), 3));
    this.lines = new LineSegments(
      geo,
      new LineBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: this.cfg.lineOpacity,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
  }

  buildMarkers() {
    const n = this.cfg.maxPoints;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aProgress', new BufferAttribute(new Float32Array(n), 1));
    this.markers = new Points(
      geo,
      new ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: this.color },
          uOpacity: { value: this.cfg.markerOpacity },
          uSize: { value: this.cfg.markerSize },
          uViewportH: { value: 1 }, // drawing-buffer height (px)
        },
        vertexShader: /* glsl */ `
          attribute float aProgress;
          uniform float uSize, uViewportH;
          varying float vProgress;
          void main() {
            vProgress = aProgress;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize * aProgress / length(mv.xyz) * (uViewportH / 1300.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vProgress;
          float aastep(float edge, float x) {
            float w = length(vec2(dFdx(x), dFdy(x))) * 0.70710678;
            return smoothstep(edge - w, edge + w, x);
          }
          void main() {
            if (vProgress < 0.001) discard;
            // A thin '+' that turns into place as it appears.
            float a = mix(1.3, 0.0, vProgress);
            vec2 p = gl_PointCoord - 0.5;
            p = vec2(cos(a) * p.x + sin(a) * p.y, cos(a) * p.y - sin(a) * p.x) * 2.0;
            float plus = 1.0 - aastep(0.125, abs(p.x)) * aastep(0.125, abs(p.y));
            gl_FragColor = vec4(uColor, plus * uOpacity);
          }`,
      }),
    );
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 1000;
  }

  // Two billboard quads per readout (tens, units), instanced per marker.
  buildNumbers() {
    const n = this.cfg.maxPoints;
    const geo = new InstancedBufferGeometry();
    const w = 0.7778 / 2; // digit cell aspect
    const pos = [];
    const uv = [];
    const side = [];
    const index = [];
    for (const [k, cx] of [
      [-1, -0.4],
      [1, 0.4],
    ]) {
      const o = pos.length / 3;
      pos.push(cx - w, -0.5, 0, cx + w, -0.5, 0, cx + w, 0.5, 0, cx - w, 0.5, 0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      side.push(k, k, k, k);
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    geo.setIndex(index);
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setAttribute('aSide', new Float32BufferAttribute(side, 1));
    geo.setAttribute('aPos', new InstancedBufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aProgress', new InstancedBufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('aDigits', new InstancedBufferAttribute(new Float32Array(n * 2), 2));
    geo.instanceCount = 0;
    this.digits = digitAtlas();
    this.numbers = new Mesh(
      geo,
      new ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uDigits: { value: this.digits },
          uColor: { value: this.color },
          uSize: { value: 0.1 }, // m, set on resize
        },
        vertexShader: /* glsl */ `
          attribute float aSide;
          attribute vec3 aPos;
          attribute float aProgress;
          attribute vec2 aDigits;
          uniform float uSize;
          varying vec2 vUv;
          varying float vDigit;
          void main() {
            vUv = uv;
            vDigit = aSide < 0.0 ? aDigits.x : aDigits.y;
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            // Beside the marker on the side away from the screen centre, a little up.
            vec4 clip = projectionMatrix * viewMatrix * vec4(aPos, 1.0);
            float outward = sign(clip.x / clip.w);
            float s = uSize * aProgress * aProgress;
            vec3 p = aPos + right * (position.x * s + outward * uSize * 1.75) + up * (position.y * s + uSize);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uDigits;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDigit;
          void main() {
            float a = texture2D(uDigits, vec2((floor(vDigit + 0.5) + vUv.x) / 10.0, vUv.y)).a;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.numbers.frustumCulled = false;
    this.numbers.renderOrder = 1001;
  }

  // ---------------------------------------------------------------- links
  // Link a new marker to its nearest markers that still have room.
  link(b) {
    this.unlink(b);
    const others = this.active.filter((o) => o !== b && !o.leaving);
    others.sort((x, y) => x.position.distanceTo(b.position) - y.position.distanceTo(b.position));
    for (const o of others) {
      if (b.links.length >= this.cfg.maxLinks) break;
      if (o.links.length < this.cfg.maxLinks && !o.links.includes(b)) {
        b.links.push(o);
        o.links.push(b);
      }
    }
    if (!b.links.length && others.length) {
      b.links.push(others[0]);
      others[0].links.push(b);
    }
  }

  // Drop a marker's links; any marker left without one joins its nearest.
  unlink(b) {
    for (const o of b.links) o.links = o.links.filter((x) => x !== b);
    b.links = [];
    for (const o of this.active) o.links = o.links.filter((x) => this.active.includes(x));
    if (this.active.length < 2) return;
    for (const o of this.active) {
      if (o.links.length || o.leaving) continue;
      let nearest = null;
      for (const x of this.active) {
        if (x !== o && !x.leaving && (!nearest || x.position.distanceTo(o.position) < nearest.position.distanceTo(o.position))) nearest = x;
      }
      if (!nearest) continue;
      o.links.push(nearest);
      nearest.links.push(o);
      gsap.to(o.mark, { value: 1, duration: this.cfg.inTime, ease: 'none', overwrite: true });
    }
  }

  reset() {
    for (const b of this.active) {
      gsap.killTweensOf(b.mark);
      b.mark.value = 0;
      b.leaving = false;
      b.links = [];
    }
    this.active = [];
  }

  // ---------------------------------------------------------------- module API
  objects() {
    return [this.lines, this.markers, this.numbers];
  }

  set visible(v) {
    this.lines.visible = this.markers.visible = this.numbers.visible = v;
  }

  update(time, dt, scene) {
    const m = this.motion;
    const c = this.cfg;
    const on = m.pulse >= 1 && m.hover >= 1;
    this.visible = on;
    if (!on) {
      if (this.active.length) this.reset();
      return;
    }

    // Reference point: where the pointer is now (not the smoothed point the
    // blocks follow, so the plexus keeps up with the cursor), pulled 1 m
    // toward the camera.
    toCamera.copy(scene.camera.position).sub(m.pointerPoint).normalize();
    ref.copy(m.pointerPoint).addScaledVector(toCamera, 1);
    const moved = this.lastRef.distanceTo(ref) > 0.05;
    if (moved) this.lastRef.copy(ref);

    // Candidates: blocks moving out, or about to (their target push counts, so
    // a marker doesn't wait for the block's smoothing).
    for (const b of m.blocks) b.dist = b.position.distanceTo(ref);
    const near = m.blocks
      .filter((b) => Math.max(b.push, b.target) > c.minPush)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, c.maxPoints)
      .filter((b) => b.dist < c.reach);
    this.active.sort((a, b) => a.dist - b.dist);

    // At most one marker leaves and one arrives per frame. A marker only
    // leaves while the cursor moves: the farthest one that is no longer a
    // candidate...
    if (moved) {
      const b = [...this.active].reverse().find((x) => !x.leaving && !near.includes(x));
      if (b) {
        b.leaving = true;
        gsap.to(b.mark, {
          value: 0,
          duration: c.outTime,
          ease: 'none',
          overwrite: true,
          onComplete: () => {
            b.leaving = false;
            const k = this.active.indexOf(b);
            if (k >= 0) this.active.splice(k, 1);
            this.unlink(b);
          },
        });
      }
    }
    // ...and the nearest newcomer arrives.
    if (this.active.length < c.maxPoints) {
      const b = near.find((x) => !this.active.includes(x));
      if (b) {
        this.active.push(b);
        this.link(b);
        gsap.to(b.mark, { value: 1, duration: c.inTime, ease: 'none', overwrite: true });
      }
    }

    for (const b of this.active) b.ui.copy(b.position).addScaledVector(out.copy(b.centroid).normalize(), 0.2);
    this.writeLines();
    this.writeMarkers();
    this.writeNumbers();
  }

  // Each linked pair once, from the marker that is further in toward the other.
  writeLines() {
    const arr = this.lines.geometry.attributes.position.array;
    const seen = new Set();
    let n = 0;
    for (const f of this.active) {
      for (const o of f.links) {
        const key = Math.min(f.id, o.id) * 4096 + Math.max(f.id, o.id);
        if (seen.has(key) || n >= this.maxSegments) continue;
        seen.add(key);
        const from = f.mark.value >= o.mark.value ? f : o;
        const to = from === f ? o : f;
        tip.copy(from.ui).lerp(to.ui, to.mark.value);
        from.ui.toArray(arr, n * 6);
        tip.toArray(arr, n * 6 + 3);
        n++;
      }
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  writeMarkers() {
    const { position, aProgress } = this.markers.geometry.attributes;
    for (let i = 0; i < this.cfg.maxPoints; i++) {
      const b = this.active[i];
      if (b) b.ui.toArray(position.array, i * 3);
      aProgress.array[i] = b ? b.mark.value : 0;
    }
    position.needsUpdate = aProgress.needsUpdate = true;
  }

  writeNumbers() {
    const geo = this.numbers.geometry;
    const { aPos, aProgress, aDigits } = geo.attributes;
    const n = Math.min(this.active.length, this.cfg.maxPoints);
    for (let i = 0; i < n; i++) {
      const b = this.active[i];
      b.ui.toArray(aPos.array, i * 3);
      aProgress.array[i] = b.mark.value;
      const moved = String(Math.floor(b.centroid.distanceTo(b.position) * 50)).slice(-2).padStart(2, '0');
      aDigits.array[i * 2] = +moved[0];
      aDigits.array[i * 2 + 1] = +moved[1];
    }
    geo.instanceCount = n;
    aPos.needsUpdate = aProgress.needsUpdate = aDigits.needsUpdate = true;
  }

  resize(w, h, dpr) {
    this.markers.material.uniforms.uViewportH.value = h * dpr;
    this.numbers.material.uniforms.uSize.value = Math.min(0.1, this.cfg.numberSize / (h / 1300));
  }

  dispose() {
    this.reset();
    for (const o of this.objects()) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.digits.dispose();
  }
}

// White digits 0-9 in one row, drawn with the UI font (redrawn once it loads).
function digitAtlas() {
  const cw = 56;
  const ch = 72; // cell aspect ~0.78, like the number quads
  const canvas = document.createElement('canvas');
  canvas.width = cw * 10;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  const draw = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#fff';
    g.font = `500 ${Math.round(ch * 0.92)}px "IBM Plex Mono", ui-monospace, Consolas, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = 0; d < 10; d++) g.fillText(String(d), cw * (d + 0.5), ch * 0.54);
    texture.needsUpdate = true;
  };
  draw();
  document.fonts?.load('500 64px "IBM Plex Mono"').then(draw, () => {});
  return texture;
}
