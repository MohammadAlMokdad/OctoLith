// Phase A: a tiny monospace bar built from "-", "=", "+".
//  - "=" fills left->right with real load progress (eased, never jumps back),
//  - a short wave of "+" keeps travelling left->right on top of it,
//  - characters flicker/scramble every ~60 ms,
//  - finish() collapses the bar in ~200 ms (CSS) and resolves when it's gone.
export class AsciiLoader {
  constructor(root, bar, { width = 12, tickMs = 60, waveSpeed = 14, waveLength = 2, minShowMs = 900 } = {}) {
    this.root = root;
    this.bar = bar;
    this.width = width;
    this.tickMs = tickMs;
    this.waveSpeed = waveSpeed; // cells per second
    this.waveLength = waveLength;
    this.minShowMs = minShowMs;
    this.target = 0; // reported progress 0..1
    this.shown = 0; // displayed progress (eased)
    this.startTime = 0;
    this.lastTick = 0;
    this.raf = 0;
    this.frame = this.frame.bind(this);
  }

  start() {
    this.startTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  setProgress(p) {
    this.target = Math.max(this.target, Math.min(1, p));
  }

  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.lastTick < this.tickMs) return;
    const dt = (now - (this.lastTick || now)) / 1000;
    this.lastTick = now;
    this.shown += (this.target - this.shown) * Math.min(1, dt * 6);

    const t = (now - this.startTime) / 1000;
    const span = this.width + this.waveLength;
    const head = (t * this.waveSpeed) % span; // wave front, in cells
    const filled = this.shown * this.width;
    let s = '';
    for (let i = 0; i < this.width; i++) {
      let c = i < filled ? '=' : '-';
      const d = head - i;
      if (d >= 0 && d < this.waveLength) c = '+';
      if (Math.random() < 0.12) c = '-=+'[(Math.random() * 3) | 0]; // flicker
      s += c;
    }
    this.bar.textContent = s;
  }

  // Resolves once the bar has been visible long enough, reached 100% and collapsed.
  finish() {
    this.setProgress(1);
    return new Promise((resolve) => {
      const wait = () => {
        const shownFor = performance.now() - this.startTime;
        if (this.shown < 0.985 || shownFor < this.minShowMs) {
          setTimeout(wait, this.tickMs);
          return;
        }
        this.bar.textContent = '='.repeat(this.width);
        cancelAnimationFrame(this.raf);
        this.root.classList.add('is-done');
        setTimeout(() => {
          this.root.remove();
          resolve();
        }, 220);
      };
      wait();
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}
