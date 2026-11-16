// Small DOM and formatting helpers shared by tools.

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> | null | undefined;

/**
 * Element builder. `class`, `text`, `style` (string), `on<event>` handlers,
 * boolean `hidden`, `dataset` object; anything else is set as a property when
 * the element has it, otherwise as an attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'style') el.setAttribute('style', String(value));
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'error' in error) return String((error as { error: unknown }).error);
  return String(error);
}

/** JSON.stringify that survives cycles, functions, DOM nodes, errors and huge values. */
export function pretty(value: unknown, indent = 2, maxDepth = 8): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (typeof v === 'symbol') return v.toString();
    if (typeof v === 'string') return v.length > 50000 ? v.slice(0, 50000) + `… (${v.length} chars)` : v;
    if (v === undefined) return '[undefined]';
    if (!v || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    if (depth > maxDepth) return Array.isArray(v) ? `[Array(${v.length})]` : '[Object]';
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof Node !== 'undefined' && v instanceof Node) return `[${v.nodeName.toLowerCase()}]`;
    if (typeof Blob !== 'undefined' && v instanceof Blob) return `[${v.constructor.name} ${v.size} bytes ${v.type}]`;
    if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength} bytes]`;
    if (ArrayBuffer.isView(v)) return `[${v.constructor.name} ${v.byteLength} bytes]`;
    if (typeof MessageEvent !== 'undefined' && v instanceof MessageEvent) return { type: v.type, data: walk(v.data, depth + 1) };
    if (typeof Event !== 'undefined' && v instanceof Event) return `[${v.constructor.name} ${v.type}]`;
    if (v instanceof Map) return { '[Map]': walk(Object.fromEntries(v), depth + 1) };
    if (v instanceof Set) return { '[Set]': walk([...v], depth + 1) };
    if (v instanceof Promise) return '[Promise]';
    seen.add(v);
    if (Array.isArray(v)) {
      const out = v.slice(0, 500).map((x) => walk(x, depth + 1));
      if (v.length > 500) out.push(`… ${v.length - 500} more`);
      return out;
    }
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const key in v) {
      if (n++ >= 300) {
        out['…'] = 'more keys omitted';
        break;
      }
      try {
        out[key] = walk((v as Record<string, unknown>)[key], depth + 1);
      } catch (error) {
        out[key] = `[Threw: ${errorMessage(error)}]`;
      }
    }
    return out;
  };
  try {
    const result = JSON.stringify(walk(value, 0), null, indent);
    return result === undefined ? String(value) : result;
  } catch (error) {
    return `[Unserializable: ${errorMessage(error)}]`;
  }
}

/** One-line preview for log rows. */
export function preview(value: unknown, max = 200): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value === undefined) text = 'undefined';
  else text = pretty(value, 0, 3);
  text = text.replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** Parse a JSON string, or return the original when it isn't JSON. */
export function tryParse(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  const t = text.trim();
  if (!t || !'{["0123456789-tfn'.includes(t[0] ?? '')) return text;
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

export function clock(time: number): string {
  const d = new Date(time);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function avatar(username: string | undefined | null): HTMLImageElement | null {
  if (!username) return null;
  return h('img', {
    class: 'avatar',
    src: `https://images.websim.com/avatar/${encodeURIComponent(username)}`,
    alt: '',
    loading: 'lazy',
  });
}

export function jsonBlock(value: unknown): HTMLPreElement {
  return h('pre', { class: 'json', text: typeof value === 'string' ? value : pretty(value) });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface SubTab {
  id: string;
  label: string;
  el: HTMLElement;
  /** Called the first time the sub-tab is shown. */
  init?(): void;
}

/** Segmented sub-navigation inside a tool pane. Returns a selector. */
export function subtabs(host: HTMLElement, tabs: SubTab[]): (id: string) => void {
  const nav = h('nav', { class: 'subtabs' });
  const body = h('div', { class: 'subbody' });
  const started = new Set<string>();
  const buttons = new Map<string, HTMLButtonElement>();
  const select = (id: string) => {
    for (const tab of tabs) {
      const on = tab.id === id;
      tab.el.hidden = !on;
      buttons.get(tab.id)?.classList.toggle('active', on);
      if (on && !started.has(tab.id)) {
        started.add(tab.id);
        tab.init?.();
      }
    }
  };
  for (const tab of tabs) {
    tab.el.classList.add('subview');
    tab.el.hidden = true;
    const b = h('button', { type: 'button', text: tab.label, onclick: () => select(tab.id) });
    buttons.set(tab.id, b);
    nav.append(b);
    body.append(tab.el);
  }
  host.append(nav, body);
  const first = tabs[0];
  if (first) select(first.id);
  return select;
}

/** Read a file as a data: URL. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Parse JSON from a textarea with a readable error. Empty → fallback. */
export function parseJsonField(text: string, label: string, fallback?: unknown): unknown {
  if (!text.trim()) {
    if (fallback !== undefined) return fallback;
    throw new Error(label + ' is empty.');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(label + ': ' + errorMessage(error));
  }
}
