#!/usr/bin/env node
// Minimal client for the blender-mcp add-on socket (default 127.0.0.1:9876).
//
// Usage:
//   node tools/blender.mjs exec <script.py> [--arg key=value ...]
//   node tools/blender.mjs code "<python code>"
//   node tools/blender.mjs cmd <type> ['<json params>']
//   node tools/blender.mjs shot <out.png> [maxSize]
//
// `exec` prepends `ARGS = {...}` so scripts can read CLI arguments.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const HOST = process.env.BLENDER_HOST ?? '127.0.0.1';
const PORT = Number(process.env.BLENDER_PORT ?? 9876);
const TIMEOUT_MS = Number(process.env.BLENDER_TIMEOUT ?? 600000);

function send(type, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT }, () => {
      socket.write(JSON.stringify({ type, params }));
    });
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      try {
        const msg = JSON.parse(buf);
        clearTimeout(timer);
        socket.end();
        resolve(msg);
      } catch {
        // Incomplete JSON, keep reading.
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function report(msg) {
  if (msg.status !== 'success') {
    console.error('Blender error:', msg.message ?? JSON.stringify(msg));
    process.exit(1);
  }
  const r = msg.result;
  if (r && typeof r === 'object' && 'result' in r && typeof r.result === 'string') {
    process.stdout.write(r.result);
  } else {
    console.log(JSON.stringify(r, null, 2));
  }
}

const [, , mode, ...rest] = process.argv;

try {
  if (mode === 'exec') {
    const file = rest[0];
    const args = {};
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === '--arg' && rest[i + 1]) {
        const [k, ...v] = rest[++i].split('=');
        args[k] = v.join('=');
      }
    }
    const abs = path.resolve(file);
    const header =
      `ARGS = ${JSON.stringify(args)}\n` +
      `__file__ = ${JSON.stringify(abs)}\n`;
    const code = header + fs.readFileSync(abs, 'utf8');
    report(await send('execute_code', { code }));
  } else if (mode === 'code') {
    report(await send('execute_code', { code: rest.join(' ') }));
  } else if (mode === 'cmd') {
    report(await send(rest[0], rest[1] ? JSON.parse(rest[1]) : {}));
  } else if (mode === 'shot') {
    const out = path.resolve(rest[0]);
    const maxSize = Number(rest[1] ?? 1200);
    report(await send('get_viewport_screenshot', { filepath: out, max_size: maxSize, format: 'png' }));
  } else {
    console.error('Usage: node tools/blender.mjs exec|code|cmd|shot ...');
    process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
