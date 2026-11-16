import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const watch = process.argv.includes('--watch');

// Userscript metadata. @grant none keeps the script in the page's own JS
// context, which it needs to reach page globals like `room` and `WebsimSocket`.
// It runs on the websim site page too, but there it only forwards the hotkey
// to the project iframe. document-start lets the hooks see the project's
// earliest fetch/websim/WebsimSocket calls.
const header = `// ==UserScript==
// @name         WbSmUtil
// @namespace    wbsmutil
// @version      ${pkg.version}
// @description  ${pkg.description} Ctrl+\` toggles the panel inside a project frame.
// @match        https://websim.com/*
// @match        https://*.websim.com/*
// @match        https://websim.ai/*
// @match        https://*.websim.ai/*
// @exclude      https://api.websim.com/*
// @exclude      https://images.websim.com/*
// @exclude      https://avatars.websim.com/*
// @homepageURL  https://github.com/1stwbsm/WbSmUtil
// @downloadURL  https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js
// @updateURL    https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
`;

const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/wbsmutil.user.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  loader: { '.css': 'text' },
  banner: { js: header },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
