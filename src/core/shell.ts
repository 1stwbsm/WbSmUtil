import css from './shell.css';
import { iframeHosts, isSitePage, sendToProjectFrame } from './bridge';
import type { Tool, ToolContext } from './tool';
import { errorMessage } from './ui';

export { errorMessage };

const WINDOW_KEY = '__wbsmutilWindow';

interface ShellHandle {
  host: HTMLElement;
  close(): void;
  focus(): void;
}

declare global {
  interface Window {
    [WINDOW_KEY]?: ShellHandle;
  }
}

const FRAME = `
<div class="bar">
  <span class="title">WbSmUtil</span>
  <span class="where" title="Frame this window is running in"></span>
  <div class="actions"></div>
  <button class="to-frame" title="Move into the project iframe (the tools only work there)">⧉ Move into project frame</button>
  <button class="close" aria-label="Close and stop" title="Close and stop">×</button>
</div>
<nav class="tabs" aria-label="Tools"></nav>
<div class="panes"></div>
<div class="foot"><span class="status" role="status">Ready</span><div class="foot-slots"></div></div>`;

interface Mounted {
  tool: Tool;
  pane: HTMLElement;
  actions: HTMLElement;
  foot: HTMLElement;
  tab: HTMLButtonElement | null;
}

export function isOpen(): boolean {
  return !!window[WINDOW_KEY];
}

export function closeShell(): void {
  window[WINDOW_KEY]?.close();
}

/**
 * Open the floating toolkit window (or focus it if already open). Everything
 * it starts is tied to one AbortController, so closing stops all tool work.
 */
export function openShell(tools: Tool[]): void {
  const existing = window[WINDOW_KEY];
  if (existing) {
    existing.focus();
    return;
  }

  const abort = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  const host = document.createElement('div');
  host.setAttribute('data-wbsmutil', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = [css, ...tools.map((t) => t.css ?? '')].join('\n');
  const frame = document.createElement('section');
  frame.className = 'window';
  frame.innerHTML = FRAME;
  shadow.append(style, frame);
  (document.body ?? document.documentElement).append(host);
  host.style.left = Math.max(12, (innerWidth - host.offsetWidth) / 2) + 'px';
  host.style.top = Math.max(12, Math.min(100, innerHeight - host.offsetHeight - 12)) + 'px';

  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const el = shadow.querySelector<T>(selector);
    if (!el) throw new Error('WbSmUtil: missing element ' + selector);
    return el;
  };
  const on: ToolContext['on'] = (el, type, fn) =>
    el.addEventListener(type, fn as EventListener, { signal: abort.signal });

  // Keep the page's own keyboard handlers (games!) from seeing keys typed
  // into the tool. Events still reach the tool's own listeners first.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    on(host, type, (e) => e.stopPropagation());
  }

  const bar = q('.bar');
  const statusEl = q('.status');
  const history: string[] = [];
  function status(text: string, error = false): void {
    if (stopped) return;
    history.push(text);
    if (history.length > 12) history.shift();
    statusEl.textContent = text;
    statusEl.title = history.join(' · ');
    statusEl.classList.toggle('error', error);
  }

  // The platform socket is a singleton shared with the project. Never close it.
  function wait<T>(promise: PromiseLike<T> | T, ms = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        timers.delete(timer);
        abort.signal.removeEventListener('abort', cancel);
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('Websim request timed out.'))), ms);
      timers.add(timer);
      const cancel = () => finish(() => reject(new DOMException('Closed', 'AbortError')));
      abort.signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(
        (v) => finish(() => resolve(v)),
        (e: unknown) => finish(() => reject(e)),
      );
    });
  }

  function close(): void {
    stopped = true;
    abort.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    host.remove();
    if (window[WINDOW_KEY]?.host === host) delete window[WINDOW_KEY];
  }

  // Where are we? On the websim site page the tools can't work; offer the move.
  const site = isSitePage();
  q('.where').textContent = site ? 'websim.com page' : location.host;
  q('.where').classList.toggle('bad', site);
  const toFrame = q<HTMLButtonElement>('.to-frame');
  toFrame.hidden = !site;
  on(toFrame, 'click', async () => {
    toFrame.disabled = true;
    status('Moving into the project frame…');
    const ok = await sendToProjectFrame('open');
    toFrame.disabled = false;
    if (ok) {
      close();
      return;
    }
    const hosts = iframeHosts();
    status(
      'No project frame answered. ' +
        (hosts.length
          ? 'Iframes on this page: ' + hosts.join(', ') + '. Make sure the userscript @match covers the project frame host.'
          : 'No iframes on this page; open a project first.'),
      true,
    );
  });

  // Tools: each gets a pane, a bar action slot and a footer slot, mounted on
  // first activation.
  const mounted = new Map<string, Mounted>();
  let active: Mounted | null = null;
  const tabs = q('.tabs');
  tabs.hidden = tools.length < 2;

  function activate(tool: Tool): void {
    let m = mounted.get(tool.id);
    if (!m) {
      const pane = document.createElement('div');
      pane.className = 'pane pane-' + tool.id;
      const actions = document.createElement('div');
      actions.className = 'slot';
      const foot = document.createElement('div');
      foot.className = 'slot';
      q('.panes').append(pane);
      q('.actions').append(actions);
      q('.foot-slots').append(foot);
      const tab = tabs.querySelector<HTMLButtonElement>(`button[data-tool="${CSS.escape(tool.id)}"]`);
      const entry: Mounted = { tool, pane, actions, foot, tab };
      m = entry;
      mounted.set(tool.id, entry);
      const ctx: ToolContext = {
        pane,
        actions,
        foot,
        signal: abort.signal,
        stopped: () => stopped,
        $: <T extends Element = HTMLElement>(selector: string): T => {
          const el =
            pane.querySelector<T>(selector) ??
            actions.querySelector<T>(selector) ??
            foot.querySelector<T>(selector);
          if (!el) throw new Error(`WbSmUtil (${tool.id}): missing element ${selector}`);
          return el;
        },
        on,
        wait,
        status,
        open: (id) => {
          const t = tools.find((x) => x.id === id);
          if (t) activate(t);
        },
      };
      Promise.resolve()
        .then(() => tool.mount(ctx))
        .catch((error: unknown) => {
          if (!stopped) status(tool.label + ' failed: ' + errorMessage(error), true);
        });
    }
    for (const other of mounted.values()) {
      const isActive = other === m;
      other.pane.hidden = other.actions.hidden = other.foot.hidden = !isActive;
      other.tab?.classList.toggle('active', isActive);
      other.tab?.setAttribute('aria-selected', String(isActive));
    }
    active = m;
  }

  for (const tool of tools) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tool.label;
    b.dataset.tool = tool.id;
    b.setAttribute('role', 'tab');
    on(b, 'click', () => activate(tool));
    tabs.append(b);
  }

  window[WINDOW_KEY] = {
    host,
    close,
    focus: () => (active?.tab ?? q<HTMLButtonElement>('.close')).focus(),
  };
  on(q('.close'), 'click', close);
  on(window, 'pagehide', close);

  // Dragging and keeping the window on screen.
  let drag: { x: number; y: number; l: number; t: number } | null = null;
  on<PointerEvent>(bar, 'pointerdown', (e) => {
    if ((e.target as Element).closest('button, input, select')) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, l: parseFloat(host.style.left), t: parseFloat(host.style.top) };
    bar.setPointerCapture(e.pointerId);
  });
  on<PointerEvent>(bar, 'pointermove', (e) => {
    if (!drag) return;
    host.style.left = Math.max(0, Math.min(innerWidth - host.offsetWidth, drag.l + e.clientX - drag.x)) + 'px';
    host.style.top = Math.max(0, Math.min(innerHeight - 36, drag.t + e.clientY - drag.y)) + 'px';
  });
  on(bar, 'pointerup', () => (drag = null));
  on(bar, 'pointercancel', () => (drag = null));
  on(window, 'resize', () => {
    host.style.left = Math.max(0, Math.min(parseFloat(host.style.left), innerWidth - host.offsetWidth)) + 'px';
    host.style.top = Math.max(0, Math.min(parseFloat(host.style.top), innerHeight - 36)) + 'px';
  });

  const first = tools[0];
  if (first) activate(first);
}
