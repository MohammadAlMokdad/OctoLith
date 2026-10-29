// Section 4's links (igloo's footer UI), on screen while section 3's progress
// is between 0.64 and 0.9 (the room):
//   - two arrows beside the sculpture (WebGL lines hung off it, igloo's: a
//     stroke with a barb, blinking on); hovering one blinks it again
//   - at the bottom, the current link's title in a bracket box (the box opens
//     the link) with its neighbours faded out to either side (DOM, in
//     index.html #room-links: edit the titles, urls and shapes there)
//   - a click on the left / right half of the screen, the arrow keys, or a
//     fast horizontal swipe changes the link: the sculpture bursts and
//     re-forms as the next shape, the floor whirls, the titles scramble in.
import gsap from 'gsap';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  ShaderMaterial,
  Vector2,
} from 'three';
import { scrambleText, textOf } from '../ui/scrambleText.js';
import { glitch } from '../ui/glitch.js';
import { sfx } from '../audio/sfx.js';

const ON = [0.64, 0.9]; // section 3's progress window
const ARROW = 0.065; // m
const BOX_GLITCH = { amount: 0.025, rows: [0.25, 0.5], self: true };

// The links in #room-links: [{ el, shape, scale }]. Without them the
// sculpture still has a shape.
export function readLinks(root) {
  const links = [...(root?.querySelectorAll('[data-link]') ?? [])].map((el) => ({
    el,
    shape: el.dataset.shape,
    scale: parseFloat(el.dataset.scale) || 1.25,
  }));
  return links.length ? links : [{ el: null, shape: 'octopus', scale: 1.25 }];
}

function arrowsMesh(color) {
  // a stroke with a barb at its outer end, each side (igloo's 4 segments)
  const s = ARROW;
  const pos = [0, 0, 0, -s, 0, 0, -s, 0, 0, -s * 0.8, s * 0.2, 0, 0, 0, 0, s, 0, 0, s, 0, 0, s * 0.8, s * 0.2, 0];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('side', new BufferAttribute(new Float32Array([-1, -1, -1, -1, 1, 1, 1, 1]), 1));
  const m = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uWidth: { value: 0.3 },
      uScale: { value: 1 },
      uOpacity1: { value: 0 }, // side -1: the screen's right (the room's camera looks along +z)
      uOpacity2: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float side;
      uniform float uWidth, uScale, uOpacity1, uOpacity2;
      varying float vOpacity;
      void main() {
        vOpacity = mix(uOpacity1, uOpacity2, side * 0.5 + 0.5);
        vec3 p = position * uScale + vec3(side * uWidth, 0.0, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        // while it comes on it blinks: three hard on/off steps
        float o = vOpacity < 1.0 ? floor(mod(vOpacity * 6.0, 2.0)) : vOpacity;
        gl_FragColor = vec4(uColor * o, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new LineSegments(g, m);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  return mesh;
}

export class RoomLinks {
  // root: #room-links; links: readLinks(root); camera: the rings' camera;
  // onChange(dir): a link changed (the floor whirls). sculpture: the
  // ParticleSculpture, now or later via attach() (the links work without it).
  constructor(root, { links, sculpture = null, camera, color, onChange }) {
    this.root = root;
    this.links = links;
    this.sculpture = null;
    this.camera = camera;
    this.onChange = onChange;
    this.enabled = false;
    this.current = 0;
    this.hovered = null;
    this.raycaster = new Raycaster();
    this.ndc = new Vector2();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.arrows = arrowsMesh(color);
    const hit = new PlaneGeometry(ARROW, ARROW).rotateY(Math.PI);
    const hitMat = new MeshBasicMaterial({ side: DoubleSide });
    this.hitRight = new Mesh(hit.clone().translate(-ARROW / 2, 0, 0), hitMat);
    this.hitLeft = new Mesh(hit.clone().translate(ARROW / 2, 0, 0), hitMat);
    for (const [m, name] of [[this.hitRight, 'right'], [this.hitLeft, 'left']]) {
      m.visible = false;
      m.userData.arrow = name;
    }
    if (sculpture) this.attach(sculpture);

    this.frame = root?.querySelector('.room-links__frame') ?? null;
    if (root) root.inert = true;
    this.listeners = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.listeners.push(() => el.removeEventListener(type, fn, opts));
    };
    on(window, 'click', (e) => this.onClick(e));
    on(window, 'keydown', (e) => {
      if (!this.enabled || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') this.step(1);
      else if (e.key === 'ArrowLeft') this.step(-1);
    });
    on(window, 'touchstart', (e) => {
      const t = e.touches[0];
      this.touch = t ? { x: t.clientX, y: t.clientY, t: performance.now() } : null;
    }, { passive: true });
    // A swipe: clearly sideways and not a crawl. igloo wants 100 px at
    // 1000 px/s, a flick most people never make on a phone (the page only
    // pans vertically, so sideways moves all reach here).
    on(window, 'touchend', (e) => {
      const t = e.changedTouches[0];
      if (!this.enabled || !this.touch || !t) return;
      const dx = t.clientX - this.touch.x;
      const dy = t.clientY - this.touch.y;
      const v = (dx / Math.max(1, performance.now() - this.touch.t)) * 1000;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy) && Math.abs(v) > 250) this.step(dx < 0 ? -1 : 1); // igloo's way round
      this.touch = null;
    }, { passive: true });
    // hovering the box: it glitches and the title scrambles in again (igloo)
    if (root) on(root, 'pointerover', (e) => {
      if (!this.enabled || this.reduced || e.pointerType === 'touch') return;
      const a = e.target.closest?.('[data-pos="0"]');
      if (a && !a.contains(e.relatedTarget)) {
        sfx('ui-long');
        glitch(this.frame, { ...BOX_GLITCH, duration: 0.225 });
        this.showTitles(this.current, 0.7);
      }
    });
    this.layout();
  }

  // The sculpture has loaded: the arrows hang off it and it shows the current link.
  attach(sculpture) {
    this.sculpture = sculpture;
    sculpture.group.add(this.arrows, this.hitLeft, this.hitRight);
    if (this.current) sculpture.setLink(this.current);
  }

  // A click on the left or right half (not on a link, button or the debug GUI).
  onClick(e) {
    if (!this.enabled) return;
    if (e.target.closest?.('a, button, input, select, textarea, label, .lil-gui')) return;
    this.step(e.clientX < window.innerWidth / 2 ? -1 : 1);
  }

  step(dir) {
    const n = this.links.length;
    this.go((this.current + dir + n) % n, dir);
  }

  go(i, dir) {
    this.current = i;
    this.sculpture?.setLink(i);
    this.showArrow(dir === 1 ? 'right' : 'left', 0.75);
    this.layout();
    this.showTitles('all', 1);
    sfx('ui-long');
    this.onChange?.(dir);
  }

  // Each title's place: the current one in the box, its neighbours either side.
  layout() {
    const n = this.links.length;
    const c = this.current;
    this.links.forEach(({ el }, i) => {
      if (!el) return;
      const pos = i === c ? 0 : i === (c + 1) % n ? 1 : i === (c - 1 + n) % n ? -1 : null;
      if (pos === null) el.removeAttribute('data-pos');
      else el.dataset.pos = pos;
      if (pos === 0) el.removeAttribute('tabindex');
      else el.tabIndex = -1;
    });
  }

  // igloo's text show: all titles, or one (faster, x scale).
  showTitles(which, scale = 1) {
    if (this.reduced) return;
    this.links.forEach(({ el }, i) => {
      const t = el?.querySelector('[data-scramble]');
      if (!t || (which !== 'all' && which !== i)) return;
      scrambleText(t, textOf(t), { sweep: 0.4 * scale, settle: 0.75 * scale });
    });
  }

  showArrow(which = 'both', scale = 1) {
    const u = this.arrows.material.uniforms;
    if (which !== 'left') gsap.fromTo(u.uOpacity1, { value: 0 }, { value: 1, duration: 0.2 * scale, ease: 'none', overwrite: true });
    if (which !== 'right') gsap.fromTo(u.uOpacity2, { value: 0 }, { value: 1, duration: 0.2 * scale, ease: 'none', overwrite: true });
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.showArrow('both');
    sfx('ui-long');
    if (this.root) {
      this.root.inert = false;
      this.root.classList.add('is-on');
      if (!this.reduced) glitch(this.frame, { ...BOX_GLITCH, duration: 0.3 });
    }
    this.showTitles('all', 1);
  }

  // p: section 3's progress, when it's scrolled away (igloo sounds the UI
  // going only on the way back up, above the room's rest at 0.76)
  disable(p) {
    if (!this.enabled) return;
    this.enabled = false;
    if (p < 0.76) sfx('ui-long');
    const u = this.arrows.material.uniforms;
    gsap.to([u.uOpacity1, u.uOpacity2], { value: 0, duration: 0.1, ease: 'none', overwrite: true });
    this.setHover(null);
    if (this.root) {
      this.root.classList.remove('is-on');
      this.root.inert = true;
      if (this.root.contains(document.activeElement)) document.activeElement.blur();
    }
  }

  setHover(name) {
    if (name === this.hovered) return;
    this.hovered = name;
    document.documentElement.classList.toggle('is-pointer', !!name);
    if (name) {
      this.showArrow(name, 0.75);
      sfx('logo');
    }
  }

  // Every frame section 3 is on screen. p: its progress; pointer: { ndc, active }.
  update(p, pointer) {
    if (p > ON[0] && p < ON[1]) this.enable();
    else this.disable(p);
    // portrait screens: the arrows closer in and smaller (igloo)
    const portrait = window.innerWidth < window.innerHeight;
    const u = this.arrows.material.uniforms;
    u.uWidth.value = portrait ? 0.175 : 0.3;
    u.uScale.value = portrait ? 0.75 : 1;
    const x = portrait ? 0.185 : 0.3;
    this.hitLeft.position.x = x;
    this.hitRight.position.x = -x;
    if (!this.enabled || !pointer?.active || !this.sculpture) return this.setHover(null);
    this.ndc.copy(pointer.ndc);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects([this.hitLeft, this.hitRight], false)[0];
    this.setHover(hit?.object.userData.arrow ?? null);
  }

  dispose() {
    this.disable();
    for (const off of this.listeners) off();
    this.arrows.geometry.dispose();
    this.arrows.material.dispose();
    this.hitLeft.geometry.dispose();
    this.hitRight.geometry.dispose();
    this.hitLeft.material.dispose();
  }
}
