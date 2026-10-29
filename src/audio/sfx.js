// Sound cues for any module: sfx('ui-long'). Silent until the sound system
// (Sound.js) is up and running, so callers never need to check.
let engine = null;

export const sfx = (name) => engine?.play(name);

export function setSfxEngine(e) {
  engine = e;
}
