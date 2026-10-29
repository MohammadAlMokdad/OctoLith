#!/usr/bin/env node
// Headless-browser screenshot of the dev server, with console errors surfaced.
//   node tools/shot.mjs "/?debug&t=2.1" out.png [--wait 20000] [--size 1600,900] [--flag --force-prefers-reduced-motion]
// Uses Microsoft Edge (Windows) with SwiftShader WebGL. From Git Bash, don't pass a
// bare "/" (MSYS rewrites it to a Windows path); use "/?" instead.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const [urlPath, out] = args;
const base = process.env.SHOT_BASE ?? 'http://localhost:5199';
const edge = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));

const res = spawnSync(edge, [
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  `--user-data-dir=${profile}`,
  '--hide-scrollbars',
  `--window-size=${opt('size', '1600,900')}`,
  `--virtual-time-budget=${opt('wait', '20000')}`,
  `--screenshot=${path.resolve(out)}`,
  '--enable-logging=stderr',
  '--v=0',
  ...(opt('flag') ? [opt('flag')] : []),
  base + urlPath,
], { encoding: 'utf8', timeout: 180000 });

// Only page console output, minus known noise (extensions, Vite, three notices).
const noise = /chrome-extension|chrome-search|ntp\.msn|\[vite\]|KHR_parallel|deprecated/;
const logs = (res.stderr ?? '').split('\n').filter((l) => /:CONSOLE:/.test(l) && !noise.test(l));
for (const l of logs) console.log(l.trim().slice(0, 400));
console.log(`${fs.existsSync(out) ? 'saved' : 'FAILED'} ${out} (exit ${res.status})`);
fs.rmSync(profile, { recursive: true, force: true });
