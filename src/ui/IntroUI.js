// Phase G: corner UI, igloo-style. Each [data-ui] block appears in turn: its
// [data-scramble] texts type themselves in (src/ui/scrambleText.js, igloo's
// text show) and the logo flickers in through its block glitch
// (src/ui/glitch.js). The copy is read from the DOM, so it lives in
// index.html. Hovers replay them like igloo's do:
//   logo          the glitch again (0.25 s), and the copyright lines under it
//                 blink (5 hard steps in 0.1 s, the rights 0.1 s later);
//   sound toggle  its text types itself in again (0.2 s / 0.375 s), the
//                 state a beat later, and the speaker flickers.
// finishAll() shows everything immediately (skip / reduced motion). Under
// reduced motion the hovers do nothing.
// When the hero comes back on screen after being scrolled away (back up from
// section 2, or round the loop), its corner texts type themselves in again,
// like igloo's (StormTransition fires 'octo:hero-return').
import { scrambleText, replayText } from './scrambleText.js';
import { glitch, blink, flicker } from './glitch.js';
import { pacedPhases } from '../config/introConfig.js';
import { sfx } from '../audio/sfx.js';

// Mouse / pen hover (igloo's hover_in); taps don't count.
export function onHover(el, fn) {
  el?.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && fn(e));
}

export class IntroUI {
  constructor(root, cfg) {
    this.cfg = cfg;
    this.blocks = [...root.querySelectorAll('[data-ui]')];
    this.jobs = [];
    this.tweens = [];
    this.finalText = new Map();
    for (const el of root.querySelectorAll('[data-scramble]')) {
      this.finalText.set(el, el.textContent.replace(/\s+/g, ' ').trim());
    }
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.logo = root.querySelector('.logo');
    this.copyright = root.querySelector('[data-copyright]');
    this.rights = root.querySelector('[data-rights]');
    this.soundOn = false;
    const toggle = root.querySelector('#sound-toggle');
    this.toggle = toggle;
    this.onSoundToggle = null; // the sound system's toggle (main.js); it calls setSound back
    this.onSoundShown = null; // (instant) => {}: the toggle has come in (main.js: the volume tip beside it)
    toggle?.addEventListener('click', () => this.toggleSound());
    onHover(this.logo, () => this.hoverLogo());
    onHover(toggle, () => {
      if (!this.shown(toggle)) return;
      this.showSound(0.5);
      sfx('ui-long');
    });
    this.corners = [...root.querySelectorAll('.corner--tl [data-scramble], .corner--tr [data-scramble], .scroll-hint [data-scramble]')];
    window.addEventListener('octo:hero-return', () => this.replayCorners());
  }

  // igloo's hero texts shown again (hasBeenShownOnce): 0.15 s apart, the first
  // 0.4 / 0.75 s, the rest 1.75x longer.
  replayCorners() {
    if (this.reduced) return;
    sfx('manifesto');
    this.corners.forEach((el, k) => {
      const m = k ? 1.75 : 1;
      scrambleText(el, this.finalText.get(el), { delay: k * 150, sweep: 0.4 * m, settle: 0.75 * m });
    });
  }

  shown(el) {
    return !this.reduced && !!el?.closest('[data-ui]')?.classList.contains('is-shown');
  }

  // Reveal block i (in document order).
  reveal(i, { instant = false } = {}) {
    const block = this.blocks[i];
    if (!block || block.classList.contains('is-shown')) return;
    block.classList.add('is-shown');
    if (block === this.logo) {
      if (!instant) this.tweens.push(glitch(block, { duration: 0.5 })); // igloo: show(0.5)
      if (!instant) sfx('logo');
      return;
    }
    // igloo's cues: its manifesto types in to a teletype, its message to a breath
    if (!instant) sfx(block.classList.contains('manifesto') ? 'manifesto' : block.contains(this.toggle) ? 'ui-short' : null);
    const targets = block.matches('[data-scramble]') ? [block] : [...block.querySelectorAll('[data-scramble]')];
    targets.forEach((el, k) => {
      const text = this.finalText.get(el);
      if (instant) {
        el.textContent = text;
        return;
      }
      // igloo: the first text of a group 0.4 / 0.75 s, the rest 1.75x longer, 0.2 s apart
      const m = k ? 1.75 : 1;
      this.jobs.push(scrambleText(el, text, { delay: k * 200, sweep: 0.4 * m, settle: 0.75 * m }));
    });
    if (block.contains(this.toggle) && !instant) this.tweens.push(flicker(this.toggle.querySelector('.sound__icon'), { duration: 0.5 }));
    if (block.contains(this.toggle)) this.onSoundShown?.(instant);
  }

  // Instantly show the blocks that would be visible at timeline time t.
  syncTo(t) {
    const start = pacedPhases(this.cfg).ui.start;
    const stagger = this.cfg.ui.stagger * (this.cfg.pace ?? 1);
    this.blocks.forEach((_, i) => {
      if (t >= start + i * stagger) this.reveal(i, { instant: true });
    });
  }

  finishAll() {
    this.blocks.forEach((_, i) => this.reveal(i, { instant: true }));
    for (const job of this.jobs) job.finish();
    for (const tween of this.tweens) tween?.progress(1);
  }

  hoverLogo() {
    if (!this.shown(this.logo)) return;
    sfx('logo');
    glitch(this.logo, { duration: 0.25 });
    blink(this.copyright, { low: 0.3 });
    blink(this.rights, { low: 0.6, delay: 0.1 });
  }

  // igloo's sound text show(e): "Sound:" 0.4e / 0.75e s, the state 0.1 s
  // later, the speaker flickering over 0.5e s.
  showSound(e = 1) {
    const [label, state] = this.toggle.querySelectorAll('[data-scramble]');
    replayText(label, { sweep: 0.4 * e, settle: 0.75 * e });
    replayText(state, { sweep: 0.4 * e, settle: 0.75 * e, delay: 100 });
    flicker(this.toggle.querySelector('.sound__icon'), { duration: 0.5 * e });
  }

  toggleSound() {
    if (this.onSoundToggle) this.onSoundToggle();
    else this.setSound(!this.soundOn);
  }

  // Show the sound state (the sound system calls this: it also comes on by
  // itself at the first click, tap or key).
  setSound(on) {
    if (on === this.soundOn) return;
    this.soundOn = on;
    this.toggle.setAttribute('aria-pressed', String(this.soundOn));
    const [label, state] = this.toggle.querySelectorAll('[data-scramble]');
    const text = this.soundOn ? this.cfg.copy.soundOn : this.cfg.copy.soundOff;
    this.finalText.set(state, text);
    if (this.reduced) {
      state.textContent = text;
      return;
    }
    // igloo: show(0.2) on click
    replayText(label, { sweep: 0.08, settle: 0.15 });
    scrambleText(state, text, { sweep: 0.08, settle: 0.15, delay: 100 });
    flicker(this.toggle.querySelector('.sound__icon'), { duration: 0.1 });
  }
}
