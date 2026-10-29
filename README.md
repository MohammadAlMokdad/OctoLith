# OctoLith

A scroll-driven WebGL experience: a cinematic desert-pyramid intro, a sandstorm, a vault of crystal-encased Egyptian relics, and a dive through shattered sandstone rings, built with three.js, GSAP and Vite.

Live site: <https://octolith.vercel.app>

## Features

- **Cinematic intro (~9 s).** An ASCII loader shows real progress while shaders precompile. Then a glowing seed appears at the apex, a golden wireframe draws itself down the pyramid, and a line network grows across the ground. An energy fill and a white flash follow, the glow cools to stone, and the desert reveals itself outward in stepped cells. Click, tap, Esc or Enter skips to the end.
- **Live hero.** The pyramid's blocks breathe on a travelling wave and push out under the pointer, with a gold glow in the joints. "Plexus" markers show how far each block has moved. Wind-blown sand (drifting sheets, low dust haze and flying grains) is computed entirely in shaders.
- **Sandstorm transition.** Scrolling pulls the camera back while a wall of sand, rendered as one post-processing pass, rolls in and carries you into the next section.
- **Relic vault.** Three sand-frosted quartz crystals hold Egyptian relics, seen only through refracting, dispersive glass. Moving the mouse brushes the frost off. DOM labels track each crystal. Clicking a crystal opens the relic's page with a dissolve transition, a dark chamber scene, and a pointer trail that ripples through the text.
- **Rings descent.** The camera dives through procedurally generated, shattered rings that assemble as it approaches. The descent ends in a round room with a 150,000-particle GPU sculpture that takes the shape of each contact link.
- **Endless loop.** Scrolling past the room brings the hero back from the sky, and the page wraps around to the top.
- **Sound.** A music loop plus sound effects synthesized in a Web Worker (no effect audio files). Audio stays muted until the first click, tap or key. A right-click (long-press on touch) opens a volume mixer.
- **Accessible and fast.** All copy is real DOM text, so it is selectable and readable by screen readers. `prefers-reduced-motion` is respected, and browsers without WebGL2 get a static fallback image. Resolution adapts to the frame rate, textures decode off the main thread, and rendering pauses in hidden tabs.

## Tech stack

- [three.js](https://threejs.org) for rendering (custom GLSL materials, GLTF and EXR loaders)
- [postprocessing](https://github.com/pmndrs/postprocessing) (pmndrs) for bloom, SMAA, chromatic aberration and custom passes
- [GSAP](https://gsap.com) for the master intro timeline and the scroll choreography
- [lil-gui](https://lil-gui.georgealways.com) for the dev-only debug panel
- [Vite](https://vite.dev) as dev server and bundler. Plain JavaScript: no framework, no TypeScript.
- [Blender](https://www.blender.org) (Python scripts) to model, bake and export the 3D assets
- [Vercel](https://vercel.com) for hosting

## Prerequisites

- Node.js 22 or newer (see `engines` in `package.json`)
- A browser with WebGL2
- Only for regenerating 3D assets: Blender with the [blender-mcp](https://github.com/ahujasid/blender-mcp) add-on
- Only for the screenshot tools: Microsoft Edge (Windows)

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:5199>.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server at `http://localhost:5199`, also exposed on your LAN (`--host`) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run viewer` | Dev-only viewers for the baked assets at `/viewer/` (`index.html`, `sand.html`, `vault.html`); not part of the build |
| `npm run blender -- <cmd>` | Sends commands to a running Blender (see [Asset pipeline](#asset-pipeline)) |
| `npm run deploy` | Builds and deploys `dist/` to Vercel production |

Asset URLs are root-relative (`/assets/...`), so serve the build from the domain root or set Vite's `base`.

## Configuration

### Environment variables

The site reads no environment variables. `.env.example` only lists `VERCEL_OIDC_TOKEN`, a short-lived token the Vercel CLI writes into `.env.local` by itself. You don't need it to run or build.

The dev tools read these optional shell variables:

| Variable | Used by | Default |
|---|---|---|
| `BLENDER_HOST`, `BLENDER_PORT`, `BLENDER_TIMEOUT` | `tools/blender.mjs` | `127.0.0.1`, `9876`, `600000` ms |
| `SHOT_BASE` | `tools/shot.mjs` | `http://localhost:5199` |
| `EDGE` | `tools/shot.mjs`, `tools/drive.mjs` | the default Microsoft Edge install path |

### Tuning the experience

Almost every timing, colour, count and effect strength is in one commented object: `INTRO_CONFIG` in [`src/config/introConfig.js`](src/config/introConfig.js).

| To change | Edit |
|---|---|
| Intro speed (bigger is slower; default `1.5`) | `pace`, `phases` |
| Colours | `colors` |
| Block breathing, hover push, markers | `blocks`, `plexus` |
| Wind, dust and grains | `sand` |
| Scroll lengths and the sandstorm | `transition` |
| Crystal glass, frost, relic pages | `vault` |
| Rings and the particle room | `rings`, `room` |
| Bloom, grain, vignette, tone mapping | `post` |
| Pixel-ratio caps and adaptive resolution | `performance` |
| Music path and volume | `audio` |
| Hero model | `assets.pyramid` (any GLB works: it is auto-centred and scaled, with generated edges) |

All copy, the relic pages and the contact links are plain HTML in [`index.html`](index.html). Edit the text inside any `[data-scramble]` element and it types itself in as written.

### Debug switches (dev server only)

The production build ignores the query string and drops the debug panel.

| URL | Effect |
|---|---|
| `?debug` | lil-gui panel: timeline scrubber, camera, post, reveal, live-hero and transition controls |
| `?debug&t=2.1` | Jump to 2.1 s of the intro and pause |
| `?debug&p=1.7` | Pin the scroll position in screens: `1.2` storm, `1.7` / `2.7` / `3.7` crystals, `5` rings, `8.64` room, `10.4` loop arrival |
| `?final` | Skip straight to the end of the intro |
| `?stats` | Frame rate, render resolution and stalls (handy on phones) |
| `?nowebgl` | Force the static-image fallback |
| `?clean` | Hide the DOM UI |
| `?mouse=-0.1,0.2` | Pin the pointer at a screen position (-1..1, y up) |
| `?dpr=1.5` | Pin the pixel ratio (turns adaptive resolution off) |
| `?nolag` | Disable GSAP lag smoothing (slow headless browsers) |

`node tools/shot.mjs "/?debug&t=2.1" out.png` takes a headless screenshot of the running dev server. `node tools/drive.mjs script.json` drives the page in real time: mouse paths, JS evaluation and screenshots. Each script's header documents its options.

## Asset pipeline

Everything in `public/assets/` is generated by the Python scripts in `blender/scripts/`, and the generated assets are committed, so the site runs straight after a clone. The scripts build the scene procedurally: the stepped pyramid, the desert terrain, distant landmarks, the crystal vault and the relics. They then bake the lighting into colour maps and export uncompressed GLBs, PNG bakes and EXR environment maps. Script numbers give the order:

| Scripts | Stage |
|---|---|
| `00`–`13` | Scene setup, hero pyramid, materials, intro points, detail textures |
| `20`–`21` | Terrain and distant landmarks |
| `30`–`31`, `40` | Scene 1 bake, environment map, export |
| `50`–`58` | Scene 2: vault, crystals, materials, relics, bake, export |
| `90` | Quick Cycles preview render |

The scripts run inside a running Blender through `tools/blender.mjs`, a small client for the blender-mcp add-on's socket:

```bash
npm run blender -- exec blender/scripts/40_export_s1.py
npm run blender -- exec blender/scripts/54_bake_s2.py --arg only=relics
npm run blender -- exec blender/scripts/90_preview.py --arg camera=CAM_Web
```

After exporting Scene 1, run `node tools/trim-world.mjs` (`--dry` only reports). It replays every camera path and drops the triangles and texture areas no camera can see. `node tools/inspect-glb.mjs <file.glb>` prints a GLB's nodes, meshes and attributes.

The Blender master file and the raw inputs (Sketchfab downloads, photo-scanned textures, the full-length soundtrack) are not in this repository because of their size. [`source-assets/README.md`](source-assets/README.md) lists what goes there and which script reads each input. The wordmark is traced from a font to SVG outlines by `tools/wordmark.py` (needs `fonttools`).

## Deployment

The site is static. `vercel.json` serves the prebuilt `dist/` folder as is (no install or build step on Vercel), and `.vercelignore` uploads only `dist/` and `vercel.json`. To deploy:

```bash
npm run deploy    # vite build, then vercel deploy --prod
```

The first run asks you to log in to Vercel and link a project. To use Vercel's Git integration instead, set the build command to `npm run build` in `vercel.json` or in the project settings. `dist/` is not committed.

## Project structure

```
index.html            Entry page: all copy, relic pages and links
src/
  main.js             Boot: loader, scene setup, intro, scroll sections
  config/             INTRO_CONFIG, the single settings object
  loader/             ASCII loading bar
  scene/              Hero: pyramid, terrain reveal, network grid, sand wind, plexus, shaders
  timeline/           Master GSAP intro timeline
  transition/         Scroll engine and sandstorm transition
  vault/              Section 2: crystals, frost brush, labels, relic pages
  rings/              Section 3: ring geometry, materials, post-processing
  room/               Particle sculpture and contact links
  post/               Post-processing passes
  ui/                 Corner UI, text scramble, logo glitch, text trail, volume mixer
  audio/              Music playback and synthesized effects (Web Worker)
  debug/              lil-gui panel and stats overlay (dev only)
  styles/             CSS
public/               Static files served as is: fonts, baked models, textures, music
brand/                Wordmark and favicon SVGs
viewer/               Dev-only asset viewers
tools/                Blender client, headless screenshot/drive tools, GLB inspection, world trimming, wordmark tracing
blender/scripts/      Blender Python scripts that generate public/assets
source-assets/        Placeholder for raw pipeline inputs (only the README is tracked)
LEARN_OCTOLITH.md     A from-zero guide to how the whole project works
```

For a beginner-friendly walkthrough of the rendering, shaders, scroll engine and Blender pipeline, read [LEARN_OCTOLITH.md](LEARN_OCTOLITH.md).

## Credits

- The three relics are Sketchfab models under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each relic page credits its model; keep those credits if you reuse them.
  - "Tutankhamun mask - Hunyuan" by vmmaniac
  - "Egyptian Cat Statue" by Ankledot
  - "Ankh Asset" by scrampunk
- Typeface: [IBM Plex Mono](https://github.com/IBM/plex) (SIL Open Font License), self-hosted in `public/fonts/`.
- The site's structure, choreography and interaction design are modelled on [igloo.inc](https://www.igloo.inc), re-themed as a desert.
