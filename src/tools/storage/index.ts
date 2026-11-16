import type { Tool, ToolContext } from '../../core/tool';
import { errorMessage, h, jsonBlock, pretty, subtabs, tryParse } from '../../core/ui';

export const storageTool: Tool = {
  id: 'storage',
  label: 'Storage',
  css: `
.st-editor { width: 42%; flex: none; border-left: 1px solid #303841; }
.st-editor textarea { flex: 1; min-height: 120px; resize: none; }
.st-dbs { width: 180px; flex: none; border-right: 1px solid #303841; }
.st-dbs button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; }
.st-dbs button.active { background: #3c4c37; color: #d6e8cb; }
.st-dbs h4 { margin: 6px 8px 2px; font-size: 10px; color: #8c98a4; font-weight: 400; text-transform: uppercase; }
`,
  mount(ctx) {
    const local = h('div');
    const session = h('div');
    const idb = h('div');
    const cookies = h('div');
    subtabs(ctx.pane, [
      { id: 'local', label: 'localStorage', el: local, init: () => kvStorage(ctx, local, () => localStorage, 'localStorage') },
      { id: 'session', label: 'sessionStorage', el: session, init: () => kvStorage(ctx, session, () => sessionStorage, 'sessionStorage') },
      { id: 'idb', label: 'IndexedDB', el: idb, init: () => indexedDbView(ctx, idb) },
      { id: 'cookies', label: 'Cookies', el: cookies, init: () => cookieView(cookies) },
    ]);
  },
};

function kvStorage(ctx: ToolContext, root: HTMLElement, get: () => Storage, label: string): void {
  const tbody = h('tbody');
  const key = h('input', { class: 'code', placeholder: 'key' });
  const value = h('textarea', { class: 'code', spellcheck: false });
  const filter = h('input', { placeholder: 'Filter keys', class: 'grow' });
  const info = h('span', { class: 'muted' });
  let selected: string | null = null;

  function storage(): Storage {
    try {
      return get();
    } catch (error) {
      throw new Error(label + ' is blocked here: ' + errorMessage(error));
    }
  }

  function render(): void {
    let s: Storage;
    try {
      s = storage();
    } catch (error) {
      tbody.replaceChildren(h('tr', {}, h('td', { class: 'error-text', text: errorMessage(error) })));
      return;
    }
    const term = filter.value.toLowerCase();
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null && k.toLowerCase().includes(term)) keys.push(k);
    }
    keys.sort();
    let bytes = 0;
    tbody.replaceChildren(
      ...keys.map((k) => {
        const v = s.getItem(k) ?? '';
        bytes += (k.length + v.length) * 2;
        return h(
          'tr',
          { class: k === selected ? 'selected' : '', tabIndex: 0, onclick: () => pick(k) },
          h('td', { text: k, title: k }),
          h('td', { text: v.slice(0, 200), title: v.slice(0, 1000) }),
          h('td', { class: 'muted', text: v.length.toLocaleString() }),
        );
      }),
    );
    info.textContent = `${keys.length} keys · ~${(bytes / 1024).toFixed(1)} KB`;
  }

  function pick(k: string): void {
    selected = k;
    key.value = k;
    const v = storage().getItem(k) ?? '';
    const parsed = tryParse(v);
    value.value = typeof parsed === 'object' && parsed !== null ? pretty(parsed) : v;
    render();
  }

  function save(): void {
    try {
      const k = key.value;
      if (!k) throw new Error('Enter a key.');
      // Store JSON compactly if it parses, otherwise exactly as typed.
      const parsed = tryParse(value.value);
      const text = typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed) : value.value;
      storage().setItem(k, text);
      if (selected && selected !== k) ctx.status(`Saved as new key “${k}” (“${selected}” kept).`);
      else ctx.status(`Saved “${k}”.`);
      selected = k;
      render();
    } catch (error) {
      ctx.status('Save failed: ' + errorMessage(error), true);
    }
  }

  filter.addEventListener('input', render);
  root.append(
    h('div', { class: 'row pad' }, filter, h('button', { type: 'button', text: 'Refresh', onclick: render }), info),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'scroll' },
        h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', { text: 'Key' }), h('th', { text: 'Value' }), h('th', { text: 'Chars' }))), tbody),
      ),
      h(
        'div',
        { class: 'st-editor pad stack' },
        key,
        value,
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', class: 'primary', text: 'Save', onclick: save }),
          h('button', {
            type: 'button',
            text: 'New',
            onclick: () => {
              selected = null;
              key.value = '';
              value.value = '';
              key.focus();
              render();
            },
          }),
          h('button', {
            type: 'button',
            class: 'danger',
            text: 'Delete',
            onclick: () => {
              if (!key.value) return;
              storage().removeItem(key.value);
              ctx.status(`Deleted “${key.value}”.`);
              selected = null;
              key.value = value.value = '';
              render();
            },
          }),
          h('button', {
            type: 'button',
            class: 'danger',
            text: 'Clear all',
            onclick: () => {
              if (!confirm(`Remove every ${label} key for ${location.origin}?`)) return;
              storage().clear();
              render();
            },
          }),
        ),
      ),
    ),
  );
  render();
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function indexedDbView(ctx: ToolContext, root: HTMLElement): void {
  const side = h('div', { class: 'st-dbs scroll' });
  const main = h('div', { class: 'scroll pad stack' });

  async function listDbs(): Promise<void> {
    side.replaceChildren(h('div', { class: 'muted pad', text: 'Loading…' }));
    try {
      if (typeof indexedDB.databases !== 'function') throw new Error('indexedDB.databases() is not supported by this browser.');
      const dbs = await indexedDB.databases();
      side.replaceChildren(h('h4', { text: 'Databases' }));
      if (!dbs.length) side.append(h('div', { class: 'muted pad', text: 'None' }));
      for (const info of dbs) {
        if (!info.name) continue;
        const name = info.name;
        side.append(h('button', { type: 'button', text: `${name} (v${info.version ?? '?'})`, onclick: () => void openDb(name) }));
      }
    } catch (error) {
      side.replaceChildren(h('div', { class: 'error-text pad', text: errorMessage(error) }));
    }
  }

  async function openDb(name: string): Promise<void> {
    main.replaceChildren(h('span', { class: 'muted', text: 'Opening…' }));
    let db: IDBDatabase | null = null;
    try {
      // Only listed databases are opened, so this never creates one.
      db = await ctx.wait(req(indexedDB.open(name)));
      const stores = [...db.objectStoreNames];
      const out: HTMLElement[] = [h('strong', { text: name })];
      for (const store of stores) {
        const tx = db.transaction(store, 'readonly');
        const os = tx.objectStore(store);
        const count = await req(os.count());
        const rows: { key: unknown; value: unknown }[] = [];
        await new Promise<void>((resolve, reject) => {
          const cur = os.openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c || rows.length >= 100) return resolve();
            rows.push({ key: c.key, value: c.value });
            c.continue();
          };
          cur.onerror = () => reject(cur.error);
        });
        out.push(
          h(
            'details',
            { open: stores.length === 1 },
            h('summary', { text: `${store} · ${count} records${count > 100 ? ' (first 100)' : ''} · key ${pretty(os.keyPath, 0)} · indexes: ${[...os.indexNames].join(', ') || 'none'}` }),
            jsonBlock(rows),
          ),
        );
      }
      if (!stores.length) out.push(h('span', { class: 'muted', text: 'No object stores.' }));
      main.replaceChildren(...out, h('p', { class: 'hint', text: 'Read-only view.' }));
    } catch (error) {
      main.replaceChildren(h('div', { class: 'error-text', text: errorMessage(error) }));
    } finally {
      db?.close();
    }
  }

  root.append(h('div', { class: 'row pad' }, h('button', { type: 'button', text: 'Refresh', onclick: () => void listDbs() })), h('div', { class: 'split' }, side, main));
  void listDbs();
}

function cookieView(root: HTMLElement): void {
  const tbody = h('tbody');
  const render = () => {
    const pairs = document.cookie ? document.cookie.split('; ').map((c) => [c.slice(0, c.indexOf('=')), decodeURIComponent(c.slice(c.indexOf('=') + 1))]) : [];
    tbody.replaceChildren(
      ...(pairs.length ? pairs.map(([k, v]) => h('tr', {}, h('td', { text: k ?? '' }), h('td', { text: v ?? '', title: v ?? '' }))) : [h('tr', {}, h('td', { class: 'muted', text: 'No script-readable cookies (HttpOnly cookies are hidden from pages).' }))]),
    );
  };
  root.append(
    h('div', { class: 'row pad' }, h('button', { type: 'button', text: 'Refresh', onclick: render })),
    h('div', { class: 'scroll' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Value' }))), tbody)),
  );
  render();
}
