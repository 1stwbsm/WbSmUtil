// Builds assets/logo.svg from assets/logo-src/{swirl,monkey_wrench}.png.
//
//   node scripts/make-logo.mjs
//
// The swirl is tinted blue, its top-right edge breaks into blocks that fly
// outward and stretch into lines of "code", and the wrench sits bottom-left.
// Randomness is seeded, so the output is the same every run. If ImageMagick
// is installed, the small source images are upscaled with Lanczos first.
// Render PNGs from the SVG in a browser (it uses masks, clip paths, filters).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'assets/logo-src';
const OUT = 'assets/logo.svg';
const S = 512; // canvas

function dataUrl(file, size) {
  let path = join(SRC, file);
  try {
    const tmp = join(mkdtempSync(join(tmpdir(), 'logo-')), file);
    execFileSync('magick', [path, '-filter', 'Lanczos', '-resize', `${size}x${size}`, '-unsharp', '0x0.9+0.7', tmp]);
    path = tmp;
  } catch {
    // no ImageMagick: embed the original and let the renderer scale it
  }
  return 'data:image/png;base64,' + readFileSync(path).toString('base64');
}

// Small deterministic PRNG (mulberry32).
let seed = 0x5eed1e57;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const r1 = (n) => Math.round(n * 10) / 10;

// Swirl placement: lower-left of the canvas, leaving the top-right corner
// free for the dissolve and the code it turns into.
const SW = 410; // swirl size
const SX = 40;
const SY = 84;
const CX = SX + SW / 2;
const CY = SY + SW / 2;
const R = SW * 0.47; // visible disc radius in the source art

// Unit vector toward the top-right corner.
const DX = Math.SQRT1_2;
const DY = -Math.SQRT1_2;
const proj = (x, y) => (x - CX) * DX + (y - CY) * DY; // distance along the dissolve direction

const CELL = 16;
const removed = []; // cells cut out of the swirl
const pieces = []; // where cut cells end up

// Dissolve: dense right at the break (pieces barely move), thinning out and
// spreading the farther they fly.
for (let y = SY; y < SY + SW; y += CELL) {
  for (let x = SX; x < SX + SW; x += CELL) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    if (Math.hypot(cx - CX, cy - CY) > R + CELL * 0.6) continue; // outside the disc
    const t = proj(cx, cy) / R; // -1..1 toward the top-right
    const edge = 0.46 + (rand() - 0.5) * 0.24; // ragged break line
    // Just behind the break, some cells come loose but stay almost in place.
    const loosening = t < edge && t > edge - 0.12 && rand() < 0.4;
    if (t < edge && !loosening) continue;
    removed.push([x, y]);
    // Cells on the rim are mostly empty; flying, they'd read as stray slivers.
    if (Math.hypot(cx - CX, cy - CY) > R - CELL * 0.35) continue;
    const k = loosening ? 0 : Math.min(1, (t - edge) / (1 - edge)); // 0 at the break, 1 at the far rim
    if (rand() > 0.98 - k * 0.72) continue; // survivors thin out with distance
    const push = loosening ? 2 + rand() * 4 : 4 + Math.pow(k, 1.5) * 78 + rand() * (6 + k * 18);
    const side = (rand() - 0.5) * (4 + k * 26); // sideways spread grows with distance
    pieces.push({ x, y, k, tx: push * DX - side * DY, ty: push * DY + side * DX });
  }
}

const palette = ['#7fd4ff', '#4aa3ff', '#2f74ff', '#8b7dff', '#b9ecff', '#3fc6e8', '#5d8cff'];

let blocks = '';
let bars = '';
let clips = '';
let clipId = 0;
const placed = []; // block boxes, so code bars don't overlap them
for (const f of pieces) {
  const nx = f.x + f.tx;
  const ny = f.y + f.ty;
  if (nx < 6 || ny < 6 || nx + CELL > S - 6) continue; // keep inside the canvas
  if (f.k > 0.62 && rand() < 0.45) {
    // The outermost pieces start turning into code: stretched bars.
    const w = 12 + Math.round(rand() * 18);
    bars += `<rect x="${r1(nx)}" y="${r1(ny + 5)}" width="${w}" height="5.5" rx="2.75" fill="${pick(palette)}" opacity="${r1((1 - f.k * 0.3) * 100) / 100}"/>`;
    placed.push({ x: nx, y: ny + 5, w, h: 6 });
    continue;
  }
  const scale = 1 - f.k * 0.42;
  const id = `c${clipId++}`;
  clips += `<clipPath id="${id}"><rect x="${f.x}" y="${f.y}" width="${CELL}" height="${CELL}" rx="2"/></clipPath>`;
  const c = { x: f.x + CELL / 2, y: f.y + CELL / 2 };
  blocks +=
    `<g transform="translate(${r1(f.tx)} ${r1(f.ty)}) translate(${c.x} ${c.y}) scale(${r1(scale * 100) / 100}) translate(${-c.x} ${-c.y})" opacity="${r1((1 - f.k * 0.3) * 100) / 100}">` +
    `<use href="#swirl" clip-path="url(#${id})"/></g>`;
  const sz = CELL * scale;
  placed.push({ x: c.x + f.tx - sz / 2, y: c.y + f.ty - sz / 2, w: sz, h: sz });
}

// Code lines linger in the top-right corner, starting just inside the
// outer edge of the block cloud. They're drawn behind the swirl and the
// blocks, so pieces fly over them rather than the code covering the logo.
const fronts = placed.map((b) => proj(b.x + b.w / 2, b.y + b.h / 2)).sort((a, b) => a - b);
const frontier = fronts[Math.floor(fronts.length * 0.7)] ?? R;
const CORNER = { x: S - 8, y: 8 };
let code = '';
for (let y = 10; y < 300; y += 11) {
  let x = Math.max(8, Math.round(CX + (frontier - 46 - (y - CY) * DY) / DX));
  x += Math.round(rand() * 10) + (rand() < 0.3 ? 12 : 0); // indentation
  while (x < S - 12) {
    const w = Math.min(8 + Math.round(rand() * 30), S - 10 - x);
    if (w < 6) break;
    // Dense near the corner, fading out with distance from it.
    const d = Math.hypot(CORNER.x - (x + w / 2), y - CORNER.y);
    const near = Math.max(0, 1 - Math.max(0, d - 60) / 150);
    if (rand() < 0.95 * Math.pow(near, 1.3)) {
      const op = r1((0.35 + 0.6 * near) * 100) / 100;
      code += `<rect x="${x}" y="${y}" width="${w}" height="5.5" rx="2.75" fill="${pick(palette)}" opacity="${op}"/>`;
    }
    x += w + 5 + (rand() < 0.15 ? 16 : 0);
  }
}

const maskHoles = removed.map(([x, y]) => `<rect x="${x - 0.5}" y="${y - 0.5}" width="${CELL + 1}" height="${CELL + 1}"/>`).join('');

const swirl = dataUrl('swirl.png', 512);
const wrench = dataUrl('monkey_wrench.png', 288);

// Wrench: bottom-left, as drawn (jaw top-left), lying across the swirl.
const WS = 250;
const WX = 2;
const WY = S - WS - 18;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<title>WbSmUtil</title>
<defs>
  <!-- More blue: map brightness onto a navy-to-cyan ramp (the spiral's
       light and dark bands survive), then mix back a quarter of the
       original colour so it isn't flat. -->
  <filter id="blue" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="matrix" result="lum" values="
      0.2126 0.7152 0.0722 0 0
      0.2126 0.7152 0.0722 0 0
      0.2126 0.7152 0.0722 0 0
      0      0      0      1 0"/>
    <feComponentTransfer in="lum" result="ramp">
      <feFuncR type="table" tableValues="0.03 0.06 0.16 0.38 0.72 0.95"/>
      <feFuncG type="table" tableValues="0.07 0.22 0.48 0.74 0.92 1"/>
      <feFuncB type="table" tableValues="0.28 0.62 0.92 1 1 1"/>
    </feComponentTransfer>
    <feComposite in="ramp" in2="SourceGraphic" operator="arithmetic" k1="0" k2="0.76" k3="0.24" k4="0"/>
  </filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="2" dy="5" stdDeviation="5" flood-color="#06122b" flood-opacity="0.45"/>
  </filter>
  <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur stdDeviation="1.2" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <image id="swirlRaw" href="${swirl}" x="${SX}" y="${SY}" width="${SW}" height="${SW}"/>
  <g id="swirl" filter="url(#blue)"><use href="#swirlRaw"/></g>
  <mask id="dissolve" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">
    <rect width="${S}" height="${S}" fill="#fff"/>
    <g fill="#000">${maskHoles}</g>
  </mask>
  ${clips}
</defs>
<g filter="url(#glow)">${code}</g>
<use href="#swirl" mask="url(#dissolve)"/>
<g>${blocks}</g>
<g filter="url(#glow)">${bars}</g>
<g filter="url(#shadow)">
  <image href="${wrench}" x="${WX}" y="${WY}" width="${WS}" height="${WS}"/>
</g>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`${OUT}: ${(svg.length / 1024).toFixed(0)} KB, ${removed.length} cells dissolved, ${pieces.length} pieces`);
