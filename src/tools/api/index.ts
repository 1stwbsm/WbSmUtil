import type { RequestSpec } from '../../core/hooks';
import { hub } from '../../core/hub';
import { logView } from '../../core/logview';
import { crawlSources } from '../../core/source';
import type { Tool, ToolContext } from '../../core/tool';
import { copyText, errorMessage, h, pretty, subtabs, tryParse } from '../../core/ui';
import { getWebsim } from '../../core/websim';
import css from './api.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const SAVED_KEY = 'wbsmutil:requests';

interface Saved {
  name: string;
  spec: RequestSpec;
}

interface Route {
  method: string;
  path: string;
  where: Set<string>;
}

export const apiTool: Tool = {
  id: 'api',
  label: 'API',
  css,
  mount(ctx) {
    const requestEl = h('div');
    const trafficEl = h('div');
    const routesEl = h('div');
    const builder = requestBuilder(ctx, requestEl);
    const select = subtabs(ctx.pane, [
      { id: 'request', label: 'Request', el: requestEl },
      {
        id: 'traffic',
        label: 'Traffic',
        el: trafficEl,
        init: () =>
          trafficEl.append(
            logView({
              channel: hub.net,
              signal: ctx.signal,
              tagLabel: 'Method',
              empty: 'Every fetch() the page makes is recorded here (XHR and WebSocket traffic are not). Try the filter “/api/”.',
              actions: [
                {
                  label: 'Open in builder',
                  run: (e) => {
                    builder.load(e.data as RequestSpec);
                    select('request');
                  },
                },
                { label: 'Copy as fetch', run: (e) => void copyText(asFetch(e.data as RequestSpec)) },
              ],
            }).el,
          ),
      },
      {
        id: 'routes',
        label: 'Routes',
        el: routesEl,
        init: () =>
          routesView(ctx, routesEl, (spec) => {
            builder.load(spec);
            select('request');
          }),
      },
    ]);
  },
};

function asFetch(spec: RequestSpec): string {
  const init: Record<string, unknown> = {};
  if (spec.method !== 'GET') init.method = spec.method;
  if (Object.keys(spec.headers).length) init.headers = spec.headers;
  if (spec.body !== undefined) init.body = spec.body;
  return `await fetch(${JSON.stringify(spec.url)}${Object.keys(init).length ? ', ' + JSON.stringify(init, null, 2) : ''});`;
}

function readSaved(): Saved[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? (value as Saved[]) : [];
  } catch {
    return [];
  }
}

function writeSaved(list: Saved[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}

function parseHeaders(text: string): Record<string, string> {
  const t = text.trim();
  if (!t) return {};
  if (t.startsWith('{')) {
    const obj = JSON.parse(t) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  }
  const out: Record<string, string> = {};
  for (const line of t.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function requestBuilder(ctx: ToolContext, root: HTMLElement): { load(spec: RequestSpec): void } {
  const method = h('select', { 'aria-label': 'Method' }, METHODS.map((m) => h('option', { value: m, text: m })));
  const url = h('input', { class: 'code grow', value: '/api/', 'aria-label': 'URL', spellcheck: false });
  const headers = h('textarea', { class: 'code', rows: 3, placeholder: 'Content-Type: application/json\n(or a JSON object)', spellcheck: false });
  const body = h('textarea', { class: 'code', rows: 6, placeholder: '{"key": "value"}', spellcheck: false });
  const savedSelect = h('select', { 'aria-label': 'Saved requests' });
  const statusLine = h('div', { class: 'row resp-status' });
  const respHeaders = h('pre', { class: 'json' });
  const respBody = h('pre', { class: 'json' });
  const sendBtn = h('button', { type: 'button', class: 'primary', text: 'Send', onclick: () => void send() });

  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void send();
  });

  function spec(): RequestSpec {
    const s: RequestSpec = { method: method.value, url: url.value.trim(), headers: parseHeaders(headers.value) };
    if (body.value && method.value !== 'GET' && method.value !== 'HEAD') {
      s.body = body.value;
      const hasType = Object.keys(s.headers).some((k) => k.toLowerCase() === 'content-type');
      if (!hasType && typeof tryParse(body.value) === 'object') s.headers['Content-Type'] = 'application/json';
    }
    return s;
  }

  function load(s: RequestSpec): void {
    method.value = METHODS.includes(s.method) ? s.method : 'GET';
    let u = s.url;
    try {
      const parsed = new URL(s.url, location.href);
      if (parsed.origin === location.origin) u = parsed.pathname + parsed.search;
    } catch {
      // keep as is
    }
    url.value = u;
    headers.value = Object.entries(s.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    // Non-text bodies are recorded as "[FormData …]"-style placeholders.
    const placeholder = /^\[(FormData|Blob|File|binary|[A-Z]\w*)[ \]]/.test(s.body ?? '');
    body.value = s.body && !placeholder ? s.body : '';
    if (placeholder) ctx.status('The original body was ' + s.body + ' and cannot be replayed as text.');
  }

  function refreshSaved(): void {
    const list = readSaved();
    savedSelect.replaceChildren(
      h('option', { value: '', text: list.length ? `Saved (${list.length})…` : 'No saved requests' }),
      ...list.map((s, i) => h('option', { value: String(i), text: `${s.spec.method} ${s.name}` })),
    );
  }
  savedSelect.addEventListener('change', () => {
    const item = readSaved()[Number(savedSelect.value)];
    if (item) load(item.spec);
  });

  async function send(): Promise<void> {
    let s: RequestSpec;
    try {
      s = spec();
      if (!s.url) throw new Error('Enter a URL.');
    } catch (error) {
      ctx.status(errorMessage(error), true);
      return;
    }
    if (/^\/api\/v1\//.test(s.url)) {
      ctx.status('Note: /api/v1/ on the project origin is reserved for the platform, not server.js.');
    }
    sendBtn.disabled = true;
    statusLine.replaceChildren(h('span', { class: 'muted', text: 'Sending…' }));
    respHeaders.textContent = '';
    respBody.textContent = '';
    const started = performance.now();
    try {
      const res = await ctx.wait(
        fetch(s.url, { method: s.method, headers: s.headers, body: s.body, signal: ctx.signal, credentials: 'same-origin' }),
        60000,
      );
      const text = s.method === 'HEAD' ? '' : await ctx.wait(res.text(), 60000);
      if (ctx.stopped()) return;
      const ms = Math.round(performance.now() - started);
      statusLine.replaceChildren(
        h('span', { class: 'badge ' + (res.ok ? 'good' : 'bad'), text: `${res.status} ${res.statusText}` }),
        h('span', { class: 'muted', text: `${ms} ms · ${text.length.toLocaleString()} chars` }),
        h('button', { type: 'button', text: 'Copy body', onclick: () => void copyText(text) }),
        h('button', { type: 'button', text: 'Copy as fetch', onclick: () => void copyText(asFetch(s)) }),
      );
      const hs: Record<string, string> = {};
      res.headers.forEach((v, k) => (hs[k] = v));
      respHeaders.textContent = pretty(hs);
      const parsed = tryParse(text);
      respBody.textContent = typeof parsed === 'string' ? parsed : pretty(parsed);
      ctx.status(`${s.method} ${s.url} → ${res.status} in ${ms} ms`, !res.ok);
    } catch (error) {
      if (ctx.stopped()) return;
      statusLine.replaceChildren(h('span', { class: 'badge bad', text: 'Failed' }));
      respBody.textContent = errorMessage(error);
      ctx.status('Request failed: ' + errorMessage(error), true);
    } finally {
      sendBtn.disabled = false;
    }
  }

  root.append(
    h(
      'div',
      { class: 'split api' },
      h(
        'div',
        { class: 'api-req scroll pad stack' },
        h('div', { class: 'row' }, method, url, sendBtn),
        h(
          'div',
          { class: 'row' },
          savedSelect,
          h('button', {
            type: 'button',
            text: 'Save',
            onclick: () => {
              const name = prompt('Name for this request', url.value);
              if (!name) return;
              const list = readSaved().filter((x) => x.name !== name);
              list.push({ name, spec: spec() });
              writeSaved(list);
              refreshSaved();
              ctx.status('Saved “' + name + '” in this project’s localStorage.');
            },
          }),
          h('button', {
            type: 'button',
            class: 'danger',
            text: 'Delete',
            onclick: () => {
              const list = readSaved();
              const i = Number(savedSelect.value);
              if (savedSelect.value === '' || !list[i]) return;
              list.splice(i, 1);
              writeSaved(list);
              refreshSaved();
            },
          }),
        ),
        h('label', { class: 'field' }, 'Headers', headers),
        h('label', { class: 'field' }, 'Body', body),
        h(
          'p',
          { class: 'hint' },
          'Requests run from this frame, so /api/* reaches the project’s server.js with your real x-websim-* identity headers (set by the platform; they can’t be forged here).',
        ),
      ),
      h(
        'div',
        { class: 'api-resp split-v' },
        h('div', { class: 'pad' }, statusLine),
        h('details', { class: 'pad-x' }, h('summary', { text: 'Response headers' }), respHeaders),
        h('div', { class: 'scroll pad' }, respBody),
      ),
    ),
  );
  refreshSaved();
  return { load };
}

function routesView(ctx: ToolContext, root: HTMLElement, open: (spec: RequestSpec) => void): void {
  const routes = new Map<string, Route>();
  const tbody = h('tbody');
  const info = h('span', { class: 'muted' });
  const scanBtn = h('button', { type: 'button', class: 'primary', text: 'Scan source', onclick: () => void scan() });

  function addRoute(method: string, path: string, where: string): void {
    const key = method + ' ' + path;
    let r = routes.get(key);
    if (!r) routes.set(key, (r = { method, path, where: new Set() }));
    r.where.add(where);
  }

  function render(): void {
    tbody.replaceChildren(
      ...[...routes.values()]
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
        .map((r) =>
          h(
            'tr',
            { tabIndex: 0, onclick: () => open({ method: r.method, url: r.path, headers: {} }) },
            h('td', { text: r.method }),
            h('td', { text: r.path, title: r.path }),
            h('td', { class: 'muted', text: [...r.where].join(', ') }),
          ),
        ),
    );
    info.textContent = routes.size + ' routes';
  }

  function scanText(text: string, url: string): void {
    const file = url.split('/').pop() || url;
    const isServer = /\/server\.js(\?|$)/.test(url);
    for (const m of text.matchAll(/(['"`])(\/api\/[^'"`\s]*)\1/g)) {
      const path = m[2];
      if (!path || path.startsWith('/api/v1/')) continue;
      const i = m.index ?? 0;
      // Server: a method check on the same line as the path, else in the
      // block right after it. Client: `method:` in the fetch options after it.
      const start = Math.max(
        text.lastIndexOf('\n', i) + 1,
        text.lastIndexOf('if', i),
        text.lastIndexOf(';', i) + 1,
        text.lastIndexOf('{', i) + 1,
        text.lastIndexOf('}', i) + 1,
      );
      const after = text.slice(i + m[0].length, i + 300);
      const [tail = '', block = ''] = after.split('{');
      const statement = text.slice(start, i) + tail;
      const serverCheck = /method\s*={2,3}\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i;
      const method = isServer
        ? (serverCheck.exec(statement) ?? serverCheck.exec(block.split(/\bpathname\b|\}/)[0] ?? ''))?.[1]
        : /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i.exec(after.split(/\bfetch\s*\(/)[0] ?? '')?.[1];
      addRoute((method ?? 'GET').toUpperCase(), path, isServer ? 'server.js' : file);
    }
  }

  async function scan(): Promise<void> {
    scanBtn.disabled = true;
    ctx.status('Scanning server.js and page source for /api routes…');
    try {
      const summary = await crawlSources({
        signal: ctx.signal,
        stopped: ctx.stopped,
        onText: scanText,
        progress: render,
        extra: ['/server.js'],
      });
      render();
      ctx.status(`${routes.size} routes · ${summary}`);
    } catch (error) {
      ctx.status('Route scan failed: ' + errorMessage(error), true);
    } finally {
      scanBtn.disabled = false;
    }
  }

  // websim's public read API (CORS open to project pages).
  const presets = h('div', { class: 'row' });
  async function fillPresets(): Promise<void> {
    const ws = getWebsim();
    let creator = '{user}';
    let project = '{project_id}';
    try {
      const c = (await ws?.getCreator?.()) as { username?: string } | undefined;
      if (c?.username) creator = c.username;
      const p = (await ws?.getCurrentProject?.()) as { id?: string } | undefined;
      if (p?.id) project = p.id;
    } catch {
      // keep placeholders
    }
    const base = 'https://websim.com/api/v1';
    const list: [string, string][] = [
      ['user', `${base}/users/${creator}`],
      ['stats', `${base}/users/${creator}/stats`],
      ['followers', `${base}/users/${creator}/follower-users?first=20&include=${encodeURIComponent('["follower"]')}`],
      ['following', `${base}/users/${creator}/following-users?first=20&include=${encodeURIComponent('["following"]')}`],
      ['projects', `${base}/users/${creator}/projects`],
      ['comments', `${base}/projects/${project}/comments?first=20`],
    ];
    presets.replaceChildren(
      h('span', { class: 'muted', text: 'websim API:' }),
      ...list.map(([label, u]) => h('button', { type: 'button', text: label, title: u, onclick: () => open({ method: 'GET', url: u, headers: {} }) })),
    );
  }

  root.append(
    h('div', { class: 'pad stack' }, h('div', { class: 'row' }, scanBtn, info), presets),
    h(
      'div',
      { class: 'scroll' },
      h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', { text: 'Method' }), h('th', { text: 'Path' }), h('th', { text: 'Found in' }))), tbody),
    ),
  );
  void fillPresets();
  void scan();
}
