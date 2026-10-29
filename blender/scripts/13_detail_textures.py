"""Split the supplied tileable textures into a low-pass layer (baked) and a
high-pass detail layer (drawn live on the web).

The bakes hold ~68 px/m on the ground and ~150 px/m on the blocks, far below
the source textures (~640 and ~1100 px/m), so grains, dark specks and crack
lines average away. So:

  blender/textures/<name>_lowpass.png          blurred colour (sRGB) the bake uses
  public/assets/textures/detail/<name>_detail.png
                                               source / low-pass in linear light,
                                               stored as 0.5 * ratio (Non-Color);
                                               the web multiplies bake * 2 * detail

The blur is periodic (FFT), so both outputs stay tileable. SIGMA is roughly
one bake texel measured in source pixels.
"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
import numpy as np

SRC = os.path.join(opl.ROOT, 'source-assets', 'textures')
LOW_DIR = os.path.join(opl.ROOT, 'blender', 'textures')
DETAIL_DIR = os.path.join(opl.TEXTURES_DIR, 'detail')
JOBS = [('sand-basecolor.jpg', 'sand', 5.0), ('pyramid-basecolor.jpg', 'stone', 4.0)]


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def periodic_blur(img, sigma):
    h, w = img.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    kernel = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    out = np.empty_like(img)
    for ch in range(img.shape[2]):
        out[:, :, ch] = np.real(np.fft.ifft2(np.fft.fft2(img[:, :, ch]) * kernel))
    return out


def save(name, rgb, path):
    """rgb: HxWx3 floats already encoded as they should be stored (0..1)."""
    h, w = rgb.shape[:2]
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'          # write values as given
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], axis=2).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


for filename, short, sigma in JOBS:
    src = bpy.data.images.load(os.path.join(SRC, filename), check_existing=False)
    src.colorspace_settings.name = 'Non-Color'          # raw (sRGB-encoded) values
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    bpy.data.images.remove(src)
    lin = to_linear(px.reshape(h, w, 4)[:, :, :3].astype(np.float64))
    low = periodic_blur(lin, sigma)
    ratio = lin / np.maximum(low, 1e-4)
    save(f'{short}_lowpass', to_srgb(low), os.path.join(LOW_DIR, f'{short}_lowpass.png'))
    save(f'{short}_detail', np.clip(0.5 * ratio, 0.0, 1.0),
         os.path.join(DETAIL_DIR, f'{short}_detail.png'))
    print(f'{short}: ratio p1={np.percentile(ratio, 1):.2f} p50={np.median(ratio):.2f} '
          f'p99={np.percentile(ratio, 99):.2f}')
