// Keeps the page to the experience on desktops (touch screens are handled in
// base.css: touch-action pan-y):
//   - no browser zoom: Ctrl / Cmd + wheel (a trackpad pinch arrives as one),
//     Safari's pinch gestures, Ctrl / Cmd + = + - 0 (and the numpad's)
//   - no developer tools from the keyboard: F12, Ctrl+Shift+I / J / C / K / E
//     / M (Chrome, Edge, Firefox), Cmd+Opt+I / J / C / U and Cmd+Shift+C (Mac),
//     Ctrl / Cmd + U (view source); and no right-click menu (Inspect)
// A deterrent only: the browser's own menus can still zoom and open the
// developer tools, and no page can stop that.
const ZOOM_CODES = ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'];
const ZOOM_KEYS = ['=', '+', '-', '_', '0'];
const DEVTOOLS_CTRL_SHIFT = ['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyE', 'KeyM'];
const DEVTOOLS_CMD_OPT = ['KeyI', 'KeyJ', 'KeyC', 'KeyU'];

function isBlockedKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'F12') return true;
  if (mod && !e.altKey && (ZOOM_CODES.includes(e.code) || ZOOM_KEYS.includes(e.key))) return true;
  if (e.ctrlKey && e.shiftKey && DEVTOOLS_CTRL_SHIFT.includes(e.code)) return true;
  if (e.metaKey && e.altKey && DEVTOOLS_CMD_OPT.includes(e.code)) return true;
  if (e.metaKey && e.shiftKey && e.code === 'KeyC') return true;
  if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyU') return true;
  return false;
}

// Capture phase on window: before any of the page's own handlers.
window.addEventListener(
  'keydown',
  (e) => {
    if (!isBlockedKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
  },
  { capture: true },
);

// Not passive (it has to cancel the zoom); a ctrl-wheel never reaches the
// scroll handlers either, since it scrolls nothing.
window.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
  },
  { capture: true, passive: false },
);

// Safari's trackpad pinch (and iOS's, where viewport user-scalable is ignored).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
