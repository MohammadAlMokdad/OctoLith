// A texture decoded off the main thread where the browser can (an
// ImageBitmap). A big PNG decoded through an <img> stalls the page while it
// uploads, a tenth of a second or more each on a phone, and the later
// sections' textures arrive while the hero is on screen. Safari before 17
// and Firefox before 98 ignore createImageBitmap's options, so they keep the
// <img> path (as three's GLTFLoader does).
// flipY: the image's orientation, as Texture.flipY (false: glTF's). An
// ImageBitmap gets it, and no colour or alpha changes, when it is decoded:
// three ignores those settings for bitmaps. Once a bitmap is on the GPU it is
// let go, freeing its decoded copy (phones are short of memory).
import { ImageBitmapLoader, Texture, TextureLoader } from 'three';

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const version = (re) => parseInt(ua.match(re)?.[1] ?? '0', 10);
const oldSafari = /^((?!chrome|android).)*safari/i.test(ua) && version(/Version\/(\d+)/) < 17;
const oldFirefox = ua.includes('Firefox') && version(/Firefox\/(\d+)/) < 98;
const bitmaps = typeof createImageBitmap !== 'undefined' && !oldSafari && !oldFirefox;

export function loadTexture(url, { flipY = true } = {}) {
  if (!bitmaps) {
    return new TextureLoader().loadAsync(url).then((t) => {
      t.flipY = flipY;
      return t;
    });
  }
  const loader = new ImageBitmapLoader().setOptions({
    imageOrientation: flipY ? 'flipY' : 'from-image',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  return loader.loadAsync(url).then((bitmap) => {
    const t = new Texture(bitmap);
    t.needsUpdate = true;
    t.onUpdate = () => bitmap.close?.();
    return t;
  });
}
