// ?stats (dev server only): the frame rate and the render's resolution in a
// corner, for checking a phone, where there are no developer tools at hand.
// Updated twice a second:
//   60 fps  16.7 / 17.2 ms   frames in the last second; median / 95th
//                            percentile frame time
//   2.00x of 3  786x1704     the render's pixel ratio (the adaptive
//                            resolution) of the screen's, and its size
//   stalls 3  max 412 ms     frames over 50 ms since the intro began, and
//                            the longest
export class Stats {
  constructor(scene) {
    this.scene = scene;
    const el = (this.el = document.createElement('div'));
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;z-index:30;top:calc(env(safe-area-inset-top, 0px) + 8px);right:8px;' +
      'padding:6px 8px;background:rgba(0,0,0,.6);color:#fff;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;' +
      'white-space:pre;pointer-events:none';
    document.body.append(el);
    this.frames = [];
    this.stalls = 0;
    this.worst = 0;
    this.last = performance.now();
    this.shown = 0;
    // (no stall for the time a hidden tab was away)
    document.addEventListener('visibilitychange', () => (this.last = performance.now()));
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  tick(now) {
    requestAnimationFrame(this.tick);
    const dt = now - this.last;
    this.last = now;
    if (dt > 50) {
      this.stalls++;
      this.worst = Math.max(this.worst, dt);
    }
    const f = this.frames;
    f.push([now, dt]);
    while (now - f[0][0] > 1000) f.shift();
    if (now - this.shown < 500) return;
    this.shown = now;
    const d = f.map((x) => x[1]).sort((a, b) => a - b);
    const r = this.scene.renderer;
    const c = r.domElement;
    this.el.textContent =
      `${d.length} fps  ${d[d.length >> 1].toFixed(1)} / ${d[Math.floor(d.length * 0.95)].toFixed(1)} ms\n` +
      `${r.getPixelRatio().toFixed(2)}x of ${window.devicePixelRatio}  ${c.width}x${c.height}\n` +
      `stalls ${this.stalls}  max ${Math.round(this.worst)} ms`;
  }
}
