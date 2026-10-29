// Generates the sound effects off the main thread (synth.js), in the order
// asked, each posted as soon as it's ready.
import { SOUNDS, SR } from './synth.js';

self.onmessage = ({ data: { names } }) => {
  for (const name of names) {
    const data = SOUNDS[name]();
    self.postMessage({ name, sr: SR, data }, [data.buffer]);
  }
};
