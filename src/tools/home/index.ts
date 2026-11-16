import logo from '../../assets/logo-96.png';
import { CHANGELOG } from '../../changelog';
import { HOTKEY } from '../../core/hotkey';
import { hub } from '../../core/hub';
import type { Tool } from '../../core/tool';
import { h } from '../../core/ui';
import { getWebsim } from '../../core/websim';

declare const __VERSION__: string;

/** Tabs to offer as shortcuts (the registry imports Home, so not imported here). */
const SHORTCUTS: [string, string, string][] = [
  ['database', 'Database', 'Legacy room.collection() data'],
  ['api', 'API', 'Call /api routes, see traffic'],
  ['multiplayer', 'Multiplayer', 'Sniff and send room packets'],
  ['ai', 'AI', 'AI call monitor and playgrounds'],
  ['comments', 'Comments', 'Browse, live events, post'],
  ['project', 'Project', 'Identity, hooks, users API'],
  ['console', 'Console', 'Logs, errors, run JS'],
  ['storage', 'Storage', 'localStorage, IndexedDB, cookies'],
];

export const homeTool: Tool = {
  id: 'home',
  label: 'Home',
  css: `
.home { gap: 12px; }
.home-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.home-head { align-items: center; }
.home-logo { width: 48px; height: 48px; flex-shrink: 0; }
.home-head h2 { margin: 0; font-size: 18px; color: #eef0f3; }
.home-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.home-cards button { text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; white-space: normal; }
.home-cards button strong { color: #eef0f3; font-weight: 600; }
.home-cards button span { font-size: 10px; color: #8c98a4; }
.home-status { display: flex; gap: 6px; flex-wrap: wrap; }
.release { border-left: 2px solid #38414b; padding: 2px 0 2px 10px; }
.release:first-child { border-left-color: #6f8f62; }
.release h3 { margin: 0 0 3px; font-size: 12px; color: #eef0f3; display: flex; gap: 8px; align-items: baseline; }
.release h3 .muted { font-weight: 400; font-size: 10px; }
.release ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 2px; }
kbd { font: 11px ui-monospace, monospace; background: #2a3037; border: 1px solid #424a53; border-bottom-width: 2px; border-radius: 3px; padding: 0 5px; }
`,
  mount(ctx) {
    const ws = getWebsim();
    const hasSocket = typeof (window as unknown as { WebsimSocket?: unknown }).WebsimSocket === 'function';
    const badge = (ok: boolean, text: string) => h('span', { class: 'badge ' + (ok ? 'good' : 'bad'), text });

    ctx.pane.append(
      h(
        'div',
        { class: 'scroll pad stack home' },
        h(
          'div',
          { class: 'home-head' },
          h('img', { class: 'home-logo', src: logo, alt: '', width: 48, height: 48 }),
          h('h2', { text: 'WbSmUtil' }),
          h('span', { class: 'badge', text: 'v' + __VERSION__ }),
          h('span', { class: 'muted' }, 'Toggle with ', h('kbd', { text: HOTKEY.label }), ' · ', location.host),
        ),
        h(
          'div',
          { class: 'home-status' },
          badge(!!ws, ws ? 'websim API' : 'no websim API'),
          badge(hasSocket, hasSocket ? 'WebsimSocket' : 'no WebsimSocket'),
          badge(hub.rooms.list.length > 0, hub.rooms.list.length ? `${hub.rooms.list.length} room(s)` : 'no room'),
          badge(window !== window.top, window !== window.top ? 'in project frame' : 'top level'),
        ),
        h(
          'div',
          { class: 'home-cards' },
          SHORTCUTS.map(([id, label, desc]) =>
            h('button', { type: 'button', onclick: () => ctx.open(id) }, h('strong', { text: label }), h('span', { text: desc })),
          ),
        ),
        h(
          'fieldset',
          {},
          h('legend', { text: 'Changelog' }),
          CHANGELOG.map((r) =>
            h(
              'div',
              { class: 'release' },
              h('h3', {}, r.version, h('span', { class: 'muted', text: r.date })),
              h('ul', {}, r.changes.map((c) => h('li', { text: c }))),
            ),
          ),
        ),
        h(
          'p',
          { class: 'hint' },
          'Source and issues: ',
          h('a', { href: 'https://github.com/1stwbsm/WbSmUtil', target: '_blank', rel: 'noopener', text: 'github.com/1stwbsm/WbSmUtil' }),
        ),
      ),
    );
    ctx.status(`WbSmUtil v${__VERSION__} ready.`);
  },
};
