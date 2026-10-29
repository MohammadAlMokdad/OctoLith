// "Click to explore" (igloo's project pages): clicking the centred crystal,
// or its CLICK TO EXPLORE label, opens that relic's page with igloo's own
// choreography and timings (cfg.vault.detail):
//   open   the labels go; the camera rushes into the crystal (power3.in) as
//          the picture dissolves into the relic's dark chamber (VaultScene's
//          output pass: detail.p power3.in, then detail.p2 sine.out from
//          +0.75 s); the chamber's camera dollies in; the summary scrambles
//          in line by line.
//   close  (Close, Escape) the text fades, everything plays back out
//          (power2.out / power3.out) and the labels scramble back in.
// The page scroll is locked while a relic's page is open; its text panel
// scrolls on its own. Browser Back closes it too (open pushes a history
// entry; the URL doesn't change), and Tab stays inside it (aria-modal).
// Hovers replay igloo's animations: the Close box
// glitches (0.25 s) and its text types in again; a link types in again. And
// moving the pointer over the page's text lights it up and scrambles it in a
// spreading ring (src/ui/TextTrail.js, igloo's project-page mouse sim).
import gsap from 'gsap';
import { scrambleText, replayText } from '../ui/scrambleText.js';
import { glitch } from '../ui/glitch.js';
import { onHover } from '../ui/IntroUI.js';
import { TextTrail } from '../ui/TextTrail.js';
import { sfx } from '../audio/sfx.js';

// igloo's Close box: bigger blocks, shifted up to 2.5 % of its width
const CLOSE_GLITCH = { amount: 0.025, rows: [0.25, 0.5], self: true };

export class VaultDetail {
  constructor(cfg, { vault, transition, hud, root }) {
    this.cfg = cfg;
    this.d = cfg.vault.detail;
    this.vault = vault;
    this.transition = transition;
    this.hud = hud;
    this.root = root;
    this.items = [...root.querySelectorAll('.relic-page__item')];
    this.closeButton = root.querySelector('[data-close]');
    this.closeFrame = root.querySelector('.relic-page__frame');
    this.closeLabel = this.closeButton.querySelector('[data-scramble]');
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.trail = new TextTrail(root.querySelector('.relic-page__panel'), this.d.trail, cfg.colors.pageLit);
    this.isOpen = false;
    this.index = -1;
    this.listeners = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.listeners.push(() => el.removeEventListener(type, fn, opts));
    };
    on(window, 'click', (e) => this.onClick(e));
    on(window, 'pointermove', (e) => this.onHover(e), { passive: true });
    on(window, 'keydown', (e) => e.key === 'Escape' && this.isOpen && this.close());
    on(this.closeButton, 'click', (e) => {
      e.stopPropagation();
      this.close();
    });
    for (const b of document.querySelectorAll('[data-explore]')) {
      on(b, 'click', (e) => {
        e.stopPropagation();
        this.open(Number(b.dataset.explore), b, e.detail === 0); // detail 0: Enter / Space
      });
      // CLICK TO EXPLORE types itself in again, like igloo's links
      const cta = b.querySelectorAll('[data-scramble]');
      onHover(b, () => !this.reduced && cta.length && replayText(cta[cta.length - 1], { sweep: 0.2, settle: 0.375 }));
    }
    this.closeText = this.closeButton.textContent.trim();
    // igloo: hovering Close replays its show(0.25)
    onHover(this.closeButton, () => {
      if (this.root.classList.contains('is-open')) sfx('ui-long');
      if (this.reduced || !this.root.classList.contains('is-open')) return;
      glitch(this.closeFrame, { ...CLOSE_GLITCH, duration: 0.25 });
      replayText(this.closeLabel, { sweep: 0.2, settle: 0.4 });
    });
    // igloo: hovering a link replays its show(0.5); the trail keeps driving it
    for (const a of root.querySelectorAll('.relic-page__links a')) {
      onHover(a, () => {
        if (this.root.classList.contains('is-open')) sfx('ui-short');
        if (this.reduced || !this.root.classList.contains('is-open')) return;
        this.trail.retrack(replayText(a.querySelector('[data-line]'), { keep: true, steps: this.d.trail.steps }));
      });
    }
  }

  // Section 2 on screen and (nearly) clear of the storm. Like igloo, the
  // crystal doesn't need to be centred: see inRange().
  canOpen() {
    return !this.isOpen && this.vault.ready && this.transition.wall >= 0.8;
  }

  // How far crystal i is from the centre (screens of scroll), from what the
  // scene shows.
  offset(i) {
    return i - (this.transition.progress - this.transition.vaultStart);
  }

  inRange(i) {
    return Math.abs(this.offset(i)) < this.d.clickRange;
  }

  // The crystal under the pointer (any crystal close enough to the centre), or -1.
  crystalAt(e) {
    const [w, h] = this.vault.size ?? [innerWidth, innerHeight]; // the canvas (taller than the window on phones)
    const ndc = { x: (e.clientX / w) * 2 - 1, y: -(e.clientY / h) * 2 + 1 };
    const crystals = this.vault.crystals;
    for (let i = 0; i < crystals.length; i++) {
      if (!this.inRange(i) || !crystals[i].group.visible) continue;
      const ray = crystals[i].frost.raycaster;
      ray.setFromCamera(ndc, this.vault.camera);
      if (ray.intersectObject(crystals[i].crystal, false).length) return i;
    }
    return -1;
  }

  onHover(e) {
    if (!this.canOpen()) {
      if (this.hovering) document.body.style.cursor = this.hovering = '';
      return;
    }
    const over = this.crystalAt(e) >= 0;
    if (over !== !!this.hovering) document.body.style.cursor = this.hovering = over ? 'pointer' : '';
  }

  onClick(e) {
    if (!this.canOpen() || e.target.closest?.('a, button, .lil-gui')) return;
    const i = this.crystalAt(e);
    if (i >= 0) this.open(i);
  }

  // keyboard: opened from the keyboard (focus rings stay visible).
  open(i, returnFocus = null, keyboard = false) {
    if (!this.canOpen() || !this.items[i] || !this.inRange(i)) return;
    this.isOpen = true;
    this.index = i;
    this.returnFocus = returnFocus;
    this.keyboard = keyboard;
    document.body.style.cursor = this.hovering = '';
    this.transition.lock(true);
    this.hud.suppressed = true;
    this.vault.brush = false;
    // igloo's centerDetailScene: glide the crystal to the centre (longer the
    // further it is, up to cfg centring s) and start opening half-way through.
    const n = Math.abs(this.offset(i));
    const k = Math.min(1, Math.max(0, 0.05 + (n / 0.2) * 0.95));
    const glide = (1 - 2 ** (-10 * k)) * this.d.centring; // expo.out
    this.transition.glideTo(this.transition.vaultStart + i, glide);
    sfx('click-project');
    this.startCall?.kill();
    this.startCall = gsap.delayedCall(glide * 0.5, () => this.whenSectionAlone(() => this.play(i)));
  }

  // The dissolve lives in section 2's own output: wait until the storm (if the
  // click came while it was finishing) has handed over.
  whenSectionAlone(fn) {
    if (this.transition.heroHidden) return fn();
    const tick = () => {
      if (!this.transition.heroHidden || !this.isOpen) return;
      gsap.ticker.remove(tick);
      fn();
    };
    gsap.ticker.add(tick);
  }

  play(i) {
    if (!this.isOpen || this.closing) return;
    const v = this.vault;
    const page = v.page;
    const d = this.d;
    page.show(i);
    sfx('enter-project');
    gsap.killTweensOf([v.detail, v.zoom, v.wobbleAmount, page.dolly, page.wobble]);
    page.dolly.z = d.camera.from;
    page.wobble.value = 0;
    // igloo: navigateToSection (project) + cubes.detailAnimationIn + detail.playInAnimation
    gsap.to(v.detail, { p: 1, duration: d.open.dissolve, ease: 'power3.in' });
    gsap.to(v.detail, { p2: 1, duration: d.open.settle, delay: d.open.settleDelay, ease: 'sine.out' });
    gsap.to(v.zoom, { value: d.zoom, duration: d.open.dissolve, ease: 'power3.in' });
    gsap.to(v.wobbleAmount, { value: 0, duration: 1, ease: 'power1.in' });
    gsap.to(page.dolly, { z: d.camera.to, duration: 2, delay: 0.5, ease: 'power1.inOut' });
    gsap.to(page.wobble, { value: 1, duration: 1, delay: 1.5, ease: 'power1.out' });
    this.textCall?.kill();
    this.textCall = gsap.delayedCall(1.2, () => this.showText(i));
  }

  close() {
    if (!this.isOpen || this.closing) return;
    this.closing = true;
    sfx('leave-project');
    this.startCall?.kill();
    this.textCall?.kill();
    this.hideText();
    const v = this.vault;
    const page = v.page;
    const d = this.d;
    gsap.killTweensOf([v.detail, v.zoom, v.wobbleAmount, page.dolly, page.wobble]);
    // igloo: navigateToSection (home) + cubes.detailAnimationOut + detail.playOutAnimation
    gsap.to(v.detail, { p: 0, duration: d.close.dissolve, ease: 'power2.out' });
    gsap.to(v.detail, { p2: 0, duration: d.close.settle, ease: 'power2.out' });
    gsap.to(v.zoom, { value: 0, duration: d.close.zoom, ease: 'power3.out' });
    gsap.to(v.wobbleAmount, { value: 1, duration: d.close.zoom, ease: 'power2.out' });
    gsap.to(page.dolly, { z: d.camera.from, duration: 0.6, ease: 'none' });
    gsap.to(page.wobble, { value: 0, duration: 0.6, ease: 'power1.in' });
    gsap.delayedCall(1, () => {
      this.isOpen = false;
      this.closing = false;
      this.transition.lock(false);
      this.hud.suppressed = false;
      this.vault.brush = true;
      this.returnFocus?.focus({ preventScroll: true });
    });
  }

  // The page's text scrambles in line by line (igloo's project text), the
  // Close button with it.
  showText(i) {
    this.items.forEach((el, k) => el.classList.toggle('is-current', k === i));
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => this.root.classList.add('is-open'));
    const item = this.items[i];
    sfx('project-text');
    item.scrollTop = 0;
    item.parentElement.scrollTop = 0;
    const lines = [...item.querySelectorAll('[data-line]')];
    const jobs = lines.map((el, k) => {
      el.dataset.text ??= el.textContent;
      // igloo's text show; paragraphs 1.75x longer. The letters stay
      // separate afterwards for the pointer trail.
      const m = el.dataset.text.length > 40 ? 1.75 : 1;
      const opts = { delay: k * 90, sweep: 0.4 * m, settle: 0.75 * m, keep: true, steps: this.d.trail.steps };
      return scrambleText(el, el.dataset.text, opts);
    });
    if (!this.reduced) this.trail.start(jobs);
    // igloo's Close: show(0.5, 0.2), the box glitching in, its text with it
    if (!this.reduced) glitch(this.closeFrame, { ...CLOSE_GLITCH, duration: 0.5, delay: 0.2 });
    scrambleText(this.closeLabel, this.closeText, { delay: 200, sweep: 0.2, settle: 0.4 });
    // into the dialog; the ring only shows when it was opened from the keyboard
    this.closeButton.focus({ preventScroll: true, focusVisible: this.keyboard });
  }

  hideText() {
    this.trail.stop();
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    gsap.delayedCall(0.35, () => {
      if (!this.root.classList.contains('is-open')) this.root.hidden = true;
    });
  }

  dispose() {
    for (const off of this.listeners) off();
  }
}
