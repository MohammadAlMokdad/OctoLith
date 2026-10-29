# source-assets

Raw inputs for the asset pipeline. Nothing in here is served or deployed: the
site only loads what the Blender scripts export into `public/assets/`.

| Path | Read by | Notes |
|---|---|---|
| `sketchfab/tutankhamun-mask-hunyuan/` | `blender/scripts/58_sketchfab_relics.py` | "Tutankhamun mask - Hunyuan" by vmmaniac, CC BY 4.0 (500k triangles, decimated to 60k) |
| `sketchfab/egyptian-cat-statue/` | same | "Egyptian Cat Statue" by Ankledot, CC BY 4.0 (Collada in `source/model.zip` + PBR maps) |
| `sketchfab/ankh_asset.glb` | same | "Ankh Asset" by scrampunk, CC BY 4.0 |
| `textures/` | `blender/scripts/11_materials.py`, `13_detail_textures.py` | photo-scanned sand and sandstone maps (1024², tileable) |
| `audio/OctolithBGMusic.mp3` | cut by hand with ffmpeg | the full track. `public/assets/audio/music.mp3` is 45:45–51:25 of it, faded 0.4 s in / 1.5 s out. 115 MB, kept out of git (`.gitignore`). |

CC BY 4.0 requires credit: each relic's page in `index.html` has a `/// Model`
line naming the model and its author, with links to the model and the licence.
Keep those lines.
