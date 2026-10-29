# OctoLith, explained from zero

This document explains how the OctoLith website works. It assumes you know **nothing** about 3D, Blender, graphics cards or shaders. Every new word is explained the first time it appears. If you forget one, the **Glossary** at the end lists them all.

**How to read it**

- Read it in order. Each part builds on the one before.
- Part A teaches the basic ideas, with almost no code.
- Part B introduces the tools.
- Part C walks through the website, piece by piece, with code.
- Part D explains how the 3D files are made in Blender.
- Part E is practical: how to run it, where to change things, and the problems found.
- In VS Code, press **Ctrl + Shift + V** to read this file nicely formatted.

This file is not part of the website. It doesn't change the site or the build.

---

## Contents

- [Part A — The basic ideas](#part-a--the-basic-ideas)
  - [A1. What a visitor sees](#a1-what-a-visitor-sees)
  - [A2. A screen is a grid of coloured dots](#a2-a-screen-is-a-grid-of-coloured-dots)
  - [A3. Animation is a flipbook](#a3-animation-is-a-flipbook)
  - [A4. How a computer stores a 3D object](#a4-how-a-computer-stores-a-3d-object)
  - [A5. What a vertex really holds](#a5-what-a-vertex-really-holds)
  - [A6. Coordinates: addresses in 3D space](#a6-coordinates-addresses-in-3d-space)
  - [A7. The camera](#a7-the-camera)
  - [A8. Light, and why we "bake" it](#a8-light-and-why-we-bake-it)
  - [A9. Textures and UVs](#a9-textures-and-uvs)
  - [A10. The processor and the graphics card](#a10-the-processor-and-the-graphics-card)
  - [A11. Shaders: the two small programs](#a11-shaders-the-two-small-programs)
  - [A12. How information reaches a shader](#a12-how-information-reaches-a-shader)
  - [A13. Hidden pictures and filters (post-processing)](#a13-hidden-pictures-and-filters-post-processing)
  - [A14. What's in front: depth, transparency, order](#a14-whats-in-front-depth-transparency-order)
  - [A15. Noise: making natural randomness](#a15-noise-making-natural-randomness)
  - [A16. Animating numbers over time](#a16-animating-numbers-over-time)
- [Part B — The tools](#part-b--the-tools)
- [Part C — How the website works, piece by piece](#part-c--how-the-website-works-piece-by-piece)
- [Part D — How the 3D files are made in Blender](#part-d--how-the-3d-files-are-made-in-blender)
- [Part E — Practical](#part-e--practical)
- [Glossary](#glossary)

---

# Part A — The basic ideas

## A1. What a visitor sees

Before learning how it works, here is what happens on the website, in order:

1. **Loading.** A small bar made of text characters (`-=+`) fills up.
2. **The intro (about 9 seconds).**
   - A glowing dot appears.
   - Golden lines draw the outline of a pyramid from the top down.
   - A golden grid spreads across the ground, with small numbers counting.
   - The pyramid fills with bright light from top to bottom, then flashes white.
   - The light fades and the pyramid becomes real stone.
   - The desert appears around it, spreading outward in blocky steps.
   - The camera lowers to look at the pyramid from the side, and text appears in the corners.
3. **The "hero" view.** "Hero" is web-design slang for the big first view of a website. The pyramid's stone blocks gently breathe in and out. When you move the mouse over the pyramid, nearby blocks push outward and glow gold, and small `+` markers with numbers appear. Sand blows across the ground.
4. **Scrolling down.** The camera pulls back, the wind picks up, and a wall of sand (a sandstorm) covers the screen.
5. **The vault.** Behind the storm are three frosted glass crystals, each holding an Egyptian object (a "relic"): Tutankhamun's mask, a cat statue, an ankh. Moving the mouse over a crystal wipes its frost off. Clicking one opens a page about that relic.
6. **The rings.** Scrolling further, the camera dives down a shaft through three broken stone rings. Each ring assembles itself as you get close.
7. **The room.** At the bottom, 150,000 tiny particles form a shape (an octopus, or an Instagram, WhatsApp or mail icon). Your mouse stirs them. Clicking changes the shape and the link.
8. **The loop.** Keep scrolling and the pyramid comes back from below. You are at the start again. The page never ends.

There is also sound: music, plus small sound effects for wind, clicks and so on.

## A2. A screen is a grid of coloured dots

Your screen is a grid of tiny dots called **pixels**. A 2560 × 1600 laptop screen has about **4 million** pixels. Each pixel shows one colour, made by mixing **red, green and blue** light. In code, a colour is three numbers from 0 to 1:

```
(1, 0, 0) = red      (1, 1, 1) = white      (0, 0, 0) = black      (1, 0.8, 0.4) = warm gold
```

Everything 3D on this website ends up as one job: **decide the colour of each of those 4 million pixels**.

## A3. Animation is a flipbook

Like a flipbook, the screen shows still pictures one after another, very fast. Each picture is called a **frame**. The website tries to draw **60 frames per second** ("60 fps"). That leaves about **16 milliseconds** (16 thousandths of a second) to calculate each picture. If a frame takes longer, the motion stutters.

**Keep this in mind for the whole document: most of the clever code exists so that each frame is finished in under 16 ms, even on a cheap laptop.**

## A4. How a computer stores a 3D object

A computer can't store a "real" shape. It stores a **skin made of flat triangles**, like a papercraft model.

```
     A                   A-----B
    / \                  | \   |      Two triangles make a square.
   /   \                 |   \ |      A pyramid face, a cube, a face model:
  B-----C                C-----D      all are triangles, just many more of them.
 one triangle
```

- Each corner of a triangle is called a **vertex** (plural: **vertices**).
- The flat surface between three vertices is a **triangle** (also called a **face**).
- A whole object made of triangles is called a **mesh** (or a **model**).

The OctoLith hero pyramid is one mesh with:

- **337** stone blocks,
- **17,672** triangles,
- **26,131** vertices.

Why more vertices than you'd expect? A cube has 8 corners, but the computer usually stores each corner **three times**, once for each face that touches it. Each face needs to remember its own "which way am I facing" (see next section).

**Smooth-looking things are just many small triangles.** The rings in section 3 look round, but each is made of thousands of tiny flat triangles.

## A5. What a vertex really holds

A vertex is not just a point. It is a **small bundle of information**, like a label stuck on each corner. Each piece of information is called an **attribute**. The pyramid's vertices carry:

| Attribute | What it means, in plain words |
|---|---|
| `position` | **Where** the corner is: 3 numbers (x, y, z), in metres. |
| `normal` | An arrow pointing **straight out of the surface** at that corner. It tells the computer which way the surface faces, which is needed for lighting. |
| `uv` | **Where on the picture** (texture) this corner sits. Explained in [A9](#a9-textures-and-uvs). |
| `_centr` | The **centre of the stone block** this corner belongs to. Every corner of the same block has the same value. |
| `_blockid` | **Which block** (a number from 0 to 336). |
| `_rand` | A **random number per block**, so blocks can look and move a little differently. |

The first three are standard: almost every 3D model has them. The last three (starting with `_`) are **custom**: a Blender script added them on purpose for this website. They are the secret behind the moving blocks ([C10](#c10-the-moving-blocks-the-most-important-trick)).

## A6. Coordinates: addresses in 3D space

A **coordinate** is an address in space, written as three numbers **(x, y, z)**. In this website:

```
        y (up)
        |
        |
        +------ x (right)
       /
      /
     z (toward you)
```

- Units are **metres**. The pyramid is about 5 m wide and 2.8 m tall. Its base centre is at (0, 0, 0).
- **Watch out:** Blender uses **z as "up"**, while the website (three.js) uses **y as "up"**. The scripts have to convert between them. You'll see this again in Part D.

The same point can be described from different points of view. These are called **spaces**:

| Space | Plain meaning |
|---|---|
| **Object space** (local) | Coordinates as the object was built, as if it were alone in the world. |
| **World space** | Coordinates in the shared scene, where everything lives together. |
| **Camera space** (view) | Coordinates as seen from the camera: "how far left, up and in front of me?" |
| **Screen space** (clip) | Where it lands on your screen. |

Going from one space to the next is a fixed recipe of multiplications called a **matrix**. You don't need to understand the maths: three.js gives you the matrices ready-made. You just multiply.

## A7. The camera

The 3D world is seen through a virtual **camera**, like a real one. It has:

- a **position** (where it stands);
- a **target** (the point it looks at);
- a **field of view** ("FOV"), the zoom. A small FOV is zoomed in (like a telephoto lens); a large FOV is wide-angle. The hero uses about **30 degrees**, which is quite zoomed in.

The camera uses **perspective**: far things look smaller, like in real life.

This website moves its camera with 4 numbers, like a drone circling a building:

```
azimuth   = which side you look from (an angle around the pyramid)
elevation = how high you are (an angle up from the ground)
distance  = how far away you are
targetY   = how high the point you look at is
```

The animation code changes these 4 numbers over time, and the camera follows.

## A8. Light, and why we "bake" it

Real objects get their colour from light hitting them: the sun, the sky, light bouncing off the sand, shadows. Calculating that realistically is **very** slow. Blender's realistic renderer can take minutes for one picture. A website has 16 ms.

**The trick is called baking.** Light that never changes (the sun doesn't move here) is calculated **once**, in Blender, slowly and perfectly. The result is **painted into an image**. On the website, the computer just shows that image on the object.

> **Analogy:** instead of lighting a room with real lamps every time someone visits, you take one perfect photo of the lit room and print it on the wallpaper. Visitors see perfect lighting, and it costs nothing.

In this project, the pyramid, the ground, the distant dunes, the background pyramids and the relics all use baked light. These baked images are the `*_color.png` files in `public/assets/textures/`.

**The downside:** baked light can't change. So things that move, like the blocks pushing outward, need tricks (explained later).

## A9. Textures and UVs

A **texture** is an image that gets wrapped onto a 3D object, like wrapping paper or a sticker.

**UVs** answer the question "which part of the image goes where on the object?" Imagine cutting a cardboard box open and flattening it. Each flat panel sits somewhere on a sheet of paper. The UV of a corner is its position on that flat sheet: two numbers, **U** (left to right, 0 to 1) and **V** (bottom to top, 0 to 1).

```
3D box  →  cut and flatten ("unwrap")  →  each corner gets a (U, V) position on the image

   +-----+                 +--+--+--+--+
  /     /|                 |  |  |  |  |    every face of the box gets
 +-----+ |                 +--+--+--+--+    its own patch of the image
 |     | +                    |  |
 |     |/                     +--+
 +-----+
```

Some textures in this project aren't colours at all:

- **Detail textures**: fine sand grains and stone cracks, mixed on top of the baked colour. See [C8](#c8-the-ground-baked-light--detail).
- **Normal maps**: images that store tiny bumps as "which way the surface faces", used on the crystals.
- **Roughness maps**: how shiny or matte each spot is.
- **Data textures**: images used as **memory** to pass numbers to the graphics card, such as block positions or particle positions. A picture is just a grid of numbers, so it can store anything.

## A10. The processor and the graphics card

A computer has two main brains:

- The **CPU** (processor) runs your JavaScript. It's like **one very smart worker**: it can do anything, but one thing at a time.
- The **GPU** (graphics card) is like **thousands of simple workers** who all do the same small task at the same moment, each on different data. That's perfect for graphics: 4 million pixels can be coloured in parallel.

The website is written in JavaScript (CPU), but it sends small programs to the GPU to do the heavy drawing. Those programs are called **shaders**.

**WebGL** is the browser feature that lets a web page use the GPU. **three.js** is a library that makes WebGL much easier to use.

## A11. Shaders: the two small programs

A **shader** is a small program that runs on the GPU. It's written in a language called **GLSL**, which looks a bit like C or JavaScript. Every time something is drawn, the GPU runs **two** shaders:

**1. The vertex shader** runs **once for every vertex**. Its job: "where on the screen does this corner go?" It can also move corners around. That's how the blocks move.

**2. The fragment shader** runs **once for every pixel** that a triangle covers. Its job: "what colour is this pixel?" ("Fragment" is just the GPU's word for "a pixel being worked on".)

Between the two, the GPU fills in each triangle with pixels by itself. This is called **rasterizing**.

```
 vertices ──► [ VERTEX SHADER ] ──► corners placed on screen
                                           │
                                  GPU fills in the triangles
                                           │
                                           ▼
                        pixels ──► [ FRAGMENT SHADER ] ──► colours on screen
```

> **Analogy:** the vertex shader places the poles of a tent. The fragment shader paints the fabric between the poles.

A fragment shader can also say **`discard`**: "don't draw this pixel at all". This website uses that a lot to make things appear bit by bit.

**Why speed depends on pixels:** the pyramid has 26,131 vertices, but a full screen has about 4 million pixels, and several layers often cover the same pixel. So the fragment shader runs far more often. Your README says it too: "geometry was never the bottleneck… per-pixel work is what counts."

### A tiny shader, explained

This is the simplest possible pair, close to what the website uses for full-screen effects:

```glsl
// VERTEX SHADER: runs once per corner
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // "take this corner's position, convert it from object space to screen space"
}
```

```glsl
// FRAGMENT SHADER: runs once per pixel
void main() {
  gl_FragColor = vec4(1.0, 0.8, 0.4, 1.0);
  // "make this pixel warm gold (red 1, green 0.8, blue 0.4), fully opaque (1)"
}
```

`gl_Position` and `gl_FragColor` are special names: the answers the GPU expects.

## A12. How information reaches a shader

Shaders need data. There are four ways to give it to them:

| Kind | Changes how often | Plain meaning | Examples here |
|---|---|---|---|
| **attribute** | different for each vertex | the labels stuck on each corner ([A5](#a5-what-a-vertex-really-holds)) | `position`, `normal`, `_centr` |
| **uniform** | same for the whole object, set from JavaScript | a "setting" or "dial" you can turn at any time | time, a colour, how far the intro has progressed |
| **varying** | different for each pixel | a value the vertex shader passes to the fragment shader; the GPU **blends it smoothly** across the triangle | the pixel's world position, its UV |
| **texture** | – | an image the shader can read from | the baked colours, the block data |

### The most important idea in the whole intro

**Changing a uniform is almost free.** The website changes a few numbers, and every pixel reacts instantly. The whole intro animation is just numbers ("uniforms") changing over time.

Example: the "energy fill" where the pyramid fills with light from top to bottom.

In JavaScript (`src/timeline/introTimeline.js`), the code slowly lowers a uniform called `uFillY` (the height of the fill line) from the top of the pyramid to its base:

```js
tl.fromTo(U.uFillY, { value: topOfPyramid }, { value: baseOfPyramid, duration: ... });
```

In the pyramid's fragment shader, each pixel checks:

```glsl
if (vWorld.y < uFillY) discard;
// "if this pixel is below the fill line, don't draw it"
```

As the line moves down, more of the pyramid appears. One number drives the whole effect.

## A13. Hidden pictures and filters (post-processing)

The website doesn't always draw straight to the screen. It can draw into a **hidden picture** (called a **render target**), then run a **filter** over the whole picture before showing it, like Instagram filters. This is called **post-processing**.

Filters this website uses:

| Filter | What it does |
|---|---|
| **Bloom** | Finds very bright pixels, blurs them and adds them back. Bright gold looks like it **glows**. |
| **Tone mapping** | The scene uses brightness values above "white" (e.g. 3× white for the energy fill). A screen can't show that. Tone mapping squeezes the brightness into what a screen can show, like a camera's exposure. |
| **Anti-aliasing (SMAA)** | Smooths jagged, staircase-looking edges. |
| **Chromatic aberration** | Slightly separates red and blue toward the screen edges, like a cheap camera lens. |
| **Vignette** | Darkens the corners slightly. |
| **Grain** | Adds subtle film grain. |

Hidden pictures are also used to **combine two scenes**. During the sandstorm, the website draws the pyramid scene and the vault scene, then a filter mixes them.

## A14. What's in front: depth, transparency, order

When two objects overlap on screen, which one wins?

- **The depth buffer.** For each pixel, the GPU remembers how far away the thing drawn there is. A new pixel is only drawn if it's **closer**. That's how the pyramid hides the sand behind it. In code, this is called the **depth test**.
- **Transparency and blending.** Glowing things (golden lines, dust, sparkles) use **additive blending**: their colour is **added** to what's behind, so overlaps get brighter, like light.
- **Draw order** (`renderOrder` in the code) forces some objects to be drawn before or after others.

## A15. Noise: making natural randomness

Nature isn't perfectly smooth or perfectly random. To make natural-looking sand sheets, dust, clouds and edges, shaders use **noise**: smooth, random-looking patterns calculated by a formula. The website builds it in three steps:

```
1. hash      → a random number for each grid square        (like TV static, blocky)
2. noise     → smoothly blend between those random numbers  (soft hills)
3. fbm       → stack 4 layers of noise, each finer and weaker (hills with small details, like nature)
```

Then a "threshold" turns the soft hills into **patches**: "where noise is high, put dust". Same input, same output, every time, so it looks the same on every visit.

## A16. Animating numbers over time

Almost all animation here is "**change this number from A to B over N seconds**". This is called **tweening**, and the library **GSAP** does it.

**Easing** describes how the change speeds up or slows down. "Linear" is constant speed; "ease-out" starts fast and ends slowly. It makes motion feel natural.

Two words you'll see in the code:

- **`time`**: seconds since the page started. Shaders use it to keep things moving (waves, wind).
- **`dt`** ("delta time"): seconds since the last frame, usually about 0.016. Movement is multiplied by `dt` so it runs at the same speed on a 60 Hz screen and on a 144 Hz screen.

---

# Part B — The tools

## B1. Blender

**Blender** is free 3D software: you build 3D objects, give them materials and light, and render pictures. In this project, **nobody built the objects by hand**. Python scripts (in `blender/scripts/`) tell Blender what to build, how to light it and what to export. Part D explains this.

## B2. File types you'll meet

| Extension | What it is |
|---|---|
| `.blend` | Blender's own project file (`blender/octopyramid.blend`, about 123 MB). The master copy of all 3D work. |
| `.glb` | A 3D model file for the web (the "glTF" format, binary version). It contains meshes: vertices, triangles and attributes. These are what the website loads. |
| `.png` | A normal image. Used for baked colours, detail, normal and roughness maps. |
| `.exr` | A high-precision image that can store very bright values. Used for "environment maps": a 360° photo of the surroundings, used for reflections on the glass. |
| `.mp3` | The music. |
| `.js` | JavaScript code (the website). |
| `.py` | Python code (the Blender scripts). |
| `.mjs` | JavaScript tools run with Node (not in the browser). |

## B3. three.js

**three.js** is a JavaScript library that makes the GPU easy to use. Its main pieces:

| Piece | Plain meaning |
|---|---|
| `Scene` | A container: "the world". You add objects to it. |
| `Mesh` | An object = a **geometry** (the shape: vertices and triangles) + a **material** (how it looks). |
| `Material` | The look of an object. Usually means "a pair of shaders plus their settings". |
| `ShaderMaterial` | A material where **you** write the shaders yourself. Most of this project uses this. |
| `Camera` | The viewpoint ([A7](#a7-the-camera)). |
| `Renderer` | The thing that actually draws the scene with the GPU. |
| `GLTFLoader` | Loads `.glb` files. |
| `Points` | An object drawn as many dots instead of triangles. |

## B4. The other libraries and services

| Name | What it does here |
|---|---|
| **postprocessing** | The filters from [A13](#a13-hidden-pictures-and-filters-post-processing). |
| **GSAP** | Animates numbers over time ([A16](#a16-animating-numbers-over-time)). |
| **lil-gui** | The debug panel with sliders (only when you add `?debug` to the address). |
| **Vite** | A build tool. It runs the site on your computer while you work, and packs it into small files for the internet. |
| **Vercel** | The hosting service the site is uploaded to. |
| **Node.js** | Runs JavaScript outside the browser. Needed for Vite and the tools. Version 22 or newer. |

## B5. Map of the project folders

| Folder / file | What's inside |
|---|---|
| `index.html` | The web page: all the text, buttons and links. |
| `src/main.js` | The starting point: starts everything. |
| `src/config/introConfig.js` | **All the settings**: timings, colours, sizes, speeds. Start here to change things. |
| `src/scene/` | The pyramid scene (hero): camera, pyramid, ground, lines, sand. |
| `src/scene/shaders/` | The shaders for the hero. |
| `src/timeline/` | The intro animation. |
| `src/post/` | The filters, and the sandstorm. |
| `src/transition/` | The scroll engine (turns scrolling into "where am I"). |
| `src/vault/` | Section 2: the crystals and relic pages. |
| `src/rings/` | Section 3: the rings. |
| `src/room/` | The particle room. |
| `src/ui/` | Text effects, the sound volume box. |
| `src/audio/` | Music and generated sound effects. |
| `src/styles/` | CSS (the page's layout and look). |
| `public/assets/` | The 3D models, textures and music that the site downloads. |
| `blender/` | The Blender file and the scripts that make the 3D assets. |
| `tools/` | Helper programs: talk to Blender, take screenshots, trim models. |
| `viewer/` | Test pages for looking at the 3D assets alone (not part of the website). |
| `source-assets/` | Raw inputs: downloaded models, scanned textures, the full soundtrack. |
| `dist/` | The packed, ready-to-upload website (created by `npm run build`). |

---

# Part C — How the website works, piece by piece

## C0. How to read shader code

You'll see small pieces of GLSL (shader code) below. Here's what you need to read it:

| You see | It means |
|---|---|
| `float x = 0.5;` | A number with decimals. |
| `vec2`, `vec3`, `vec4` | A group of 2, 3 or 4 numbers. Used for positions (x, y, z), colours (r, g, b) and UVs (u, v). |
| `p.x`, `p.y`, `p.xz` | Parts of a group. `p.xz` means "just the x and z of p" (a top-down position). |
| `uniform` | A setting from JavaScript ([A12](#a12-how-information-reaches-a-shader)). Usually named `uSomething`. |
| `attribute` | Per-vertex data. |
| `varying` | Passed from the vertex shader to the fragment shader. Usually named `vSomething`. |
| `texture2D(img, uv)` | Read the colour of image `img` at position `uv`. |
| `mix(a, b, t)` | Blend: `a` when t = 0, `b` when t = 1, halfway when t = 0.5. |
| `smoothstep(a, b, x)` | A soft switch: 0 when x is below a, 1 when x is above b, smooth in between. **The most-used word in the project.** |
| `step(a, x)` | A hard switch: 0 or 1. |
| `clamp(x, 0.0, 1.0)` | Keep x between 0 and 1. |
| `floor(x)`, `fract(x)` | Whole part, and decimal part, of a number. Used to cut space into squares. |
| `length(v)`, `distance(a, b)` | How long a vector is; how far apart two points are. |
| `dot(a, b)` | How much two directions point the same way (1 = same, 0 = sideways, −1 = opposite). Used for lighting. |
| `sin(x)` | A wave going smoothly up and down between −1 and 1. Used for anything that pulses or sways. |
| `discard` | Don't draw this pixel. |

## C1. Startup

**Where in the code:** `src/main.js`, the `boot()` function.

When you open the page:

1. **Show the loader.** The `------------` bar is written directly in `index.html`, so it shows before any code runs.
2. **Check the browser.** If it can't do WebGL2 (the GPU feature), or if anything below fails, it shows a **still image** of the pyramid instead (`public/assets/hero_fallback.jpg`), with the same text.
3. **Download the hero files** in parallel:
   - 3 models: the pyramid, the terrain (ground), the background pyramids;
   - 5 baked colour images and 2 detail images.

   In total that is **about 27 MB**. The loading bar shows this progress up to 90%.
4. **Build the pieces** (each is a JavaScript "class" in `src/scene/`): the pyramid, the ground, the golden grid, the sand, the mouse markers. Then the scroll engine, the vault, the rings, the sound.
5. **Pre-compile every shader** (the last 10% of the bar). The first time a GPU meets a new shader it has to translate it, which can freeze the page for a moment. So the code forces every shader to be translated now, while the loader is still showing.
6. **Play the intro.** At the same time, quietly download the vault and rings files in the background, so they're ready when you scroll there.

## C2. The frame loop: what happens 60 times a second

**Where in the code:** `src/scene/IntroScene.js`, the `tick()` function.

Every frame:

1. **Measure time** since the last frame (`dt`).
2. **Check speed.** If frames are too slow, lower the resolution ([C13](#c13-automatic-resolution)).
3. **Ask the scroll engine** where the visitor is ([C14](#c14-the-scroll-engine)).
4. **Draw only what's on screen.**
   - At the top of the page: update the camera, update every hero piece, draw the hero, apply filters.
   - In the vault or rings: draw **only** that section. The pyramid is not drawn at all, which saves a lot of work.
   - During transitions: draw two scenes and mix them.

Each hero piece (pyramid, ground, sand…) follows the same simple pattern of 4 functions:

```js
update(time, dt)   // "a new frame: change your numbers"
resize(w, h)       // "the window changed size"
objects()          // "give me your 3D objects to add to the world"
dispose()          // "the page is closing: free your memory"
```

## C3. The intro timeline

**Where in the code:** `src/timeline/introTimeline.js`. The times are set in `src/config/introConfig.js` (`phases`).

The whole intro is **one GSAP timeline**: a list of "change this number from A to B, starting at second X, lasting Y seconds". Times below are at the current speed setting (`pace: 1.5`):

| Seconds | What you see | Which number changes |
|---|---|---|
| 0 – 0.6 | Glowing dot at the top | `seedIntensity` |
| 0.45 – 1.8 | Golden edges draw down | `wireProgress` 0 → 1 |
| 0.7 – 2.2 | Golden grid spreads, numbers count | `network.progress`, `network.ticks` |
| 1.65 – 2.5 | Light fills the pyramid top to bottom | `uFillY` (the fill line) |
| 2.5 | White flash | `uFlash` up then down |
| 2.6 – 5 | Light fades into stone | `uEnergy` down, `uFinal` 0 → 1 |
| 2.6 – 4.1 | Desert appears | `ground.reveal` (a radius in metres) 0 → 300 |
| 3.7 – 5 | Camera lowers | the camera's 4 numbers ([A7](#a7-the-camera)) |
| 4.6 | Text appears; scrolling is allowed | – |
| 5 – 8 | Blocks start breathing and reacting | `pyramid.live` 0 → 1 |

Because it's all one timeline:

- **Skip** (click or Esc) just means "jump to the end".
- With `?debug`, you get a slider to scrub through it.

## C4. The pyramid: one shader, several looks

**Where in the code:** `src/scene/shaders/pyramidMaterial.js`.

The pyramid changes look during the intro: glowing light, a white flash, then stone. Instead of swapping between different materials (which would cause a visible jump), **one shader calculates every look and blends them** with uniforms:

```glsl
vec3 col = mix(energy, xray, uXray);   // "x-ray" is an old look, no longer used (uXray stays 0)
col = mix(col, physical, uFinal);      // uFinal: 0 = glowing light, 1 = real stone
col += uEnergyColor * (uFlash * 6.0);  // the white flash: add a lot of light
```

What each look is:

1. **The light ("energy") look.** A warm white, 3.2 times brighter than normal white, so the bloom filter makes it glow. A brighter band sits right at the fill line.
2. **The cut-open look.** When the fill line cuts through the pyramid, you can see inside it, because the pyramid is hollow. The inside walls are "back faces" (the inside of the skin). The shader paints them one flat bright colour, so the cut looks like a solid glowing slice:

   ```glsl
   if (!gl_FrontFacing) {   // "if we're looking at the inside of the skin"
     gl_FragColor = bright energy colour;
     return;
   }
   ```
3. **The stone look.** The baked colour from Blender, multiplied by a fine stone grain ([C8](#c8-the-ground-baked-light--detail)).
4. **The gold glow between blocks.** Added only to the **hidden** sides of each block (the sides touching other blocks, the back, the bottom). At rest, you only see a thin gold line in the cracks. When a block pushes out, the gap opens and you see more gold, as if the pyramid glowed from inside.

How does the shader know which sides are hidden? In the **vertex shader**, it uses the block's centre (`_centr`) and the face's direction (`normal`). Roughly: "does this face point outward, and if I step 25 cm out of it, am I outside the pyramid?" If yes, it's an outside face, so no glow.

## C5. The golden lines drawn from the top

**Where in the code:** `src/scene/shaders/drawLines.js`, `src/scene/PyramidModel.js`.

**Problem 1: WebGL can only draw lines 1 pixel thin.** three.js has "fat lines" that draw each line as a thin rectangle made of 2 triangles, so it can be any thickness.

**Problem 2: the lines must "draw themselves".** Each end of each line stores a number from 0 to 1: its distance from the top of the pyramid (0 = at the top, 1 = furthest away). The fragment shader does:

```glsl
if (vDist > uProgress) discard;   // this part of the line isn't drawn yet
float head = smoothstep(uProgress - uHeadWidth, uProgress, vDist);  // the tip is brighter
```

GSAP moves `uProgress` from 0 to 1, so the lines grow from the top, even partway along a line.

**Problem 3: the back lines should be hidden.** The code draws an **invisible copy** of the pyramid first. It writes nothing to the screen, but it fills the depth buffer ([A14](#a14-whats-in-front-depth-transparency-order)). Lines behind it fail the depth test and are hidden. The wireframe then looks like a solid shape.

After the intro, the lines stay very faint as glowing "seams" between blocks, and they move with the blocks.

## C6. The golden grid and its numbers

**Where in the code:** `src/scene/NetworkGrid.js`.

The golden grid on the ground is **not drawn by hand**. It's generated each time the page loads by "random walkers":

- Imagine little robots starting at the pyramid's base, walking outward on a grid of 1.25 m squares.
- At each step a robot might go straight, turn, climb, make a little tent shape, or split into two robots.
- It stops at 520 lines (380 on phones).
- A fixed "seed" makes the randomness the same every time, so the grid always looks identical.

**The numbers** at the corners are tiny squares that read one image containing 32 labels stacked in a column: blanks, `+`, two-digit numbers, `+`. Each corner picks which label to show from the time and its distance from the centre, so the counting ripples outward like a wave.

## C7. The desert appearing

**Where in the code:** `src/scene/shaders/common.js` (`REVEAL_GLSL`), `src/scene/RevealGround.js`.

The desert appears outward from the pyramid in **blocky, irregular steps**. Each pixel of the ground asks "has the reveal reached me yet?":

```glsl
vec2 cell = (floor(xz / 0.8) + 0.5) * 0.8;        // 1. snap my position to a 0.8 m square
float m = length(cell) + fbm(cell * 0.08) * 7.0;   // 2. my distance from the centre + some noise
return uReveal - m;                                // 3. positive = "the reveal has reached me"
```

1. **Snapping to squares** gives the blocky edge: every pixel in a square gets the same answer.
2. **Adding noise** ([A15](#a15-noise-making-natural-randomness)) to the distance makes the shape irregular instead of a perfect circle.
3. **`uReveal`** is the reveal's radius in metres. GSAP grows it from 0 to 300.

Then:

- Pixels not reached yet are **discarded**, so you see the flat sandy background colour behind them.
- Just-reached squares **glow gold** briefly.
- In the **vertex shader**, just-reached ground **rises 5 cm and settles back**: a small "pop".
- The golden grid **fades** wherever the desert has appeared, so the lines seem to *become* the desert.

One shared `uReveal` number drives the ground, the far dunes, the background pyramids and the grid at once.

## C8. The ground: baked light × detail

**Where in the code:** `src/scene/shaders/bakedMaterial.js`, `src/scene/shaders/common.js` (`DETAIL_GLSL`).

The ground's colour comes from a **baked image** ([A8](#a8-light-and-why-we-bake-it)): the sun, the shadows and the pyramid's shadow, all pre-calculated. But one image stretched over a large desert is **blurry up close**. The fix uses two images:

- **The bake**: the light and big colour changes (blurry is fine for those).
- **A small repeating "detail" image**: only tiny grains and specks. Its average colour is exactly mid-grey (0.5).

```glsl
colour = bake * 2.0 * detail;
```

Since `detail` averages 0.5, `2 × detail` averages 1. So from far away you see exactly the bake, and up close you see sharp grain on top. It's cheap and sharp at any distance.

For the stone, the detail image is projected from three directions (front, side, top) and blended by which way the surface faces. This is called **triplanar mapping**, and it needs no UVs. Each block shifts the pattern using its `_rand`, so neighbouring blocks don't look identical.

## C9. Sky and dust haze

**Where in the code:** `src/scene/IntroScene.js` (`buildSky`), `src/scene/shaders/common.js` (`HAZE_GLSL`).

**The sky** is a giant ball (900 m) surrounding the camera, seen from inside. It always moves with the camera, so you can never reach its edge. Its shader paints a gradient: warm near the horizon, blue at the top.

**The dust haze** is low dust floating over the desert. It follows a real physical idea:

- Dust is **thicker near the ground** and thinner higher up.
- So when you look **down** at nearby sand, there's little dust between you and the ground.
- When you look **toward the horizon**, your line of sight skims low over the ground for hundreds of metres and collects a lot of dust.

The shader calculates "how much dust is between my eye and this pixel" with an exact formula, then mixes the pixel's colour toward a dusty colour by that amount. Noise adds drifting patches, and slow waves add gusts.

The haze is applied to the ground, the far dunes, the background pyramids and the sky, but **not** the hero pyramid, so its colours always stay clean.

**A speed trick worth remembering:** the haze noise used to be calculated per pixel, about 100 small calculations each, and that took **half the frame time** on laptops. Now the noise is calculated **once** at startup into a 512 × 512 image (`hazeNoiseTexture()`), and the shader just reads it. That saved **26 ms per frame**.

## C10. The moving blocks: the most important trick

**Where in the code:** `src/scene/BlockMotion.js` (JavaScript), `src/scene/shaders/pyramidMaterial.js` (shader), `src/scene/shaders/common.js` (`BLOCK_GLSL`).

**The problem.** The pyramid has 337 blocks. Each must move and rotate on its own: breathing, pushing away from the mouse, wobbling. But the pyramid is **one mesh**, drawn by the GPU **in one go**. The GPU has no idea where one block ends and the next starts.

**The solution splits the work in two:**

### Step 1: the CPU (JavaScript) decides, once per frame, for each block

For each of the 337 blocks, `BlockMotion.update()` works out:

1. **Breathing.** A wave travels across the pyramid: `sin(x - 2 × time)`. Blocks rise and fall in turn, times a slow overall "breath".
2. **Mouse push.** The mouse position is projected onto an invisible flat sheet just in front of the pyramid. That's simpler and steadier than finding exactly which triangle is under the mouse. Blocks within 0.85 m of that point push out fully; at 2.55 m, not at all.
3. **The bottom stays still.** Blocks low on the pyramid never move, so it keeps its footing.
4. **Smoothing, twice.** The push doesn't jump to its target; it glides there in two stages, so blocks ease out and settle back gently.
5. **A small wobble.** A slight rotation that grows the more the block is pushed.

It writes the results into a **tiny image used as memory**: 32 × 32 pixels, with **3 pixels per block**:

```
pixel 1 of the block: its rotation        (4 numbers: a "quaternion", a way to store a rotation)
pixel 2 of the block: its push            (how far out it has moved)
pixel 3 of the block: its centre          (where the block's middle is)
```

### Step 2: the GPU (vertex shader) moves every corner

For each of the 26,131 corners, the vertex shader:

```glsl
vec4 turn  = blockTexel(_blockid, 0);    // look up MY block's rotation (using my _blockid)
vec4 state = blockTexel(_blockid, 1);    // look up MY block's push

p = _centr * (1.0 + state.y)             // move my block's centre outward
  + quatRotate(turn, position - _centr); // and rotate me around my block's centre
```

In plain words, for each corner:

1. "Which block am I in?" Read `_blockid`.
2. "How far am I from my block's centre?" Compute `position - _centr`.
3. "Rotate that by my block's wobble."
4. "Put it back around my block's centre, which has moved outward."

Since all corners of a block read the **same** pixels, they move together, as one solid block.

### Why not do it another way?

| Other idea | Why it wasn't used |
|---|---|
| Make 337 separate objects | 337 separate drawing jobs instead of 1: much slower. |
| Draw one block shape 337 times ("instancing") | Every block is a different shape, so they can't share one shape. |
| Send the numbers as uniforms | Too many numbers: graphics cards limit how many uniforms one shader can have. |
| **A tiny image as memory** | **16 KB updated per frame, which is nothing. Several shaders can read it.** ✓ |

**One more detail.** When blocks separate, faces that were hidden show up. In the normal bake those faces are dark (they were in shadow, pressed against other blocks). So Blender also baked a second image with the blocks **pulled apart**, and the shader blends toward it on faces that a moving block uncovers.

## C11. The mouse markers ("plexus")

**Where in the code:** `src/scene/Plexus.js`.

When you hover the pyramid, up to 5 thin `+` marks appear on the pushed blocks nearest the mouse. They are linked by faint lines, and each has a 2-digit number (how far its block moved × 50).

- **The `+` marks** are "point sprites": squares always facing the screen. Their fragment shader draws a `+` shape inside the square, rotating it into place as it appears.
- **The numbers** are little flat squares that always face the camera. They read digits 0–9 from one small image of the digits.
- **The pacing:** at most one marker appears and one disappears each frame, which gives the one-by-one effect. Markers only leave while the mouse moves, so it all holds still when you stop.

They're drawn on top of everything, ignoring depth, like a heads-up display.

## C12. Wind-blown sand

**Where in the code:** `src/scene/SandWind.js`.

Everything here moves **only inside the shaders, as a function of time**. JavaScript does no work per frame. There are three layers:

### 1. Wisps: sheets of sand sliding over the ground

- A **second copy of the ground** is drawn on top, mostly transparent.
- Its shader uses noise that slides along the wind direction over time, so it looks like flowing sheets of sand.
- The copy sits at exactly the same spot as the real ground. Two surfaces at the same spot "fight" and flicker, so a small setting (`polygonOffset`) makes the copy always win.
- **Speed trick:** the shader checks cheap things first ("too far away? not revealed yet? no sand here?") and stops early with `discard`, so most pixels never do the expensive noise maths.

### 2. Grains: 6,000 flying sand streaks

- Each grain is **one tiny rectangle** (2 triangles).
- The same rectangle is drawn **6,000 times in one go**. This is called **instancing**.
- The only thing stored per grain is **4 random numbers**. The vertex shader calculates everything else, every frame:
  1. **Where it is along the wind:** start position + speed × time, wrapping around inside an 18 m box.
  2. **How high:** most grains hop low in arcs (real sand moves like this); some float higher as dust.
  3. **The ground height under it:** read from a small height map (an image where brightness = ground height), made from the terrain when the page loads.
  4. **The streak:** it calculates where the grain is now and where it was 16 ms ago, and stretches the rectangle between those two points on screen. That's a cheap motion blur.
  5. **Hidden behind the pyramid?** It checks 16 points along the line from the camera. If any is inside the pyramid, the grain is moved off-screen.
  6. **Its brightness:** read from the ground's baked light under it, so grains get darker in the pyramid's shadow.

### 3. The haze

See [C9](#c9-sky-and-dust-haze).

## C13. Automatic resolution

**Where in the code:** `src/scene/IntroScene.js` (`adaptResolution`). Settings: `performance` in the config.

Phones and cheap laptops can't draw 4 million pixels fast enough. Roughly every 1.5 seconds, the site measures the typical frame time:

- **Too slow** (below 50 fps): draw fewer pixels, e.g. 80% as many per side, and stretch the picture to fit. It looks a bit softer but runs smoothly.
- **Plenty of spare time:** step back up toward full sharpness.
- If a level proved too slow, it waits longer and longer before trying it again, so it doesn't keep flipping back and forth.

## C14. The scroll engine

**Where in the code:** `src/transition/StormTransition.js`.

The page really does scroll: there's a very tall invisible box (`<div id="track">`). But nothing on the page moves with it. Everything visible is pinned in place, and the code **reads** how far you've scrolled to decide what to show.

It measures the scroll in **"screens"**. One screen = 1.4 times the window's height of scrolling (2 times on phones). One full loop is **10.86 screens**:

```
screens   what you see
0         the pyramid (hero)
0 – 0.7   camera pulls back, wind picks up
0.7 – 1.7 the sandstorm covers the pyramid, revealing the vault
1.7       crystal 1 (Tutankhamun)
2.7       crystal 2 (cat)
3.7       crystal 3 (ankh)
3.7 – 4.7 a diagonal "wipe" into the rings
4.7 – 10.2 diving down through the rings (the room is at 8.64)
9.2 – 10.2 the pyramid rises back in from below
10.86     jump silently to the top (the picture is identical) → it loops forever
```

**Smooth gliding.** The scene doesn't jump straight to the scroll position. It follows it in **two smoothing stages**: a "leader" chases the scroll at a limited speed, and the scene chases the leader. Each mouse-wheel click becomes a smooth glide instead of a jerk.

**Snapping.** If you stop halfway through the storm, after about a second it glides to the nearest side. Between crystals, it settles on the nearest crystal. In the rings, a "gravity" pulls you down to the room.

**The camera pull-back** copies the exact camera curve of igloo.inc (the site OctoLith is modelled on), rebuilt from that site's code (`src/transition/exitPath.js`).

## C15. The sandstorm

**Where in the code:** `src/post/SandstormEffect.js`.

The sandstorm is **not** 3D sand. It's **one filter** ([A13](#a13-hidden-pictures-and-filters-post-processing)) that mixes two finished pictures: the pyramid scene and the vault scene (drawn into a hidden picture just before).

For each pixel, the filter:

1. **Is this pixel inside the sand wall?** The wall's top edge rises as you scroll and leans in from the left. Noise makes the edge **billow** like puffy clouds.
2. **Fake 3D lighting:** compare "how deep in the wall" this pixel is with a spot a little toward the sun. If it gets thinner toward the sun, this pixel is on a sunlit bump, so it's lighter.
3. **Deeper inside the wall = darker brown.**
4. **The pyramid picture slides up and the vault picture slides in from below**, while the wall passes.
5. **Grains:** the screen is cut into thin strips, and about 1% randomly show a streak, sliding with the wind.

It costs about 3 ms per frame, and only runs while the storm is on screen.

## C16. Section 2: the vault (the crystals)

**Where in the code:** `src/vault/`.

### Drawing it in two passes

Each frame the vault is drawn **twice**:

1. **First pass, hidden:** draw the dark background and **the relics** (mask, cat, ankh) into a hidden, half-size picture.
2. **Second pass:** draw the background and **the crystals**. Each crystal's shader looks up "what's behind me?" in that hidden picture.

**The relic is never drawn directly.** You only ever see it through the glass.

The vault has **no lamps**. The crystals get their reflections from an "environment map", a 360° image of a studio with soft light boxes (`env_vault.exr`), and the relics show their baked light.

### The glass

The crystal shader starts from three.js's realistic material and changes parts of it:

1. **Refraction (bending light).** Glass bends light. The shader bends the line of sight as it enters the glass, follows it 2 m, and looks up the hidden picture at that spot. So the relic looks distorted, like real glass.
2. **Frost = blur.** Rough, frosted areas read a **smaller, blurrier copy** of the hidden picture. The GPU keeps pre-shrunk copies of images (called **mipmaps**), so this blur costs nothing extra.
3. **Rainbow edges.** Real glass bends red, green and blue light slightly differently. The shader looks up red, green and blue at slightly different spots, which gives faint rainbow edges.
4. **Milky veil.** Frosted areas get a warm, sandy, cloudy tint.
5. **Gold glow** along the edge of the area you've brushed clear, plus a few sparkles.

### Brushing the frost off

**Where in the code:** `src/vault/FrostBrush.js`.

Each crystal has a 512 × 512 hidden image covering its surface (using a second set of UVs made just for this). A brightness value per pixel stores "how clear is this spot". Every step, a small GPU program updates it:

1. **Spread:** each spot takes the highest value of its four neighbours, so a clear area grows a little.
2. **Paint:** spots near the mouse's path (found by casting an invisible line from the camera through the mouse onto the crystal) become clear.
3. **Fade:** everything is multiplied by 0.985, so the frost slowly comes back.
4. **Glowing edge:** spots that became clearer this step are the moving edge, and they glow gold.

The GPU can't read and write the same image at once, so it uses **two images and swaps them** every step. This is called **ping-pong**.

### The labels

The crystal names, dates and lines next to each crystal are **real HTML text**. Every frame, the code calculates where 9 points of the crystal's outline land on the screen, and moves the text and lines there.

## C17. A relic's page

**Where in the code:** `src/vault/VaultDetail.js`, `src/vault/DetailScene.js`, `src/ui/TextTrail.js`.

When you click a crystal:

1. The crystal glides to the centre if it wasn't already there.
2. The camera rushes into the crystal (2.9 m in 1.25 s).
3. The picture **dissolves** into a dark "chamber", with noisy warping and rainbow edges.
4. The text types itself in.

**The chamber** is a second, separate 3D scene: a dark background, a soft shaft of light, glowing dust, and the relic. Moving light ripples over the relic like light through water.

**The text glow under the mouse:** moving the mouse over the text lights up letters along your path and scrambles a ring of letters around it. It's the same "spread + paint + fade" idea as the frost, but done in JavaScript, because it has to change real HTML letters.

## C18. Section 3: the rings

**Where in the code:** `src/rings/`.

### Scrolling controls a timeline

The rings section has a 9.2-second animation (camera falling, rolling, zoom changing, rings flashing) that is **never played**. Instead, the scroll position sets where it is: 0% scrolled = start, 100% = end. Scrolling backward simply plays it backward.

### The rings are built by code, not modelled

**Where in the code:** `src/rings/geometry.js`.

1. Start with a **cross-section shape**: a rounded rectangle, the outline you'd see if you sliced through the ring.
2. **Sweep** that shape around a circle to make a ring, like a potter's wheel.
3. **Cut it into 4–6 pieces** ("shards") along **jagged** lines. Neighbouring pieces use the **exact same cut calculation**, so they fit together perfectly.
4. Give every corner of each piece that piece's **centre** and **3 random numbers**.

### The rings assemble themselves in the vertex shader

The vertex shader looks at **how far the camera is from the ring**:

- **Far away:** each piece is pushed apart, tumbles around its own centre, and the whole ring is tilted and spinning.
- **Getting closer** (7.5 m → 2.5 m): the ring swings flat.
- **Closer** (4.4 m → 2.6 m): the pieces slide together.
- **Very close** (under 2.6 m): the gold glow turns on.

Nothing is stored in JavaScript. It's all calculated from the distance, so it always matches the scroll.

There are extra see-through layers around each ring: a shimmering force-field over the hole that opens like a camera iris, a glowing halo, a swirl of dust, falling sand and walls of blurred text.

### Its own filters

- **Ring flash:** as you pass a ring, the picture smears in a spinning motion with glitchy blocks.
- **The wipe:** the diagonal, cloudy-edged transition between sections. All its noise comes from one small image calculated once at startup.

## C19. The room: 150,000 particles

**Where in the code:** `src/room/`. This is the most advanced part of the project.

- **Each particle is one pixel in an image.** A 388 × 388 image stores 150,000 positions (the colour channels hold x, y, z instead of red, green, blue). A second image stores their speeds.
- **The simulation runs on the GPU.** Each frame, a shader runs once per pixel, which means once per particle, and calculates its new position. Ping-pong again: read the old images, write new ones, swap.
- **What moves each particle:**
  1. a pull toward its "home" spot on the current shape;
  2. a gentle swirl (made from noise, designed so particles don't bunch up);
  3. a push from the mouse, through a small **fluid simulation**: an invisible "water" that the mouse stirs (`FluidSim.js`);
  4. an invisible cylinder wall that keeps them in the room.
- **The shapes** (octopus, Instagram, WhatsApp, mail) are made while the page loads, in a background helper (a **worker**) so the page doesn't freeze. Each icon is drawn flat, turned into a **distance field** (for every point: "how far am I from the shape's surface?"), made thick in 3D, and stored in a 64 × 64 × 64 **3D image**.
- **Drawing:** 150,000 dots. Each dot's vertex shader reads its position from the simulation image.
- **Changing link** gives every particle a new random home on the new shape, so they scatter and re-form.

## C20. The loop back to the start

After the room, the pyramid rises back in from below with the same wipe. Then:

- the camera drops from the sky;
- the pyramid's upper blocks, blown apart, fly back together (`BlockMotion.explode`);
- the corner text types in again.

When it reaches the resting view, the page **jumps to the very top**. The picture is identical, so you can't see the jump, and it all loops. Scrolling up from the top goes around the other way.

## C21. The text effects

**Where in the code:** `src/ui/`, `src/styles/`.

All the text is **real HTML** (not drawn in 3D), so Google, screen readers and copy-paste all work. The effects copy igloo.inc's 3D text effects onto normal text:

- **Typing / scramble effect** (`scrambleText.js`): each letter starts as a different letter and steps back to the right one, while letters fade in from left to right. A hidden plain copy of the text is kept for screen readers. The font is **monospace** (every letter is the same width), so scrambling never makes the text jump around.
- **Logo glitch** (`glitch.js`): the logo is copied several times. Each copy is cropped to a horizontal strip and shifted sideways a little, re-cut 3 times, plus a TV-like flicker.
- **`lockdown.js`** blocks zooming, the right-click menu and developer-tool shortcuts. It is only a deterrent.

If the visitor's computer is set to "reduce motion" (an accessibility setting), the intro jumps to the end, hover effects are off, and the sand and storm don't churn.

## C22. Sound

**Where in the code:** `src/audio/`, `src/ui/SoundMixer.js`.

- **Music** is one MP3 file (`public/assets/audio/music.mp3`, 5.2 MB). Browsers block sound until the visitor clicks or presses a key, so the music only loads after that.
- **Sound effects** (wind, clicks, beeps, hums) are **not files**. They are **generated by code** (`synth.js`) from basic ingredients: random noise, pure tones, and filters that make sounds brighter or duller. A background helper (a worker) builds them, so the animation never stutters.
- **Looping sounds are seamless:** tone pitches are rounded so a whole number of waves fits the loop, and noise loops fade their end into their start, so there's no click when they repeat.
- **Sounds react to the scene:** the wind gets louder with the storm, a hum follows the mouse over the pyramid, a crackle plays while brushing frost, a drone swells near each ring.
- **Right-click the sound button** (long-press on phones) to get two volume sliders: effects and music. The browser remembers them.

---

# Part D — How the 3D files are made in Blender

## D1. The big picture

```
Python scripts ──► Blender builds the objects ──► Blender "bakes" the light into images
                                                          │
                                                          ▼
                              exports .glb models + .png images into public/assets/
                                                          │
                                                          ▼
                          a tool deletes ground nobody can see (trim-world)
                                                          │
                                                          ▼
                                               the website loads them
```

## D2. How the scripts talk to Blender

- Blender runs with an add-on called **blender-mcp**. It listens for messages on your computer (address `127.0.0.1`, port `9876`).
- The command `npm run blender -- exec blender/scripts/10_pyramid.py` reads the Python script and sends it to Blender, which runs it. That's handled by `tools/blender.mjs`.
- Each script saves the Blender file at the end, and the next script continues from it.
- Blender must be open with the add-on running for this to work.

## D3. What each script does, in order

**Scene 1: the desert**

| Script | What it does |
|---|---|
| `00_setup.py` | Sets up Blender's realistic renderer ("Cycles"), the camera, the sun and the sky. |
| `13_detail_textures.py` | Takes scanned sand and stone photos and splits each into a **blurry version** (used for baking) and a **detail-only version** (the grain image the website uses). |
| `11_materials.py` | Creates the stone and sand "materials" (their look), used only during baking. |
| `10_pyramid.py` | **Builds the pyramid** (with help from `pyramid_lib.py`). |
| `20_terrain.py` | **Builds the desert**: a round ground out to 250 m, with sand dunes. |
| `21_landmarks.py` | Builds the background pyramids: one shape, reused 5 times. |
| `30_bake_s1.py` | **Bakes the light** into images ([D5](#d5-baking-in-detail)). |
| `31_envmap.py` | Renders a 360° image of the surroundings (only the test viewer uses it now). |
| `40_export_s1.py` | Saves `pyramid.glb`, `terrain.glb`, `landmarks.glb`. |

**Scene 2: the vault**

| Script | What it does |
|---|---|
| `50_vault_setup.py` | A separate Blender scene with studio lights. |
| `51_crystals.py` | Builds the 3 crystals. |
| `52_vault_materials.py` | The frosted quartz look. |
| `58_sketchfab_relics.py` | Imports the 3 relic models downloaded from Sketchfab. |
| `54_bake_s2.py` | Bakes the crystals' bump and roughness maps, and the relics' light. |
| `55_export_s2.py` | Saves `vault.glb` and `relics.glb`. |

The scripts `53_scarab.py`, `56_logo_relic.py` and `57_falcon.py` built older hand-made relics that are no longer used.

## D4. How the pyramid is built

**Where in the code:** `blender/scripts/pyramid_lib.py`.

- It has the shape of the **Great Pyramid of Giza**: a 51.84° slope, scaled to a 5 m base, in **18 layers** ("courses") of stone.
- Each layer is a ring of stone blocks about 0.4 m long, with **random lengths** so joints don't line up.
- At the corners, which side runs the full length **alternates every layer**, the way real bricklayers do it.
- Each block's outer corners are moved slightly at random ("hand-cut"), some corners are **chipped off**, and edges are slightly **rounded**.
- The inside is **hollow** (only the outer shell of blocks is used).
- For each block, the script stores its **centre** (`_centr`), its **number** (`_blockid`) and a **random number** (`_rand`) on every one of its corners. Those are the custom attributes from [A5](#a5-what-a-vertex-really-holds), used by the website's moving blocks.

**The "up" problem:** Blender's "up" is **z**, the website's is **y**. The exporter fixes positions automatically, but **not** custom attributes. So the script converts `_centr` by hand: `(x, y, z) → (x, z, −y)`.

**Fair sharing of the image:** the pyramid's baked image (2048 × 2048 pixels) has to cover all 337 blocks. The script gives **more pixels to faces the camera sees** (outer faces) and fewer to hidden ones (bottoms, insides). This is called a **texel budget**; a "texel" is a pixel of a texture.

## D5. Baking, in detail

**Where in the code:** `blender/scripts/30_bake_s1.py`.

Blender's realistic renderer, **Cycles**, simulates light physically: rays from the sun bounce around, hit sand, bounce onto the pyramid, and so on. It takes many random samples per pixel (256 to 384 here) to get a smooth result. This is called **path tracing**.

**Baking** = instead of rendering a picture from a camera, Blender calculates the light **on every point of the object's surface** and writes it into the object's texture image, using the UVs ([A9](#a9-textures-and-uvs)).

Rules that follow:

- **Each surface point needs its own spot in the image**, otherwise two places would share one light value. That's why the UV layout is made carefully.
- **Only light that looks the same from every angle can be baked.** Shine and reflections change as you move, so they're left out.

Images baked for the desert:

| Image | Size | What it covers |
|---|---|---|
| `pyramid_color.png` | 2048 × 2048 | the hero pyramid |
| `pyramid_exploded_color.png` | 2048 × 2048 | the pyramid with blocks **pulled apart**, so gaps look right when blocks move ([C10](#c10-the-moving-blocks-the-most-important-trick)) |
| `ground_color.png` | 3337 × 3370 (after trimming) | the ground near the pyramid, including its shadow |
| `far_color.png` | 1658 × 1024 (after trimming) | the far dunes |
| `landmark_color.png` | 1024 × 1024 | the background pyramids |

## D6. Trimming what nobody sees

**Where in the code:** `tools/trim-world.mjs`.

After exporting, this tool deletes every piece of ground that **no camera ever sees**:

1. It replays the website's **real camera movements** (the intro, mouse movement, scrolling away): 1,116 camera positions in total.
2. For each ground triangle, it checks whether it's ever inside any camera's view.
3. It deletes the never-seen ones (keeping a small safety border), and crops the baked images to match.

Result: the ground went from 93,000 to 50,000 triangles, 2 of the 5 background pyramids were removed, and the images got smaller.

**Important:** if the camera movement changes, you must re-export and re-run this tool.

## D7. The crystals and relics

- **Crystals** start as simple shapes (a block, a hexagonal crystal, an obelisk). The script then repeatedly **chops off** the corner that sticks out the most, like chipping a stone tool. This gives natural-looking facets.
- For the crystals, the bake isn't light. It's **surface detail**: a "normal map" (tiny bumps) and a "roughness map" (how frosted each spot is). The website's glass shader uses these live.
- **The relics are downloaded models** from Sketchfab, under the **CC BY 4.0 licence**: you may use them if you credit the authors. Each relic's page on the site has a credit line. **These credit lines are required by the licence: keep them.** The script cleans each model up, reduces the mask from 500,000 to 60,000 triangles, and fits it inside its crystal.

---

# Part E — Practical

## E1. Running the project on your computer

You need **Node.js version 22 or newer**. In a terminal, in the project folder:

```bash
npm install        # download the libraries (once)
npm run dev        # run the site locally → open http://localhost:5199
npm run viewer     # test pages for the 3D assets alone
npm run build      # pack the site into dist/
npm run preview    # view the packed version
npm run deploy     # build and upload to Vercel (the live site!)
```

## E2. Debug switches

These only work with `npm run dev`. Add them to the end of the address, e.g. `http://localhost:5199/?debug`:

| Add to the address | What it does |
|---|---|
| `?debug` | A panel with sliders: scrub the intro, change the camera, filters, block movement. |
| `?debug&t=2.1` | Freeze the intro at second 2.1. |
| `?final` | Skip straight to the end of the intro. |
| `?debug&p=1.7` | Jump to scroll position 1.7 screens (crystal 1). Try `p=1.2` (storm), `p=5` (rings), `p=8.64` (room). |
| `?stats` | Show frames per second (useful on phones). |
| `?mouse=0.1,0.2` | Pretend the mouse is at that spot. |
| `?nowebgl` | Show the still-image fallback. |

## E3. Where to change things

Almost every setting is in **`src/config/introConfig.js`**, with comments. The text and links are in **`index.html`**.

| To change… | Edit this |
|---|---|
| Intro speed | `pace` (bigger = slower; now 1.5) |
| Colours | `colors` |
| Text, links | `index.html` |
| Block breathing and mouse push | `blocks`, `plexus` |
| Sand and dust | `sand` |
| The scroll and storm | `transition` |
| Glass and frost | `vault.glass`, `vault.frost` |
| Rings and room | `rings`, `room` |
| Glow, grain, filters | `post` |
| Performance on weak devices | `performance` |

**Safe things to try while learning** (you can always change them back):

1. Set `pace: 3` and watch the intro in slow motion. Every phase is easier to see.
2. Change `colors.line` to `'#00FFFF'` (cyan) and watch all the golden lines change.
3. Set `blocks.travel: 2` and hover the pyramid: blocks push out much further.
4. Open `?debug` and drag the timeline slider back and forth.

## E4. Problems found while studying the code

**Serious**

1. **No backup or history (no Git).** The project folder isn't under version control. If this disk dies or a file gets overwritten, there's no way back. That includes the 123 MB Blender file, which is the only master copy of the 3D work. **Set up Git** (with **Git LFS** for big files) and push it to a private online repository (GitHub, GitLab…).
2. **Sound may never start on phones.** On a phone, the first finger touch starts the sound system a moment before the browser allows it, and the code never tries again. Test on a real phone. *(Code: `src/audio/Sound.js`, lines 83–94.)*
3. **Re-exporting the ground without re-baking breaks its images silently.** The trim tool would crop already-cropped images. *(Code: `tools/trim-world.mjs`.)*

**Medium**

4. **27 MB must download before the intro starts.** The ground image alone is 9 MB. On a slow phone connection that's a long wait. Compressed image formats could make it much smaller.
5. **Two effects depend on three.js's internal code text** (`drawLines.js`, `crystalMaterial.js`). They search for exact pieces of three.js's shader code and edit them. If you ever update three.js, check that the golden lines and the glass still work: these can break silently.
6. **The relic page isn't fully keyboard-friendly.** A code comment says the browser's Back button closes it and keyboard focus stays inside it. Neither is actually implemented. *(Code: `src/vault/VaultDetail.js`, lines 11–13.)*
7. **Phones simulate all 150,000 particles.** There is a "mobile" setting, but it's never used. *(Code: `src/room/ParticleSculpture.js`, line 303.)*
8. **Frost brushing speed depends on the screen's refresh rate.** Faster screens and slower screens brush differently. *(Code: `src/vault/FrostBrush.js`, lines 106–108.)*

**Small**

9. About 0.7 MB of the 2.4 MB pyramid file is data the website never uses.
10. The README still describes an "x-ray" step that the intro no longer uses.
11. The `post.exposure` setting does nothing.
12. Zooming the page is blocked on purpose, which is bad for people who need bigger text.

---

# Glossary

| Word | Meaning |
|---|---|
| **Additive blending** | Adding a colour on top of what's behind it, so overlaps get brighter. Used for glows. |
| **Anti-aliasing** | Smoothing jagged, staircase-looking edges. |
| **Attribute** | A piece of information stored on each vertex (position, normal, UV…). |
| **Bake / baking** | Calculating light (or surface detail) once in Blender and saving it into an image. |
| **Blender** | Free 3D software used to build the models and bake the light. |
| **Bloom** | A filter that makes bright things glow. |
| **Camera** | The virtual viewpoint the 3D world is seen from. |
| **CPU** | The computer's main processor. Runs JavaScript. One smart worker. |
| **Depth buffer / depth test** | The GPU's memory of how far away each pixel's content is, so closer things hide farther ones. |
| **Discard** | A shader command: don't draw this pixel. |
| **Distance field** | For every point in space: how far it is from a shape's surface. |
| **dt (delta time)** | Time since the last frame, usually about 0.016 s. |
| **Easing** | How an animation speeds up and slows down. |
| **Environment map** | A 360° image of surroundings, used for reflections. |
| **fbm** | Several layers of noise stacked: big shapes with small details. |
| **Field of view (FOV)** | How wide the camera sees; the zoom. |
| **Fragment shader** | A GPU program that decides the colour of each pixel. |
| **Frame** | One picture of the animation. The site aims for 60 per second. |
| **GLB / glTF** | A 3D model file format for the web. |
| **GLSL** | The programming language shaders are written in. |
| **GPU** | The graphics card: thousands of simple workers drawing in parallel. |
| **GSAP** | A JavaScript library that animates numbers over time. |
| **HDR** | Brightness values above normal white, later squeezed by tone mapping. |
| **Hero** | The big first view of a website: here, the pyramid. |
| **igloo.inc** | The award-winning website OctoLith copies and re-themes. |
| **Instancing** | Drawing the same small shape many times in one go (e.g. 6,000 sand grains). |
| **Material** | How an object looks: a pair of shaders plus their settings. |
| **Matrix** | A fixed recipe of multiplications that moves points from one space to another. |
| **Mesh** | A 3D object made of triangles. |
| **Mipmaps** | Pre-shrunk, blurrier copies of an image the GPU keeps, used for distance and cheap blur. |
| **Noise** | Smooth, natural-looking randomness made by a formula. |
| **Normal** | An arrow pointing straight out of a surface. Used for lighting. |
| **Normal map** | An image that stores tiny surface bumps as directions. |
| **Path tracing** | Realistic light simulation by bouncing many random light rays. Used by Blender's Cycles. |
| **Ping-pong** | Using two images and swapping them each step, because the GPU can't read and write one image at once. |
| **Pixel** | One coloured dot on the screen. |
| **Post-processing** | Filters run over the finished picture (glow, blur, colour…). |
| **Quaternion** | A way of storing a rotation as 4 numbers. |
| **Rasterizing** | The GPU filling in a triangle with pixels. |
| **Render** | To draw a picture of the 3D scene. |
| **Render target** | A hidden picture drawn into instead of the screen. |
| **Roughness** | How frosted/matte (high) or shiny (low) a surface is. |
| **Scene** | The container holding all the 3D objects. |
| **Screen (scroll unit)** | This project's scroll unit: 1.4 window heights of scrolling. |
| **Shader** | A small program that runs on the GPU. |
| **SMAA** | The anti-aliasing method used here (cheaper than the usual MSAA). |
| **smoothstep** | A soft on/off switch between two values. |
| **Texel** | A pixel of a texture. |
| **Texture** | An image wrapped onto a 3D object, or used to store data. |
| **three.js** | The JavaScript library that makes using the GPU easier. |
| **Timeline** | A list of timed animations played (or scrolled) together. |
| **Tone mapping** | Squeezing very bright values into what a screen can show. |
| **Triangle / face** | The flat surface between 3 vertices. |
| **Triplanar mapping** | Projecting a texture from 3 directions and blending, so no UVs are needed. |
| **Tween** | An animation of one number from A to B. |
| **Uniform** | A setting sent from JavaScript to a shader, the same for the whole object. |
| **UV** | A position on a texture image (U across, V up), stored on each vertex. |
| **Varying** | A value passed from the vertex shader to the fragment shader, blended across the triangle. |
| **Vertex (vertices)** | A corner of a triangle, carrying attributes. |
| **Vertex shader** | A GPU program that decides where each vertex goes on screen. |
| **Vite** | The tool that runs and packs the website. |
| **WebGL** | The browser feature that lets web pages use the GPU. |
| **Worker** | A background helper in the browser, so heavy work doesn't freeze the page. |
| **World space** | Positions in the shared 3D scene, in metres. |
