// Builds the sculpture's shapes off the main thread (volumes.js).
import { buildShape } from './volumes.js';

self.onmessage = ({ data: { id, name, opts } }) => {
  try {
    const { volume, homes } = buildShape(name, opts);
    self.postMessage({ id, volume, homes }, [volume.buffer, homes.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
