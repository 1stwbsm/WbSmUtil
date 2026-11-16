import { hub } from '../../core/hub';
import { logView } from '../../core/logview';
import type { Tool, ToolContext } from '../../core/tool';
import { avatar, errorMessage, h, jsonBlock, subtabs } from '../../core/ui';
import { getWebsim, requireWebsim } from '../../core/websim';

export const projectTool: Tool = {
  id: 'project',
  label: 'Project',
  css: `
.p-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
.p-card .who { display: flex; gap: 6px; align-items: center; }
.p-card .box { max-height: 180px; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; font: 11px/1.5 ui-monospace, monospace; }
.kv dt { color: #8c98a4; }
.kv dd { margin: 0; overflow-wrap: anywhere; }
`,
  mount(ctx) {
    const overview = h('div');
    const users = h('div');
    const calls = h('div');
    subtabs(ctx.pane, [
      { id: 'overview', label: 'Overview', el: overview, init: () => overviewView(ctx, overview) },
      { id: 'users', label: 'Users API', el: users, init: () => usersView(ctx, users) },
      {
        id: 'calls',
        label: 'All websim calls',
        el: calls,
        init: () =>
          calls.append(
            logView({
              channel: hub.websim,
              signal: ctx.signal,
              tagLabel: 'Call',
              empty: 'Every call the page makes into window.websim.* appears here.',
            }).el,
          ),
      },
    ]);
  },
};

function kv(entries: [string, unknown][]): HTMLElement {
  return h('dl', { class: 'kv' }, entries.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })]));
}

function overviewView(ctx: ToolContext, root: HTMLElement): void {
  const env = h('div');
  const hooks = h('div');
  const identity = h('div', { class: 'p-grid' });
  const notif = h('span', { class: 'badge', text: '?' });
  const upload = h('input', { type: 'file' });
  const transcode = h('input', { type: 'checkbox' });
  const uploadResult = h('div');

  function renderEnv(): void {
    const ws = getWebsim();
    env.replaceChildren(
      kv([
        ['origin', location.origin],
        ['path', location.pathname + location.search],
        ['framed', window !== window.top ? 'yes (inside websim page)' : 'no (top level)'],
        ['window.websim', ws ? Object.keys(ws).sort().join(', ') : 'missing'],
        ['WebsimSocket', typeof (window as unknown as { WebsimSocket?: unknown }).WebsimSocket === 'function' ? 'present' : 'missing'],
        ['rooms attached', hub.rooms.list.map((r) => `${r.label} (${r.source})`).join(', ') || 'none'],
        ['user agent', navigator.userAgent],
        ['viewport', `${innerWidth}×${innerHeight} @${devicePixelRatio}x`],
      ]),
    );
    hooks.replaceChildren(kv([...hub.hooks.entries()]));
  }

  async function card(title: string, key: 'getCurrentProject' | 'getCurrentUser' | 'getCreator'): Promise<HTMLElement> {
    try {
      const value = await ctx.wait(requireWebsim(key)(), 15000);
      const username = value.username as string | undefined;
      const extra: [string, unknown][] = [];
      if (key === 'getCurrentUser' && value.id === '1') extra.push(['note', 'signed out (id "1")']);
      if (key === 'getCurrentProject') extra.push(['link', `https://websim.com/p/${String(value.id)}`]);
      return h(
        'div',
        { class: 'p-card stack' },
        h('div', { class: 'who' }, avatar(username), h('strong', { text: title }), h('span', { class: 'muted', text: String(username ?? value.title ?? value.id ?? '') })),
        extra.length ? kv(extra) : null,
        h('div', { class: 'box' }, jsonBlock(value)),
      );
    } catch (error) {
      return h('div', { class: 'p-card' }, h('strong', { text: title }), h('div', { class: 'error-text', text: errorMessage(error) }));
    }
  }

  async function loadIdentity(): Promise<void> {
    identity.replaceChildren(h('div', { class: 'muted', text: 'Loading…' }));
    const cards = await Promise.all([
      card('Project', 'getCurrentProject'),
      card('You (viewer)', 'getCurrentUser'),
      card('Creator', 'getCreator'),
    ]);
    if (!ctx.stopped()) identity.replaceChildren(...cards);
  }

  async function notifCall(kind: 'getPermission' | 'requestPermission' | 'revokePermission'): Promise<void> {
    try {
      const fn = requireWebsim('notifications')[kind];
      if (typeof fn !== 'function') throw new Error(`websim.notifications.${kind} is not available.`);
      const res = await fn.call(getWebsim()!.notifications);
      notif.textContent = res.state + ('error' in res && res.error ? ` (${String(res.error)})` : '');
      notif.className = 'badge ' + (res.state === 'granted' ? 'good' : res.state === 'denied' ? 'bad' : '');
      ctx.status(`notifications.${kind} → ${res.state}`);
    } catch (error) {
      ctx.status(`notifications.${kind} failed: ${errorMessage(error)}`, true);
    }
  }

  root.append(
    h(
      'div',
      { class: 'scroll pad stack' },
      h('fieldset', {}, h('legend', { text: 'Frame' }), env),
      h('fieldset', {}, h('legend', { text: 'Hooks' }), hooks, h('div', { class: 'row' }, h('button', { type: 'button', text: 'Refresh', onclick: renderEnv }))),
      h('fieldset', {}, h('legend', { text: 'Identity' }), h('div', { class: 'row' }, h('button', { type: 'button', text: 'Reload', onclick: () => void loadIdentity() })), identity),
      h(
        'fieldset',
        {},
        h('legend', { text: 'Notifications permission' }),
        h(
          'div',
          { class: 'row' },
          notif,
          h('button', { type: 'button', text: 'Check', onclick: () => void notifCall('getPermission') }),
          h('button', { type: 'button', text: 'Request', title: 'Uses this click as the user gesture', onclick: () => void notifCall('requestPermission') }),
          h('button', { type: 'button', class: 'danger', text: 'Revoke', onclick: () => void notifCall('revokePermission') }),
        ),
        h('p', { class: 'hint', text: 'Sending happens only in server.js via env.NOTIFICATIONS.send(); there is no client-side send.' }),
      ),
      h(
        'fieldset',
        {},
        h('legend', { text: 'Upload (websim.upload)' }),
        h(
          'div',
          { class: 'row' },
          upload,
          h('label', { class: 'check', title: 'Transcode video for comments' }, transcode, 'transcode'),
          h('button', {
            type: 'button',
            text: 'Upload',
            onclick: async () => {
              const file = upload.files?.[0];
              if (!file) return ctx.status('Pick a file first.', true);
              uploadResult.replaceChildren(h('span', { class: 'muted', text: 'Uploading…' }));
              try {
                const res = await requireWebsim('upload')(file, transcode.checked ? { transcode: true } : undefined);
                uploadResult.replaceChildren(jsonBlock(res));
                ctx.status('Uploaded ' + file.name);
              } catch (error) {
                uploadResult.replaceChildren(h('div', { class: 'error-text', text: errorMessage(error) }));
                ctx.status('Upload failed: ' + errorMessage(error), true);
              }
            },
          }),
        ),
        uploadResult,
      ),
    ),
  );
  renderEnv();
  void loadIdentity();
  void notifCall('getPermission');
}

const ENDPOINTS: [string, string][] = [
  ['profile', ''],
  ['stats', '/stats'],
  ['followers', '/follower-users?first=50&include=' + encodeURIComponent('["follower"]')],
  ['following', '/following-users?first=50&include=' + encodeURIComponent('["following"]')],
  ['projects', '/projects'],
];

function usersView(ctx: ToolContext, root: HTMLElement): void {
  const user = h('input', { placeholder: 'username or id', class: 'grow' });
  const endpoint = h('select', {}, ENDPOINTS.map(([label, path]) => h('option', { value: path, text: label })));
  const out = h('div', { class: 'scroll pad' });
  const urlEl = h('span', { class: 'muted' });

  async function go(): Promise<void> {
    const u = user.value.trim();
    if (!u) return;
    const url = `https://websim.com/api/v1/users/${encodeURIComponent(u)}${endpoint.value}`;
    urlEl.textContent = url;
    out.replaceChildren(h('span', { class: 'muted', text: 'Loading…' }));
    try {
      const res = await ctx.wait(fetch(url, { signal: ctx.signal }));
      const data = (await res.json()) as unknown;
      out.replaceChildren(h('div', { class: 'row' }, avatar(u), h('span', { class: 'badge ' + (res.ok ? 'good' : 'bad'), text: String(res.status) })), jsonBlock(data));
    } catch (error) {
      out.replaceChildren(h('div', { class: 'error-text', text: errorMessage(error) }));
    }
  }
  user.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void go();
  });

  root.append(
    h(
      'div',
      { class: 'pad stack' },
      h(
        'div',
        { class: 'row' },
        user,
        endpoint,
        h('button', { type: 'button', class: 'primary', text: 'Fetch', onclick: () => void go() }),
        h('button', {
          type: 'button',
          text: 'Creator',
          onclick: async () => {
            const c = await getWebsim()?.getCreator?.().catch(() => null);
            if (c?.username) user.value = String(c.username);
            void go();
          },
        }),
        h('button', {
          type: 'button',
          text: 'Me',
          onclick: async () => {
            const me = await getWebsim()?.getCurrentUser?.().catch(() => null);
            if (!me || me.id === '1') return ctx.status('Signed out: the users API rejects id "1".', true);
            user.value = String(me.username ?? me.id);
            void go();
          },
        }),
      ),
      urlEl,
    ),
    out,
  );
}
