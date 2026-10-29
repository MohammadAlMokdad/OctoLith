// The volumes: right-click the sound toggle (hold a finger on it on a touch
// screen, or press the menu key / Shift+F10 on it) and a box opens over it
// with two sliders, the effects and the music (Sound.setVolume). The levels
// are kept on this device. Esc, the same gesture again or a click anywhere
// else closes it, and that click does nothing else (as with a menu): it can't
// change the room's link or open a crystal under the box.
// The tip: a beat after the toggle has come in, "// Right-click for volume"
// types itself in beside it (its touch wording on touch screens), and goes
// after a few seconds, or as soon as the box is opened.
import { replayText } from './scrambleText.js';
import { glitch } from './glitch.js';
import { sfx } from '../audio/sfx.js';

const STORE = 'octolith-volume';
const PRESS_MS = 450; // a finger held this long on the toggle opens the box
const TIP_AFTER = [1400, 600]; // ms after the toggle came in: typing in / shown at once (skip)
const TIP_MS = 6500; // how long the tip stays
const FRAME_GLITCH = { amount: 0.025, rows: [0.25, 0.5], self: true, duration: 0.3 }; // the Close box's

const unit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

function loadLevels() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return { fx: unit(v?.fx), music: unit(v?.music) };
  } catch {
    return { fx: 1, music: 1 };
  }
}

function saveLevels(levels) {
  try {
    localStorage.setItem(STORE, JSON.stringify(levels));
  } catch {
    /* storage unavailable: the levels last this visit */
  }
}

export class SoundMixer {
  // toggle: the sound toggle; panel: the volumes box; hint: the tip beside
  // the toggle; sound: Sound.
  constructor({ toggle, panel, hint, sound }) {
    this.toggle = toggle;
    this.panel = panel;
    this.hint = hint;
    this.sound = sound;
    this.corner = toggle.closest('.corner'); // its scroll hint steps aside for the box
    this.frame = panel.querySelector('.sound-mixer__frame');
    this.texts = [...panel.querySelectorAll('[data-mix-text]')];
    this.sliders = [...panel.querySelectorAll('[data-volume]')];
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.isOpen = false;
    this.eat = 0; // swallow this gesture's click: until this time (Infinity: until the gesture ends)
    this.press = null; // a finger on the toggle: { id, x, y, fired }
    this.keyboard = false; // the last input was a key: the menu key opens the box with focus in it

    this.levels = loadLevels();
    for (const s of this.sliders) {
      const kind = s.dataset.volume;
      s.value = String(Math.round(this.levels[kind] * 100));
      this.show(s);
      sound.setVolume(kind, this.levels[kind]);
      s.addEventListener('input', () => this.onInput(s));
      s.addEventListener('change', () => {
        saveLevels(this.levels);
        if (kind === 'fx') this.preview();
      });
    }
    this.tipText = hint.querySelector('[data-hint]');
    if (matchMedia('(hover: none) and (pointer: coarse)').matches && this.tipText.dataset.touch) {
      this.tipText.textContent = this.tipText.dataset.touch;
    }

    toggle.addEventListener('contextmenu', (e) => this.onMenu(e));
    // a finger held still on the toggle (iOS fires no contextmenu for it)
    toggle.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
      clearTimeout(this.pressTimer);
      this.pressTimer = setTimeout(() => this.pressed(), PRESS_MS);
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.press;
      if (p && !p.fired && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) this.endPress();
    }, { passive: true });

    // Before anything else on the page (capture): a press outside closes the
    // box and its click is eaten; Esc closes it (and not a relic's page too).
    window.addEventListener('pointerdown', (e) => {
      this.keyboard = false;
      this.eat = 0;
      if (this.isOpen && !panel.contains(e.target) && !toggle.contains(e.target)) {
        this.close();
        this.eat = Infinity;
      }
    }, { capture: true });
    window.addEventListener('pointerup', () => {
      if (this.eat === Infinity) this.eat = performance.now() + 600; // its click comes right after
      this.endPress();
    }, { capture: true });
    window.addEventListener('pointercancel', () => {
      this.eat = 0;
      this.endPress();
    }, { capture: true });
    window.addEventListener('click', (e) => {
      if (!this.eat || performance.now() > this.eat) return;
      this.eat = 0;
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true });
    window.addEventListener('keydown', (e) => {
      this.keyboard = true;
      this.eat = 0;
      if (e.key !== 'Escape' || !this.isOpen) return;
      e.stopPropagation();
      e.preventDefault();
      this.close({ refocus: true });
    }, { capture: true });
    // Tabbing out of the box closes it.
    panel.addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (this.isOpen && to && !panel.contains(to) && to !== toggle) this.close();
    });
    // Nothing done in the box reaches the page: no link change, crystal or
    // swipe under it, no arrow key stepping the room's links.
    for (const type of ['click', 'pointerdown', 'touchstart', 'touchmove', 'touchend', 'keydown']) {
      panel.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }
  }

  // Right-click (or the menu key) on the toggle: the box, open or shut.
  onMenu(e) {
    e.preventDefault();
    // a finger held on it: Android fires this for the hold as well
    if (this.press) return this.pressed();
    if (this.isOpen) this.close({ refocus: this.keyboard });
    else this.open({ focus: this.keyboard });
  }

  // A finger has been held on the toggle: the box, open or shut, and the
  // click as the finger lifts does nothing.
  pressed() {
    const p = this.press;
    if (!p || p.fired) return;
    p.fired = true;
    clearTimeout(this.pressTimer);
    this.eat = Infinity;
    if (this.isOpen) this.close();
    else this.open();
  }

  endPress() {
    clearTimeout(this.pressTimer);
    this.press = null;
  }

  open({ focus = false } = {}) {
    if (this.isOpen) return;
    this.isOpen = true;
    clearTimeout(this.shutTimer);
    this.hideTip();
    const p = this.panel;
    p.hidden = false;
    void p.offsetWidth; // laid out before it fades in
    p.classList.add('is-open');
    this.corner?.classList.add('is-mixing');
    if (!this.reduced) {
      glitch(this.frame, FRAME_GLITCH);
      this.texts.forEach((el, k) => replayText(el, { delay: k * 60 }));
    }
    sfx('ui-short');
    if (focus) this.sliders[0].focus();
  }

  // refocus: back to the toggle (closed from the keyboard)
  close({ refocus = false } = {}) {
    if (!this.isOpen) return;
    this.isOpen = false;
    const p = this.panel;
    const focused = p.contains(document.activeElement);
    p.classList.remove('is-open');
    this.corner?.classList.remove('is-mixing');
    this.shutTimer = setTimeout(() => (p.hidden = true), 160); // after the fade
    if (!focused) return;
    if (refocus) this.toggle.focus();
    else document.activeElement.blur();
  }

  onInput(s) {
    const kind = s.dataset.volume;
    const v = s.valueAsNumber / 100;
    this.levels[kind] = v;
    this.show(s);
    this.sound.setVolume(kind, v);
    // turning a level up while muted brings the sound back, as players do
    if (v > 0 && this.sound.started && this.sound.muted) this.sound.setMuted(false);
  }

  // the slider's lit part and its number
  show(s) {
    s.style.setProperty('--v', `${s.value}%`);
    s.nextElementSibling.textContent = s.value.padStart(3, '0');
  }

  // the effects at their new level, heard
  preview() {
    const now = performance.now();
    if (now - (this.lastPreview ?? -1e9) < 120) return;
    this.lastPreview = now;
    sfx('ui-short');
  }

  // The toggle has come in (IntroUI; instant: shown at once, skipping the
  // intro): a beat later the tip types itself in beside it, for TIP_MS.
  tip(instant = false) {
    if (this.tipDue) return;
    this.tipDue = true;
    this.tipTimer = setTimeout(() => {
      if (this.isOpen) return;
      this.hint.classList.add('is-on');
      if (!this.reduced) replayText(this.tipText, { sweep: 0.4, settle: 0.75 });
      this.tipTimer = setTimeout(() => this.hideTip(), TIP_MS);
    }, TIP_AFTER[instant ? 1 : 0]);
  }

  hideTip() {
    clearTimeout(this.tipTimer);
    this.hint.classList.remove('is-on');
  }
}
