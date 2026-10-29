#!/usr/bin/env node
// Drive the page in headless Edge over the DevTools protocol, in REAL time
// (tools/shot.mjs uses virtual time, which can't move a mouse): navigate,
// wait, move the mouse along paths, evaluate JS, take screenshots. For
// checking the live hero's hover and plexus.
//   node tools/drive.mjs script.json
// script.json: { "url": "http://localhost:5199/?final&debug", "size": [1600, 900],
//   "steps": [ {"wait": 9000}, {"move": [800, 420]}, {"path": [[x, y], ...], "ms": 3000},
//              {"eval": "js expression (promises are awaited)"}, {"shot": "out.png"} ] }
// With ?debug the page exposes window.__intro (scene, pyramid, plexus, ...).
// SwiftShader renders only a few frames per second: wait generously.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const [W, H] = script.size ?? [1600, 900];
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-'));
const edge = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = spawn(edge, [
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`,
  '--hide-scrollbars',
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    // browser still starting
  }
}
if (!target) throw new Error('no page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!/\[vite\]|deprecated|KHR_parallel/.test(text)) console.log(`[console.${msg.params.type}]`, text.slice(0, 400));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', msg.params.exceptionDetails.exception?.description?.slice(0, 400));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: script.url });

const moveTo = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
for (const step of script.steps) {
  if (step.wait) await sleep(step.wait);
  if (step.move) await moveTo(...step.move);
  if (step.path) {
    for (const p of step.path) {
      await moveTo(...p);
      await sleep((step.ms ?? 1000) / step.path.length);
    }
  }
  if (step.eval) {
    const r = await send('Runtime.evaluate', { expression: step.eval, returnByValue: true, awaitPromise: true });
    const res = r.result;
    console.log('[eval]', JSON.stringify(res?.result?.value ?? res?.exceptionDetails?.exception?.description ?? res).slice(0, 2000));
  }
  if (step.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(step.shot, Buffer.from(r.result.data, 'base64'));
    console.log('saved', step.shot);
  }
}
ws.close();
browser.kill();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
