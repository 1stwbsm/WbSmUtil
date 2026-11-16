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
// free for the dissolve to fly into.
const SW = 420; // swirl size
const SX = 52;
const SY = 62;
const CX = SX + SW / 2;
const CY = SY + SW / 2;
const R = SW * 0.47; // visible disc radius in the source art

// Unit vector toward the top-right corner.
const DX = Math.SQRT1_2;
const DY = -Math.SQRT1_2;

const CELL = 16;
const removed = []; // cells cut out of the swirl
const flying = []; // displaced pieces (blocks or code bars)

for (let y = SY; y < SY + SW; y += CELL) {
  for (let x = SX; x < SX + SW; x += CELL) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const dist = Math.hypot(cx - CX, cy - CY);
    if (dist > R + CELL * 0.7) continue; // outside the disc
    // How far toward the top-right this cell sits, -1..1.
    const t = ((cx - CX) * DX + (cy - CY) * DY) / R;
    const edge = 0.5 + (rand() - 0.5) * 0.3; // ragged dissolve front
    // Scattered holes just before the front, solid removal beyond it.
    if (t < edge && !(t > edge - 0.16 && rand() < 0.3)) continue;
    removed.push([x, y]);
    // Not every removed cell survives as a visible piece.
    if (rand() < 0.18) continue;
    const k = Math.max(0, (t - edge) / (1 - edge + 1e-6)); // 0 at the front, 1 at the far edge
    const push = 14 + k * 95 + rand() * 40;
    flying.push({ x, y, k, push, jitter: (rand() - 0.5) * 18 });
  }
}

const palette = ['#7fd4ff', '#4aa3ff', '#2f74ff', '#8b7dff', '#b9ecff', '#3fc6e8', '#5d8cff'];

let blocks = '';
let bars = '';
let clips = '';
let clipId = 0;
for (const f of flying) {
  const tx = f.push * DX + f.jitter * DY * -1;
  const ty = f.push * DY + f.jitter * DX;
  const nx = f.x + tx;
  const ny = f.y + ty;
  if (nx < 8 || ny < 10 || nx + CELL > S - 8) continue; // keep inside the canvas
  if (f.k < 0.55) {
    // Near the front: real pieces of the swirl, shrinking as they fly.
    const scale = 1 - f.k * 0.55;
    const id = `c${clipId++}`;
    clips += `<clipPath id="${id}"><rect x="${f.x}" y="${f.y}" width="${CELL}" height="${CELL}" rx="2"/></clipPath>`;
    const c = { x: f.x + CELL / 2, y: f.y + CELL / 2 };
    blocks +=
      `<g transform="translate(${r1(tx)} ${r1(ty)}) translate(${c.x} ${c.y}) scale(${r1(scale * 100) / 100}) translate(${-c.x} ${-c.y})" opacity="${r1((1 - f.k * 0.5) * 100) / 100}">` +
      `<use href="#swirl" clip-path="url(#${id})"/></g>`;
  } else {
    // Farther out: pieces flatten into code bars snapped to text rows.
    const row = Math.round(ny / 11) * 11;
    const w = Math.min(10 + Math.round(rand() * 40), S - 10 - Math.round(nx));
    if (w < 8) continue;
    const op = r1((0.95 - (f.k - 0.55) * 0.9) * 100) / 100;
    bars += `<rect x="${r1(nx)}" y="${row}" width="${w}" height="5.5" rx="2.75" fill="${pick(palette)}" opacity="${Math.max(0.25, op)}"/>`;
  }
}

// A loose block of code lines in the top-right corner: rows of bars with
// indentation, thinning out toward the corner.
let code = '';
const rows = 10;
for (let i = 0; i < rows; i++) {
  const y = 18 + i * 11;
  const startX = 318 + i * 8 + (i % 3 === 1 ? 14 : 0) + (i % 4 === 2 ? 24 : 0);
  let x = startX;
  const tokens = 1 + Math.floor(rand() * 3);
  for (let j = 0; j < tokens; j++) {
    const w = 8 + Math.round(rand() * 38);
    if (x + w > S - 10) break;
    // Fade rows nearer the swirl so they hand over to the flying bars.
    const op = r1((0.95 - i / rows * 0.55) * 100) / 100;
    code += `<rect x="${x}" y="${y}" width="${w}" height="5.5" rx="2.75" fill="${pick(palette)}" opacity="${op}"/>`;
    x += w + 6;
  }
}

const maskHoles = removed.map(([x, y]) => `<rect x="${x - 0.5}" y="${y - 0.5}" width="${CELL + 1}" height="${CELL + 1}"/>`).join('');

const swirl = dataUrl('swirl.png', 512);
const wrench = dataUrl('monkey_wrench.png', 288);

// Wrench: mirrored so the jaw points up-right at the swirl, bottom-left corner.
const WS = 228;
const WX = -10;
const WY = S - WS + 8;

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
<use href="#swirl" mask="url(#dissolve)"/>
<g>${blocks}</g>
<g filter="url(#glow)">${bars}${code}</g>
<g filter="url(#shadow)">
  <image href="${wrench}" x="${WX}" y="${WY}" width="${WS}" height="${WS}" transform="translate(${2 * WX + WS} 0) scale(-1 1)"/>
</g>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`${OUT}: ${(svg.length / 1024).toFixed(0)} KB, ${removed.length} cells dissolved, ${flying.length} pieces`);
