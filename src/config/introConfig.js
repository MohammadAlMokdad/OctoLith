// Everything tweakable about the intro lives here. Phase times are seconds on
// the master timeline (before 'pace' is applied), which starts the moment the
// loader has collapsed.
// Colours are CSS strings; angles are degrees; distances are metres (the hero
// pyramid is 5 m wide).
export const INTRO_CONFIG = {
  assets: {
    // Swap the hero model here, e.g. '/models/octolith.glb' (file in public/models/).
    // Our pipeline's GLB carries PYR_Blocks + PYR_Edges; any other GLB is
    // auto-centred, scaled to a 5 m base and gets generated edges.
    pyramid: '/assets/models/pyramid.glb',
  },

  colors: {
    scanBg: '#A99479', // flat warm sand behind the golden scan (also the loader background)
    scanBgTop: '#B8A487', // slightly lighter toward the top
    line: '#FFD37E', // golden wireframe / network / dots / seed glow
    energy: '#FFF1D4', // warm white of the energy fill and the flash
    revealBand: '#FFD37E', // cells lighting up at the front of the world reveal
    xrayBody: '#3B2D1F', // dark bronze body of the x-ray look
    xrayRim: '#FFD98F', // golden fresnel rim of the x-ray look
    horizon: '#E6C9A8', // warm world after the reveal
    zenith: '#8B9FC6',
    seamGlow: '#FFD8A0', // faint warm glow left in the block seams
    // Corner UI (igloo's scheme: white glowing text and logo, dark title
    // lines). The old dark-text look was ui '#221A12' with no glow.
    ui: '#FFF8EE', // logo and corner text (it glows: --logo-glow / --text-glow in base.css)
    uiTitle: '#4A3524', // the dim title lines: "// Copyright", "////// Manifesto"
    uiLight: '#F1D3A1', // section 2's labels and the relic pages
    glow: '#FFB24D', // live hero gold (igloo's ice blue): the block joints, the core in the gaps, the sand
    plexus: '#FFFFFF', // hover markers, links and numbers (drawn additively)
    sand: '#F3DDB2', // wind-blown grains and ground wisps
    haze: '#E3C8A2', // the low dust blowing across the desert
    // Sandstorm transition into section 2 (see `transition`)
    stormLight: '#F1D3A1', // sunlit tops of the billowing dust wall
    stormMid: '#C08A52', // the body of the wall
    stormDeep: '#5E3B20', // deep inside it
    stormHaze: '#B98E62', // the dust haze as the storm closes in
    sectionInner: '#6B4A30', // section 2's backdrop: warm dusty centre...
    sectionOuter: '#120B07', // ...to dark edges (the vault viewer's backdrop)
    frostRim: '#FFC86B', // the glowing edge of a patch of brushed-off frost (igloo's ice blue)
    hud: '#F1D3A1', // the vault's labels and lines
    // A relic's page (igloo: #67707E titles, #A1AAB7 text, lit to #CCCCCC
    // under the pointer): dimmer than the labels so the pointer trail shows.
    pageTitle: '#7D6A52', // "////// Summary", "/// Discover", ...
    pageText: '#BCA47E', // the summary and the links
    pageLit: '#FFF1D6', // letters lit up by the pointer trail
  },

  // Multiplies every phase time below (and the fixed fades in the timeline):
  // 1 = the fast ~6 s cut, 1.5 = ~9 s. Bigger = slower. (The user has asked
  // both ways: 1.6 "slower", 2.1 "so slow", then 1.7; 1.5 since 2026-10-02,
  // "faster a bit".)
  pace: 1.5,

  phases: {
    seed: { start: 0.0, duration: 0.4 }, // B: glowing point at the apex
    wire: { start: 0.3, duration: 0.9 }, // C: wireframe drawn from the apex
    network: { start: 0.45, duration: 1.0 }, // C: grid spreading across the ground
    fill: { start: 1.1, duration: 0.55 }, // D: energy fill sweeping apex -> base
    flash: { start: 1.65, duration: 0.12 }, // D: white flash when the fill lands
    // D: the flash dies down and the glow starts fading, straight into the
    // finished stone (no hologram in between; 2026-10-02): the fade runs from
    // here to the end of the settle. 'duration' only times the flash's tail.
    fade: { start: 1.72, duration: 0.4 },
    points: { start: 1.6, duration: 0.35 }, // E: dotted patch under the pyramid
    // E: stepped world reveal (the lines becoming the world). 1.3 lingered:
    // the user asked for it and the x-ray hold before the settle to be a bit
    // faster (2026-10-02), so 1.0, and the settle 0.25 earlier.
    reveal: { start: 1.75, duration: 1.0 },
    settle: { start: 2.45, duration: 0.9 }, // F: the glow's fade ends here (stone), CA/bloom rest
    ui: { start: 3.05, duration: 1.3 }, // G: corner UI scramble
    scroll: 3.05, // the page can scroll from here (the world has settled); the rest plays on
    total: 5.85, // camera orbit/dolly span; idle hero after this
  },

  camera: {
    fov: 30,
    target: [0, 0.35, 0], // look-at during the scan (below centre -> pyramid sits above middle)
    // Blueprint phases: high 3/4 view, slow orbit + gentle dolly-in.
    scan: { azimuth: 115, elevation: 38, distance: 21.5 },
    scanEnd: { distance: 17.5 },
    // Hero: the camera descends at the settle so the horizon, dunes and the
    // distant pyramids come into frame (30 deg FOV needs <= ~11 deg pitch).
    // Closer than it was (distance 20 at fov 30, 2026-10-02: the user asked for
    // the pyramid nearer with the background unchanged): the camera moves in
    // along its line of sight and the lens widens a touch, which holds the
    // three background pyramids within ~3 px of where they were (at 1707 x
    // 1067) while the hero pyramid grows ~32 %. The fov eases from `fov` to
    // this during the descent.
    hero: { azimuth: 133, elevation: 9.5, distance: 15, targetY: 1.35, fov: 30.74 },
    // Where the hero camera ends up as the page scrolls on into section 2:
    // igloo's own pull-back (x1.41 distance, ~10 deg orbit) mapped onto our
    // hero. tools/trim-world.mjs keeps everything any of these cameras sees.
    exit: { azimuth: 123.2, elevation: 8.5, distance: 28.1, targetY: 1.1 },
    // Screens wider than this keep this aspect's horizontal field of view
    // (zooming in a little) instead of seeing past the trimmed world's edge.
    maxAspect: 2.4,
    // Screens narrower than this (portrait phones) keep this aspect's
    // horizontal field of view: the lens widens so the pyramid fits the width
    // instead of filling the screen with its sides cut off (src/scene/fitFov.js).
    minAspect: 0.9,
    parallax: 1.2, // degrees of orbit per unit of mouse offset
    idleDrift: 1.5, // degrees of slow idle sway
  },

  // The scan's line network (src/scene/NetworkGrid.js). 'cage' is igloo's
  // intro look: lines on a 3D lattice, grown out of the pyramid's base so
  // every piece links back to it, with numbers ticking at its corners
  // (igloo: ~820 lines on a 2 m lattice, 252 numbers, out to ~16 m around a
  // ~6 m igloo). 'walks' brings back the earlier flat circuit.
  network: {
    layout: 'cage',
    lineWidth: 1.25, // px
    cage: {
      segments: 520,
      segmentsMobile: 380,
      radius: 16, // how far it spreads from the pyramid centre (m)
      cell: 1.25, // lattice cell (m): half the base's half-width, so the base edges are lattice lines
      levels: [0, 1], // lattice levels (cells above the ground) the lines may use
      alpha: [0.55, 1.0],
      intensity: 1.15, // brighter than igloo's: our sand is lighter than its grey
      twinkleDepth: 0.4, // every piece pulses (igloo 0..1; 0.2..1 here)
      distanceFade: [0.75, 1.0], // soft outer edge (igloo's 5 m on 20)
    },
    // igloo's intro numbers at the cage's corners
    numbers: {
      count: 80,
      countMobile: 55,
      size: 0.017, // of the screen height (igloo 0.01, on a darker background)
      offset: 0.1, // m beside the corner
      perMeter: 1, // cells a corner lags per metre from the centre
      ticks: 52, // cells stepped at the centre over the scan (32 cells + the radius: all end blank)
      alpha: 0.9,
    },
    walks: {
      segments: 520,
      segmentsMobile: 200,
      radius: 13,
      grid: 0.5, // grid snap (m)
      maxLift: 1.5, // some walks float up to this height
      liftChance: 0.25,
      alpha: [0.25, 0.8],
      twinkleChance: 0.08,
      intensity: 0.85,
      twinkleDepth: 0.45,
      distanceFade: [0.3, 1.0],
      nodeSize: 2.5, // px
    },
  },

  wire: {
    lineWidth: 1.25, // px
    headWidth: 0.05, // width of the hot band at the drawing front (0..1 of aDist)
    headBoost: 3.0, // how much brighter the head is than the line
    seamGlow: 0.08, // resting opacity of the warm seam lines in the hero (0 = off)
  },

  reveal: {
    cellSize: 0.8, // quantised reveal cells (m) -> stepped, voxel-like edge
    noiseAmount: 7.0, // how irregular the expanding blob is (m)
    noiseScale: 0.08, // fbm frequency on cell coords: lower = bigger lobes
    bandWidth: 0.7, // how long a freshly revealed cell stays lit (m of front travel)
    pop: 0.05, // newly revealed cells rise this much then settle (m)
    nearRadius: 20, // first leg: the on-screen area around the pyramid (m)
    nearShare: 0.85, // share of the reveal duration spent on the first leg (the part you see)
    nearEase: 'none', // steady, so the lines turn into the desert at an even pace across the screen
    maxRadius: 300, // reveal ends beyond the far terrain
  },

  // ---------------------------------------------------------------- live hero
  // igloo.inc's block behaviour with its own numbers (read from their
  // production build), in gold instead of ice blue. It fades in as the stone
  // settles. A block moves out along its centroid (seen from the base centre)
  // to centroid * (1 + push * travel); follow rates are per 60 fps frame.
  blocks: {
    // How far blocks move out, as a fraction of igloo's (1 = igloo's own
    // numbers). Our bricks are smaller than igloo's blocks, so they open up a
    // lot at 1; 0.7 gives a big breath and hover that still reads as a pyramid.
    travel: 0.7,
    pulse: 0.4, // idle swell: peak push of a wave along +x, sin(x - 2t), under a slow cos(t)
    hover: 0.5, // push at the mouse point...
    hoverJitter: 0.3, // ...drifting by up to +- this per block
    // Full push within 0.85 m of the mouse point, none beyond 2.55 m: igloo's
    // 1 - 3 m scaled to our smaller pyramid so the same share of it reacts.
    hoverRadius: [0.85, 2.55],
    planeOffset: 0.55, // the mouse point lies on a camera-facing plane this far in front of the target (m)
    lock: [0.45, 0.7], // blocks centred below 0.45 m stay put; full motion above 0.7 m
    smoothing: 0.06, // follow rate of the push (applied twice: eases out, settles back)
    spin: 0.5, // wobble while out: radians per unit of push
    explodedBake: 5, // a moving block blends to the exploded bake at push x 5
    // Each block glows gold from inside (never on its front or its visible
    // step): the joints light up with an idle wave along +x, and the gaps
    // brighten as blocks push out.
    blockGlow: 1,
    groundGlow: 0.6, // sand around the base glowing with the pulse wave
    mouseGlow: 2, // sand glowing under the mouse point (igloo's 1 barely shows on sand)
  },

  // igloo's hover plexus: markers on the pushed-out blocks nearest the mouse,
  // each linked to its nearest neighbours, with a 2-digit readout of how far
  // the block has moved (metres x 50). Markers come and go one at a time.
  plexus: {
    maxPoints: 5,
    maxLinks: 2,
    inTime: 0.1, // s for a marker / line to appear
    outTime: 0.06, // s to disappear
    minPush: 0.1, // only blocks pushed at least this much
    reach: 2, // m from the mouse point (pulled 1 m toward the camera)
    lineOpacity: 0.25,
    markerOpacity: 0.5,
    markerSize: 200, // px at 1 m for a 1300 px tall viewport
    numberSize: 0.08, // m for a 1300 px tall viewport (at most 0.1)
  },

  // Scrolling from the hero into section 2, in screens of scroll (igloo's own
  // proportions): the camera pulls back to camera.exit while the wind picks
  // up (pull), then a wall of sand rolls in from the bottom-left and thins out
  // into section 2 (storm). Stopping mid-storm snaps to the nearest side.
  transition: {
    pull: 0.7, // screens of pull-back before the wall arrives
    storm: 1.0, // screens the wall takes to cover the hero and clear into section 2
    // Scrolling (slowed and smoothed at the user's request, 2026-10-02): one
    // screen of the experience takes this many window heights of page scroll
    // (1 was a screen per window height: a wheel notch moved ~0.1 screens;
    // igloo's 0.075, ours now ~0.07 at 1067 px).
    scrollLength: 1.4,
    // On touch screens: a flick carries the page a long way on its momentum,
    // and at 1.4 one flick went through the whole vault.
    touchScrollLength: 2,
    // igloo's two-stage follow: a lead chases the scroll (rate 1/s, capped at
    // maxSpeed screens/s), the scene eases after the lead (rate 1/s). igloo:
    // 0.075 and 0.15 per 60 Hz frame, cap 0.075 per frame. Was one stage at 6.
    smoothing: [4.7, 9.75],
    maxSpeed: 4.5,
    snapAfter: 1.2, // s without scrolling before a half-way storm snaps
    snapTime: 0.9, // s the snap takes
    windUp: { haze: 3.5, wisps: 1.2, grains: 0.8 }, // extra dust at the end of the pull (x the base)
    wind: 0.55, // speed the wall's billows and streaks race along (screens/s)
    parallax: 0.4, // the hero slides up / section 2 in from below by this much (igloo's 0.4)
    fringe: 0.006, // chromatic aberration along the front (uv)
  },

  // Section 2, the relic vault (igloo's showcase cubes): one sand-frosted
  // quartz crystal per screen of scroll, the relic inside seen only through
  // the glass. Scroll positions continue from the storm: crystal i is centred
  // at transition.pull + transition.storm + i screens.
  vault: {
    relics: [
      // crystal mesh (vault.glb), relic mesh (relics.glb), relic bake, crystal maps; the HUD copy is in index.html.
      // The relics are Sketchfab models (CC BY 4.0, credited on their pages), set up by blender/scripts/58_sketchfab_relics.py.
      { crystal: 'CRY_1', relic: 'RELIC_Tut', bake: 'tut', maps: 'cry1' }, // Tutankhamun's mask
      { crystal: 'CRY_2', relic: 'RELIC_Cat', bake: 'cat', maps: 'cry2' }, // a bronze cat of Bastet
      { crystal: 'CRY_3', relic: 'RELIC_Ankh', bake: 'ankh', maps: 'cry3' }, // an ankh
    ],
    spacing: 5.75, // m between crystals (igloo's): only one is ever on screen
    camera: { fov: 45, z: 4.3, sway: [0.1, 0.05], minAspect: 0.8 }, // sway: mouse parallax (m), like igloo's (z 5, for bigger cubes); minAspect: as camera.minAspect, so the labels fit beside the crystal on phones
    spin: [11, 14, 6], // radians of y / x / z turn per unit of scroll progress away from centre (igloo's)
    wobble: 0.1, // idle rotation (rad)
    glass: {
      tint: '#F4EBDD', // warm quartz (igloo: #e0e8ef ice)
      roughness: 0.62, // x the baked frost roughness
      ior: 1.2,
      thickness: 2.0, // refraction depth (m)
      dispersion: 0.08, // chromatic split of the refraction
      envIntensity: 0.9,
      frostVeil: 1.25, // how milky the sand frost makes the glass (x roughness)
      frostColor: '#C9A47A', // the frost's own warm, scattered light
    },
    // Brushing the sand frost off: the clear patch grows a little, then
    // frosts over again (igloo's damping 0.985 per frame).
    frost: { size: 512, radius: 0.05, damping: 0.985 },
    snapAfter: 1.4, // s still before the scroll settles on the nearest crystal
    // "Click to explore" (igloo's project page): the camera rushes into the
    // crystal while the picture dissolves through sand-frost displacement and
    // spectral fringing into a dark chamber where the relic lies in moving
    // light, and the summary scrambles in. igloo's timings.
    detail: {
      zoom: -2.9, // m the camera rushes in (igloo: -3.5 from z 5)
      // A crystal can be clicked while it is still on its way in or out:
      // within this many screens of the centre (igloo: 2 m of its 5.75 m
      // spacing). The page then glides it to the centre first (up to
      // centring s, igloo's expo-out of the distance) and starts opening
      // half-way through the glide.
      clickRange: 0.35,
      centring: 1.5,
      open: { dissolve: 1.25, settle: 1.25, settleDelay: 0.75 }, // s
      close: { dissolve: 1.25, settle: 0.6, zoom: 1.45 }, // s
      camera: { fov: 45, from: 4, to: 2.5, x: 0.6, minAspect: 0.7 }, // the chamber's dolly-in; the relic sits right of centre, behind the text (centred on portrait screens, where the text takes the whole width)
      bg: ['#0B0705', '#6E5236'], // dark diagonal gradient (igloo: #09121f -> #6b7685)
      light: '#FFDDA6', // light shaft, light pool, caustics and dust (igloo: #d1e3ff)
      // The page's text under the pointer (igloo's project-page mouse sim;
      // src/ui/TextTrail.js): letters along the pointer's path light up and a
      // ring of scrambled letters spreads out from it, fading as it goes.
      trail: {
        cell: 5, // device px per sim cell (igloo: screen / 5); spreads 1 cell per igloo step (66 Hz)
        damping: 0.985, // per igloo step: lit for ~0.5 s, the ring fades over ~2 s
        radius: 0.05, // splat radius at full pointer speed, share of the screen height
        light: [0.6, 0.8], // trail values from which / at which a letter is fully lit
        scramble: 5, // glyph shift at the strongest front (igloo: fit(g, 0.01, 1, 0, 5))
        steps: 5.654, // glyph shift scale of igloo's project text
        margin: 160, // px of sim around the text panel (the trail can start off the text)
      },
    },
  },

  // Section 3, the rings (igloo's "entry" scene): from the last crystal it
  // comes in over one screen, then the camera descends through the rings for
  // `height` screens to the room at the bottom. Scroll progress p in section 3
  // = screens past the last crystal / (height + 1), as igloo's.
  rings: {
    height: 5.5, // screens of descent (igloo's)
    // igloo's autocenter, "gravity": stop scrolling for `idle` s and
    //   - half-way through the wipe in: back to the last crystal (< 0.5 screen
    //     in) or on to `initial` (each `edge` s, +2 s per screen beyond the edge);
    //   - anywhere past `pullFrom`: glide to the room at `final`, `perScreen` s
    //     per screen away (clamped to `minTime`..`maxTime`) on igloo's inOut3
    //     curve: it barely moves at first, rushes through the rings, then
    //     settles slowly.
    autocenter: { idle: 1.4, initial: 0.2, final: 0.76, pullFrom: 0.15, edge: 2, perScreen: 4, minTime: 2, maxTime: 20 },
    // The loop, igloo's: section 3's last screen is the hero rising in from
    // below; scrolling on, the hero arrives (the camera drops out of the sky,
    // the blocks fly back together) and settles at its rest, which is the top
    // of the page again: the page jumps there unseen and it all goes round.
    // Scrolling up from the top goes the other way.
    loop: {
      arrival: 0.658, // screens from the hero alone to its rest (igloo: (0.495 - 1/3.35) x 3.35)
      ui: [-1.0, -0.82], // the corner text: gone until here, back by here (screens before the rest; igloo: its progress .15 / .25)
    },
    // igloo's cold slate haze and ice-blue light, in our desert palette
    colors: {
      bgDark: '#5A3D26', // the haze, dark end (igloo: #6a6f7d)
      bgLight: '#D9BC8E', // the haze, light end (igloo: #e1e6f1)
      glow: '#FFC677', // ring inlay, seams, membranes, plasma, floor grooves (igloo: ice blue)
      light: '#FFF1D6', // key light, dust specks, the room light
      dust: '#F3DDB2', // smoke arms, the shaft's dust wall, falling sand
      glare: '#FFD9A0', // the corner glare
    },
  },

  // Section 4, the room at the bottom of the rings: a particle sculpture of
  // the current link (igloo's footer). The links (titles, urls, shapes) are
  // in index.html #room-links.
  room: {
    particles: 150000, // igloo's
    volumeSize: 64, // each shape's distance field, 64³ (igloo's)
    lightPos: [-0.75, 1, -0.1], // igloo's
    // igloo's slate particles (dark #222b42, light #bdc6d4, fast #d7ebfa,
    // fading in through #b5d5ff) in our palette: bronze to sand, gold glow
    colors: {
      dark: '#382A1E',
      light: '#DCC59F',
      fast: '#FFEBC2',
      glow: '#FFC677',
    },
    arrows: '#FFF8EE', // the arrows beside it (the UI colour)
  },

  // Wind-blown sand crossing the hero view from left to right (fades in as
  // the world settles). Heading 0 = along the hero camera's screen-right.
  sand: {
    windYaw: 0, // degrees added to that heading
    grains: 6000, // airborne grains (desktop)
    grainsMobile: 2000,
    speed: 2.5, // m/s, varied per grain (x0.55 - x1.45)
    box: [18, 14], // half extents around the pyramid: along / across the wind (m)
    saltation: 0.85, // share of grains hopping low over the sand; the rest float as dust
    hop: [0.02, 0.3], // hop heights (m), most of them low
    hopRate: [0.5, 1.4], // hops per second (long, flat hops)
    dust: [0.3, 2.5], // dust heights (m)
    size: [1.0, 2.4], // grain width (px at DPR 1)
    trail: 0.016, // streak length in seconds of travel (about one frame of motion blur)
    opacity: 0.65,
    wisps: 1.3, // strength of the sheets of sand flowing over the ground
    wispSpeed: 3.2, // m/s
    haze: 0.05, // density of the low dust blowing across the desert
    hazeHeight: 1.4, // m: the dust thins out with height on this scale
    hazeSpeed: 4.5, // m/s: how fast its patches drift downwind
  },

  post: {
    bloomThreshold: 0.75,
    bloomRest: 0.55,
    bloomPeak: 3.2, // at the white flash
    caRest: 0.0008,
    caPeak: 0.004,
    grain: 0.04,
    vignette: 0.32,
    toneMapping: 'ACES_FILMIC', // or 'NEUTRAL' / 'AGX' / 'LINEAR'
    exposure: 1.0,
  },

  performance: {
    maxDpr: 1.5,
    // Phones and tablets. At 1x a phone's 3x screen showed the scene blurred,
    // stretched three times over (the user, 2026-10-02). 2x is sharp at about
    // 2.3x the GPU cost of 1x (hero: 4.6 ms vs 2.0 ms on the Intel iGPU in a
    // phone-sized window), well inside a frame. mobilePixels caps the total, so
    // a tablet's big screen gets a lower ratio than a phone's.
    mobileDpr: 2,
    mobilePixels: 2.1e6,
    mobileBloomScale: 0.5,
    // Adaptive resolution: when frames stay slower than minFps (median over
    // ~1.5 s), render at dprStep x the pixel ratio (two steps when under 2/3
    // of minFps), down to minDpr. With 25 % headroom it steps back up toward
    // the cap. On a 60 Hz screen, where frames can't show headroom, it tries a
    // step up after 3 s of every frame on time with the page at rest. A ratio
    // that was too slow is skipped for twice as long each time. Off with
    // ?debug, ?clean or ?dpr=<n> (which pins the ratio).
    minFps: 50,
    dprStep: 0.8,
    minDpr: 0.75,
  },

  playOncePerSession: false, // true: skip straight to the hero on repeat visits
  sessionKey: 'octolith-intro-seen',

  // Most copy lives in index.html (real DOM text for SEO/screen readers).
  // These are only the strings the script swaps in at runtime.
  copy: {
    soundOn: 'On',
    soundOff: 'Off',
  },

  ui: {
    stagger: 0.18, // seconds between corner blocks appearing (scaled by pace)
  },

  // Sound (src/audio): igloo's controller with our soundtrack and our own
  // synthesized effects. Muted until the first click / tap / key, then it
  // comes on by itself (like igloo); the corner toggle mutes it.
  audio: {
    // source-assets/audio/OctolithBGMusic.mp3, 45:45-51:25 (one whole track), looped; faded 0.4 s
    // in and 1.5 s out so the loop point is soft
    music: '/assets/audio/music.mp3',
    // music: igloo's 0.2, lowered ~3 dB at the user's request (2026-10-02);
    // room: igloo's. The effects keep igloo's volumes (Sound.js).
    volumes: { music: 0.14, room: 0.45 },
    effects: 1, // scales every effect and loop together
  },
};

// Effective phase times in seconds: cfg.phases scaled by cfg.pace.
export function pacedPhases(cfg) {
  const k = cfg.pace ?? 1;
  const out = {};
  for (const [name, v] of Object.entries(cfg.phases)) {
    out[name] = typeof v === 'number' ? v * k : { start: v.start * k, duration: v.duration * k };
  }
  return out;
}
