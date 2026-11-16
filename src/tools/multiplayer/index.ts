import { attachRoom, discoverRooms, unwrap } from '../../core/hooks';
import { hub, type RoomRef } from '../../core/hub';
import { logView } from '../../core/logview';
import type { Tool, ToolContext } from '../../core/tool';
import { errorMessage, h, pretty, preview, subtabs } from '../../core/ui';

type Obj = Record<string, unknown>;

export const multiplayerTool: Tool = {
  id: 'multiplayer',
  label: 'Multiplayer',
  css: `
.mp-top { border-bottom: 1px solid #303841; }
.mp-composer { border-top: 1px solid #303841; align-items: stretch; flex-wrap: nowrap; }
.mp-composer textarea { resize: none; }
.mp-state { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.mp-state .box { max-height: 260px; }
.mp-state h4 { margin: 0 0 4px; font-size: 11px; color: #aab6c3; font-weight: 600; }
`,
  mount(ctx) {
    const roomSelect = h('select', { 'aria-label': 'Room' });
    const info = h('span', { class: 'muted' });
    const current = (): RoomRef | undefined => hub.rooms.list.find((r) => r.label === roomSelect.value) ?? hub.rooms.list[0];

    function refreshRooms(): void {
      const value = roomSelect.value;
      roomSelect.replaceChildren(
        ...(hub.rooms.list.length
          ? hub.rooms.list.map((r) => h('option', { value: r.label, text: `${r.label} · ${r.source}` }))
          : [h('option', { value: '', text: 'No room yet' })]),
      );
      if (value) roomSelect.value = value;
      const r = current();
      info.textContent = r ? kind(r.room) : 'The page hasn’t joined a room yet, or joined before hooks were installed (try Find).';
    }
    hub.rooms.subscribe(refreshRooms, ctx.signal);
    roomSelect.addEventListener('change', refreshRooms);

    const top = h(
      'div',
      { class: 'row pad mp-top' },
      roomSelect,
      h('button', {
        type: 'button',
        text: 'Find',
        title: 'Look for room objects in page globals (room, socket, party…)',
        onclick: () => {
          const n = discoverRooms();
          ctx.status(n ? `Attached ${n} room(s) found in page globals.` : 'No new rooms found in page globals.');
        },
      }),
      h('button', {
        type: 'button',
        text: 'Join debug connection',
        title: 'WebsimSocket.joinRoom(): a separate connection of your own',
        onclick: () => void joinDebug(ctx),
      }),
      info,
    );
    ctx.pane.append(top);

    const packets = h('div');
    const state = h('div');
    subtabs(ctx.pane, [
      { id: 'packets', label: 'Packets', el: packets, init: () => packetsView(ctx, packets, current) },
      { id: 'state', label: 'State', el: state, init: () => stateView(ctx, state, current) },
    ]);
    refreshRooms();
  },
};

function kind(room: Obj): string {
  const legacy = 'roomState' in room || 'peers' in room || 'presence' in room;
  const parts = [legacy ? 'legacy WebsimSocket (presence/roomState)' : 'server room (send/onmessage)'];
  if (typeof room.clientId === 'string') parts.push('clientId ' + room.clientId);
  return parts.join(' · ');
}

async function joinDebug(ctx: ToolContext): Promise<void> {
  const WS = (window as unknown as { WebsimSocket?: { joinRoom?: () => Promise<unknown> } }).WebsimSocket;
  if (typeof WS?.joinRoom !== 'function') {
    ctx.status('WebsimSocket.joinRoom is not available on this page.', true);
    return;
  }
  if (!confirm('Open a separate room connection as you? The server runs onConnect for it like a new player, and it stays open until the page reloads.')) return;
  try {
    const room = await ctx.wait(WS.joinRoom(), 20000);
    attachRoom(room, 'debug connection');
    ctx.status('Joined a debug connection.');
  } catch (error) {
    ctx.status('joinRoom failed: ' + errorMessage(error), true);
  }
}

function packetsView(ctx: ToolContext, root: HTMLElement, current: () => RoomRef | undefined): void {
  const payload = h('textarea', { class: 'code grow', rows: 3, placeholder: '{"type": "chat", "text": "hi"}  (Ctrl+Enter)', spellcheck: false });
  const mode = h(
    'select',
    { 'aria-label': 'Direction' },
    h('option', { value: 'send', text: 'Send to server (as you)' }),
    h('option', { value: 'sim', text: 'Simulate incoming' }),
  );
  const raw = h('input', { type: 'checkbox' });
  const go = h('button', { type: 'button', class: 'primary', text: 'Go', onclick: () => run() });
  payload.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
  });

  function value(): unknown {
    if (raw.checked) return payload.value;
    try {
      return JSON.parse(payload.value);
    } catch (error) {
      throw new Error('Not valid JSON (tick “raw string” to send text as is): ' + errorMessage(error));
    }
  }

  function send(ref: RoomRef, data: unknown): void {
    const fn = ref.room.send;
    if (typeof fn !== 'function') throw new Error(ref.label + ' has no send().');
    (fn as (d: unknown) => unknown).call(ref.room, data);
    ctx.status(`Sent to ${ref.label}: ${preview(data, 80)}`);
  }

  function simulate(ref: RoomRef, data: unknown): void {
    const handler = unwrap(ref.room.onmessage);
    if (typeof handler !== 'function' || handler.name === 'wbsmutilPassive') {
      throw new Error(ref.label + ' has no onmessage handler set by the page.');
    }
    const legacy = 'roomState' in ref.room || 'peers' in ref.room;
    // Server rooms deliver JSON strings; legacy sockets deliver objects.
    const eventData = legacy || typeof data === 'string' ? data : JSON.stringify(data);
    hub.room.push({ tag: ref.label, level: 'sim', summary: preview(data, 300), detail: { simulated: true, data }, data });
    (handler as (e: unknown) => unknown).call(ref.room, legacy ? { data: eventData } : new MessageEvent('message', { data: eventData }));
    ctx.status(`Delivered simulated packet to ${ref.label}’s onmessage.`);
  }

  function run(): void {
    try {
      const ref = current();
      if (!ref) throw new Error('No room. The page must join one first, or use Find / Join debug connection.');
      const data = value();
      if (mode.value === 'send') send(ref, data);
      else simulate(ref, data);
    } catch (error) {
      ctx.status(errorMessage(error), true);
    }
  }

  const refFor = (label: string) => hub.rooms.list.find((r) => r.label === label);
  root.append(
    logView({
      channel: hub.room,
      signal: ctx.signal,
      levels: ['in', 'out', 'sim', 'info', 'warn'],
      tagLabel: 'Room',
      empty:
        'Packets the page sends (↑) and receives (↓) appear here. Use the filter to hide noisy types, e.g. “-snapshot”.',
      actions: [
        {
          label: 'Edit',
          run: (e) => {
            payload.value = typeof e.data === 'string' ? e.data : pretty(e.data);
            raw.checked = typeof e.data === 'string';
            mode.value = e.level === 'in' ? 'sim' : 'send';
          },
        },
        {
          label: 'Resend',
          run: (e) => {
            try {
              const ref = refFor(e.tag);
              if (!ref) throw new Error('Room gone.');
              send(ref, e.data);
            } catch (error) {
              ctx.status(errorMessage(error), true);
            }
          },
        },
        {
          label: 'Replay as incoming',
          run: (e) => {
            try {
              const ref = refFor(e.tag);
              if (!ref) throw new Error('Room gone.');
              simulate(ref, e.data);
            } catch (error) {
              ctx.status(errorMessage(error), true);
            }
          },
        },
      ],
    }).el,
    h('div', { class: 'row pad mp-composer' }, payload, h('div', { class: 'stack' }, mode, h('label', { class: 'check' }, raw, 'raw string'), go)),
  );
}

function stateView(ctx: ToolContext, root: HTMLElement, current: () => RoomRef | undefined): void {
  const grid = h('div', { class: 'mp-state' });
  const auto = h('input', { type: 'checkbox', checked: true });
  const presence = h('textarea', { class: 'code', rows: 3, placeholder: '{"x": 0, "y": 0}' });
  const roomState = h('textarea', { class: 'code', rows: 3, placeholder: '{"level": 2}' });

  function section(title: string, value: unknown): HTMLElement {
    return h('div', {}, h('h4', { text: title }), h('div', { class: 'box' }, h('pre', { class: 'json', text: pretty(value, 2, 5) })));
  }

  function render(): void {
    const ref = current();
    if (!ref) {
      grid.replaceChildren(h('div', { class: 'empty', text: 'No room attached.' }));
      return;
    }
    const r = ref.room;
    const fields: Obj = {};
    for (const key of Object.keys(r)) {
      if (['peers', 'presence', 'roomState'].includes(key)) continue;
      try {
        const v = r[key];
        if (typeof v !== 'function') fields[key] = v;
      } catch {
        // getter threw
      }
    }
    const methods = new Set<string>();
    for (let p: object | null = r; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) {
        try {
          if (k !== 'constructor' && typeof r[k] === 'function') methods.add(k);
        } catch {
          // ignore
        }
      }
    }
    grid.replaceChildren(
      ...('peers' in r ? [section('peers', r.peers)] : []),
      ...('presence' in r ? [section('presence', r.presence)] : []),
      ...('roomState' in r ? [section('roomState', r.roomState)] : []),
      section('Other fields', fields),
      section('Methods', [...methods].sort()),
    );
  }

  function call(method: string, text: string): void {
    try {
      const ref = current();
      if (!ref) throw new Error('No room attached.');
      const fn = ref.room[method];
      if (typeof fn !== 'function') throw new Error(`${ref.label} has no ${method}() (only legacy sockets do).`);
      (fn as (v: unknown) => unknown).call(ref.room, JSON.parse(text));
      ctx.status(`${method} sent.`);
      setTimeout(render, 300);
    } catch (error) {
      ctx.status(errorMessage(error), true);
    }
  }

  const timer = setInterval(() => {
    if (auto.checked && !root.hidden && root.isConnected) render();
  }, 1000);
  ctx.signal.addEventListener('abort', () => clearInterval(timer), { once: true });

  root.append(
    h(
      'div',
      { class: 'scroll pad stack' },
      h('div', { class: 'row' }, h('button', { type: 'button', text: 'Refresh', onclick: render }), h('label', { class: 'check' }, auto, 'auto-refresh (1 s)')),
      grid,
      h(
        'fieldset',
        {},
        h('legend', { text: 'Legacy socket updates' }),
        h('div', { class: 'row' }, h('div', { class: 'grow stack' }, presence), h('button', { type: 'button', text: 'updatePresence', onclick: () => call('updatePresence', presence.value) })),
        h('div', { class: 'row' }, h('div', { class: 'grow stack' }, roomState), h('button', { type: 'button', text: 'updateRoomState', onclick: () => call('updateRoomState', roomState.value) })),
      ),
    ),
  );
  render();
}
