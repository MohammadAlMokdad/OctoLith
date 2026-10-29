// A perspective camera's vertical field of view (degrees) for the screen's
// aspect. Screens narrower than minAspect (portrait phones) keep minAspect's
// horizontal field of view, so the scene fits the width instead of losing its
// sides; screens wider than maxAspect keep maxAspect's (the world ends past it).
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function fitFov(fov, aspect, { minAspect = 0, maxAspect = Infinity } = {}) {
  const keep = aspect < minAspect ? minAspect : aspect > maxAspect ? maxAspect : aspect;
  if (keep === aspect) return fov;
  return deg(2 * Math.atan((Math.tan(rad(fov / 2)) * keep) / aspect));
}
