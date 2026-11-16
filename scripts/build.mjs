import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const watch = process.argv.includes('--watch');
const OUT = 'dist/wbsmutil.user.js';

// Userscript metadata. The main code must run in the page's own JS world to
// reach `websim`, `WebsimSocket` and the page's fetch. @grant none asks for
// that; @inject-into auto (Violentmonkey) falls back to a content script when
// the page's CSP blocks page injection, and src/loader.ts then injects the
// main code itself with the page's nonce. It runs on the websim site page
// too, but there it only forwards the hotkey to the project iframe.
// document-start lets the hooks see the project's earliest calls.
const header = `// ==UserScript==
// @name         WbSmUtil
// @namespace    wbsmutil
// @version      ${pkg.version}
// @description  ${pkg.description} Ctrl+Backtick toggles the panel inside a project frame.
// @match        https://websim.com/*
// @match        https://*.websim.com/*
// @match        https://websim.ai/*
// @match        https://*.websim.ai/*
// @exclude      https://api.websim.com/*
// @exclude      https://images.websim.com/*
// @exclude      https://avatars.websim.com/*
// @icon        https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/docs/img/icon-128.png
// @homepageURL  https://1stwbsm.github.io/WbSmUtil/
// @downloadURL  https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js
// @updateURL    https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js
// @grant        none
// @inject-into  auto
// @run-at       document-start
// ==/UserScript==
`;

const common = {
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  loader: { '.css': 'text' },
  write: false,
  logLevel: 'warning',
  define: { __VERSION__: JSON.stringify(pkg.version) },
};

/**
 * Output layout:
 *   (function () {
 *     function __wbsmutilMain() { <guard>; <main bundle> }
 *     <loader bundle>
 *   })();
 * The loader either calls __wbsmutilMain directly (already in the page
 * world) or injects `(${__wbsmutilMain.toString()})()` as a nonce'd script.
 */
async function compose() {
  const [main, loader] = await Promise.all([
    esbuild.build({ ...common, entryPoints: ['src/main.ts'] }),
    esbuild.build({ ...common, entryPoints: ['src/loader.ts'] }),
  ]);
  const guard =
    "if (window.__wbsmutilLoaded) return; window.__wbsmutilLoaded = true;\n" +
    "try { document.documentElement.setAttribute('data-wbsmutil', ''); } catch (e) {}\n";
  const out =
    header +
    '\n(function () {\nfunction __wbsmutilMain() {\n' +
    guard +
    main.outputFiles[0].text +
    '}\n' +
    loader.outputFiles[0].text +
    '})();\n';
  mkdirSync('dist', { recursive: true });
  writeFileSync(OUT, out);
  console.log(`  ${OUT}  ${(out.length / 1024).toFixed(1)}kb`);
}

if (watch) {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: ['src/main.ts', 'src/loader.ts'],
    outdir: 'dist/.watch',
    plugins: [
      {
        name: 'compose',
        setup(build) {
          build.onEnd((result) => {
            if (!result.errors.length) compose().catch((e) => console.error(e));
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('watching…');
} else {
  await compose();
}
