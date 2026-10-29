// ?debug: lil-gui with a timeline scrubber (0..1) and live config controls.
import GUI from 'lil-gui';

export class DebugGui {
  constructor({ tl, scene, cfg, parts = {} }) {
    const ui = parts.ui;
    const gui = new GUI({ title: 'OCTOLITH intro' });
    this.gui = gui;
    const state = {
      progress: tl.progress(),
      time: '0.00 s',
      play: () => tl.play(),
      pause: () => tl.pause(),
      restart: () => tl.restart(),
      speed: 1,
    };

    const t = gui.addFolder('Timeline');
    const scrub = t
      .add(state, 'progress', 0, 1, 0.001)
      .name('scrub 0-1')
      .onChange((v) => {
        tl.pause();
        tl.progress(v);
        ui?.syncTo(tl.time());
      });
    const time = t.add(state, 'time').name('time').disable();
    t.add(state, 'play');
    t.add(state, 'pause');
    t.add(state, 'restart');
    t.add(state, 'speed', 0.1, 2, 0.05).onChange((v) => tl.timeScale(v));
    const sync = () => {
      state.progress = tl.progress();
      state.time = `${tl.time().toFixed(2)} s`;
      scrub.updateDisplay();
      time.updateDisplay();
      requestAnimationFrame(sync);
    };
    sync();

    const cam = gui.addFolder('Camera (live)').close();
    cam.add(scene.rig, 'azimuth', 0, 360, 0.1).listen();
    cam.add(scene.rig, 'elevation', 0, 89, 0.1).listen();
    cam.add(scene.rig, 'distance', 5, 60, 0.1).listen();
    cam.add(scene.rig, 'targetY', 0, 4, 0.01).listen();

    const post = gui.addFolder('Post').close();
    post.add(scene.post, 'bloomIntensity', 0, 6, 0.01).name('bloom').listen();
    post.add(scene.post.bloom.luminanceMaterial, 'threshold', 0, 1.5, 0.01).name('bloom threshold');
    post.add(scene.post, 'chromatic', 0, 0.02, 0.0001).name('chromatic aberration').listen();
    post.add(scene.post.grain.blendMode.opacity, 'value', 0, 0.2, 0.005).name('grain');
    post.add(scene.post.vignette, 'darkness', 0, 1, 0.01).name('vignette');
    post.add(scene, 'atmosphere', 0, 1, 0.01).name('atmosphere').listen();

    const motion = parts.pyramid?.motion;
    if (motion) {
      const b = cfg.blocks;
      const h = gui.addFolder('Live hero').close();
      h.add(parts.pyramid, 'live', 0, 1, 0.01).name('live (pulse + hover)').listen();
      h.add(motion, 'pulseAmount', 0, 1, 0.01).name('pulse');
      h.add(b, 'hover', 0, 1, 0.01);
      h.add(b.hoverRadius, '0', 0, 3, 0.05).name('hover full within (m)');
      h.add(b.hoverRadius, '1', 0.5, 6, 0.05).name('hover none beyond (m)');
      h.add(b, 'travel', 0, 1.5, 0.01);
      h.add(b, 'spin', 0, 2, 0.01).name('wobble');
      h.add(parts.pyramid.uniforms.uBlockGlow, 'value', 0, 3, 0.01).name('block glow');
    }

    if (parts.ground) {
      const g = gui.addFolder('Reveal').close();
      const u = parts.ground.uniforms;
      g.add(parts.ground, 'reveal', 0, cfg.reveal.maxRadius, 0.1).name('radius').listen();
      g.add(u.uCellSize, 'value', 0.1, 4, 0.05).name('cell size');
      g.add(u.uNoiseAmt, 'value', 0, 30, 0.1).name('noise amount');
      g.add(u.uNoiseScale, 'value', 0.005, 0.5, 0.005).name('noise scale');
      g.add(u.uBandWidth, 'value', 0, 4, 0.05).name('band width');
      g.add(u.uPop, 'value', 0, 0.5, 0.01).name('pop');
    }

    const tr = parts.transition;
    if (tr) {
      // Preview the scroll into section 2 without scrolling (screens of scroll).
      const f = gui.addFolder('Transition').close();
      const st = { pin: tr.override !== null, at: tr.override ?? 0 };
      const max = tr.end + 0.5;
      f.add(st, 'pin').name('pin progress').onChange((v) => (tr.override = v ? st.at : null));
      f.add(st, 'at', 0, max, 0.001).name('progress (screens)').onChange((v) => st.pin && (tr.override = v));
      f.add(tr, 'progress', 0, max, 0.001).name('shown').listen().disable();
      f.add(tr.storm.uniforms.get('uWind'), 'value', 0, 2, 0.01).name('storm wind');
      f.add(tr.storm.uniforms.get('uFringe'), 'value', 0, 0.05, 0.001).name('storm fringe');
    }
  }

  dispose() {
    this.gui.destroy();
  }
}
