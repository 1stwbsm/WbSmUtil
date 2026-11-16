import { iframeHosts, isSitePage, listenForCommands, sendToProjectFrame } from './core/bridge';
import { installHooks } from './core/hooks';
import { HOTKEY, isHotkey } from './core/hotkey';
import { closeShell, isOpen, openShell } from './core/shell';
import type { Tool } from './core/tool';
import { h } from './core/ui';
import { tools } from './tools';

declare global {
  interface Window {
    WbSmUtil?: { open(): void; close(): void; toggle(): void };
  }
}

const site = isSitePage();

/** Shown only when no project frame answers from the websim site page. */
const notice: Tool = {
  id: 'notice',
  label: 'WbSmUtil',
  mount(ctx) {
    const hosts = iframeHosts();
    ctx.pane.append(
      h(
        'div',
        { class: 'pad stack scroll' },
        h('strong', { text: 'This is the websim site page, not the project.' }),
        h('p', {
          class: 'muted',
          text: 'Websim runs each project inside an iframe on its own *.websim.com subdomain. WbSmUtil has to run inside that frame to reach the project’s websim, WebsimSocket and /api routes.',
        }),
        h('p', { text: `Use “⧉ Move into project frame” above, or click inside the project and press ${HOTKEY.label}.` }),
        h('p', { class: 'muted', text: hosts.length ? 'Iframes on this page: ' + hosts.join(', ') : 'No iframes found on this page yet.' }),
      ),
    );
    ctx.status('Not inside a project frame.', true);
  },
};

async function open(): Promise<void> {
  if (site) {
    if (await sendToProjectFrame('open')) return;
    openShell([notice]);
    return;
  }
  openShell(tools);
}

async function toggle(): Promise<void> {
  if (site) {
    if (isOpen()) return closeShell();
    if (await sendToProjectFrame('toggle')) return;
    openShell([notice]);
    return;
  }
  if (isOpen()) closeShell();
  else openShell(tools);
}

if (!site) {
  // Project frame: instrument the page before its own scripts run.
  installHooks();
  listenForCommands({
    open: () => openShell(tools),
    close: closeShell,
    toggle: () => void toggle(),
  });
}

window.WbSmUtil = { open: () => void open(), close: closeShell, toggle: () => void toggle() };

// One line per frame so it's easy to see where the script actually runs.
console.info(`[WbSmUtil] loaded in ${location.host} (${site ? 'websim page: forwards to project frame' : 'project frame'}). ${HOTKEY.label} toggles.`);

// Capture phase on window, registered at document-start, so a project's own
// key handlers can't swallow it.
window.addEventListener(
  'keydown',
  (e) => {
    if (!isHotkey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    void toggle();
  },
  true,
);
