// Passive instrumentation installed at document-start in the project frame.
// Every wrapper calls through to the original with the same `this` and
// arguments and returns its result unchanged; logging failures are swallowed.

import { hub, type LogEntry } from './hub';
import { errorMessage, preview, tryParse } from './ui';

const ORIGINAL = Symbol.for('wbsmutil.original');
const PATCHED = Symbol.for('wbsmutil.patched');

type AnyFn = (...args: unknown[]) => unknown;
type Obj = Record<PropertyKey, unknown>;

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as PromiseLike<unknown>).then === 'function';
}

export function unwrap<T>(fn: T): T {
  return ((fn as Obj | undefined)?.[ORIGINAL] as T | undefined) ?? fn;
}

function mark<T extends AnyFn>(wrapper: T, original: AnyFn): T {
  try {
    Object.defineProperty(wrapper, ORIGINAL, { value: original });
    Object.defineProperty(wrapper, PATCHED, { value: true });
    Object.defineProperty(wrapper, 'name', { value: original.name });
    Object.defineProperty(wrapper, 'length', { value: original.length });
  } catch {
    // Non-critical.
  }
  return wrapper;
}

function isPatched(fn: unknown): boolean {
  return typeof fn === 'function' && !!(fn as unknown as Obj)[PATCHED];
}

// ---------------------------------------------------------------- console

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

export function installConsoleHook(): void {
  for (const level of CONSOLE_LEVELS) {
    const original = console[level] as AnyFn;
    if (isPatched(original)) continue;
    console[level] = mark(function (this: unknown, ...args: unknown[]) {
      try {
        hub.console.push({
          tag: 'console',
          level,
          summary: args.map((a) => preview(a, 300)).join(' '),
          detail: args.length === 1 ? args[0] : args,
        });
      } catch {
        // ignore
      }
      return original.apply(this, args);
    }, original);
  }
  window.addEventListener('error', (e) => {
    if (e.error === undefined && !e.message) return; // resource load errors carry no message
    hub.console.push({
      tag: 'error',
      level: 'error',
      summary: e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno}:${e.colno})` : ''),
      detail: e.error ?? { message: e.message, filename: e.filename, line: e.lineno, column: e.colno },
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    hub.console.push({
      tag: 'rejection',
      level: 'error',
      summary: 'Unhandled rejection: ' + preview(e.reason instanceof Error ? e.reason.message : e.reason, 300),
      detail: e.reason,
    });
  });
  hub.hooks.set('console', 'installed');
}

// ---------------------------------------------------------------- fetch

export interface RequestSpec {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

const BODY_LIMIT = 256 * 1024;

function describeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) return '[FormData ' + [...body.keys()].join(', ') + ']';
  if (body instanceof Blob) return `[${body.constructor.name} ${body.size} bytes ${body.type}]`;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[binary ${(body as ArrayBuffer).byteLength} bytes]`;
  return '[' + ((body as object).constructor?.name ?? 'body') + ']';
}

export function installFetchHook(): void {
  const original = window.fetch;
  if (isPatched(original)) return;
  window.fetch = mark(function (this: unknown, ...args: unknown[]) {
    const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
    let entry: LogEntry | null = null;
    const started = performance.now();
    try {
      const req = input instanceof Request ? input : null;
      const url = new URL(req ? req.url : String(input), location.href).href;
      const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      new Headers(init?.headers ?? req?.headers).forEach((v, k) => (headers[k] = v));
      const spec: RequestSpec = { method, url, headers, body: describeBody(init?.body) };
      entry = hub.net.push({
        tag: method,
        level: 'pending',
        summary: shortUrl(url),
        detail: { request: spec },
        data: spec,
      });
    } catch {
      // ignore
    }
    const promise = (original as AnyFn).apply(this, args) as Promise<Response>;
    if (entry) {
      const e = entry;
      promise.then(
        async (res) => {
          e.ms = performance.now() - started;
          e.level = res.ok ? 'ok' : 'error';
          e.summary = res.status + ' ' + shortUrl(res.url || (e.data as RequestSpec).url);
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => (headers[k] = v));
          const response: Record<string, unknown> = { status: res.status, statusText: res.statusText, headers };
          (e.detail as Record<string, unknown>).response = response;
          hub.net.update(e);
          const type = res.headers.get('content-type') ?? '';
          const size = Number(res.headers.get('content-length') ?? '0');
          if (/json|text|javascript|xml/.test(type) && !/event-stream/.test(type) && size <= BODY_LIMIT) {
            try {
              const text = await res.clone().text();
              response.body = type.includes('json') ? tryParse(text) : text.slice(0, BODY_LIMIT);
              hub.net.update(e);
            } catch {
              // body unavailable
            }
          } else response.body = `[${type || 'unknown type'}${size ? ', ' + size + ' bytes' : ''}; not captured]`;
        },
        (error: unknown) => {
          e.ms = performance.now() - started;
          e.level = 'error';
          e.summary = 'FAILED ' + e.summary + ' · ' + errorMessage(error);
          (e.detail as Record<string, unknown>).error = errorMessage(error);
          hub.net.update(e);
        },
      );
    }
    return promise;
  }, original as AnyFn) as typeof fetch;
  hub.hooks.set('fetch', 'installed');
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname + u.search;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------- globals

/**
 * Run `cb` once window[name] exists. Uses a setter trap on window (catches
 * plain assignment the moment it happens) plus polling (catches
 * defineProperty and top-level declarations). `cb` may return a replacement.
 */
function whenGlobal(name: string, cb: (value: unknown, late: boolean) => unknown): void {
  const w = window as unknown as Obj;
  let done = false;
  const fire = (value: unknown, late: boolean): unknown => {
    if (done) return value;
    done = true;
    try {
      return cb(value, late) ?? value;
    } catch (error) {
      hub.hooks.set(name, 'failed: ' + errorMessage(error));
      return value;
    }
  };
  if (w[name] !== undefined) {
    const replacement = fire(w[name], true);
    if (replacement !== w[name]) {
      try {
        w[name] = replacement;
      } catch {
        // non-writable
      }
    }
    return;
  }
  hub.hooks.set(name, 'waiting');
  const desc = Object.getOwnPropertyDescriptor(window, name);
  if (!desc || desc.configurable) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: () => undefined,
        set(value: unknown) {
          const replacement = fire(value, false);
          Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: replacement });
        },
      });
    } catch {
      // fall back to polling
    }
  }
  const started = Date.now();
  const poll = setInterval(() => {
    if (done) return clearInterval(poll);
    let value: unknown;
    try {
      value = w[name];
    } catch {
      value = undefined;
    }
    if (value !== undefined) {
      clearInterval(poll);
      const replacement = fire(value, true);
      if (replacement !== value) {
        try {
          w[name] = replacement;
        } catch {
          // non-writable
        }
      }
    } else if (Date.now() - started > 30000) {
      clearInterval(poll);
      hub.hooks.set(name, 'not found on this page');
    }
  }, 50);
}

// ---------------------------------------------------------------- websim.*

const SKIP = new Set(['addEventListener', 'removeEventListener', 'dispatchEvent', 'constructor']);

function functionKeys(obj: object): string[] {
  const keys = new Set<string>();
  for (let p: object | null = obj; p && p !== Object.prototype && p !== Function.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Object.getOwnPropertyNames(p)) {
      if (SKIP.has(key)) continue;
      try {
        if (typeof (obj as Obj)[key] === 'function') keys.add(key);
      } catch {
        // getter threw
      }
    }
  }
  return [...keys];
}

/** Replace each method of obj with a logging wrapper (own property). */
function wrapMethods(obj: unknown, prefix: string, depth = 0): void {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return;
  const target = obj as Obj;
  for (const key of functionKeys(target)) {
    const fn = target[key] as AnyFn;
    if (isPatched(fn)) continue;
    const path = prefix + key;
    const wrapper = mark(function (this: unknown, ...args: unknown[]) {
      return logCall(path, fn, this, args);
    }, fn);
    // Keep static members of callable namespaces (websim.ai.model, etc).
    for (const k of Object.keys(fn)) {
      try {
        (wrapper as unknown as Obj)[k] = (fn as unknown as Obj)[k];
      } catch {
        // ignore
      }
    }
    try {
      target[key] = wrapper;
    } catch {
      try {
        Object.defineProperty(target, key, { configurable: true, writable: true, value: wrapper });
      } catch {
        continue;
      }
    }
    if (depth < 2) wrapMethods(wrapper, path + '.', depth + 1);
  }
}

function logCall(path: string, fn: AnyFn, self: unknown, args: unknown[]): unknown {
  const started = performance.now();
  const first = args[0];
  const streaming = !!first && typeof first === 'object' && (first as Obj).stream === true;
  const entry = hub.websim.push({
    tag: path,
    level: 'pending',
    summary: path + '(' + (args.length ? preview(first, 160) : '') + ')',
    detail: { args: args.length === 1 ? first : args },
  });
  const done = (value: unknown) => {
    entry.ms = performance.now() - started;
    const failed = !!value && typeof value === 'object' && 'error' in value && !!(value as Obj).error;
    entry.level = failed ? 'error' : 'ok';
    (entry.detail as Obj).result = streaming ? '[stream: chunks go straight to the page and are not captured]' : value;
    entry.summary = path + ' → ' + (streaming ? 'stream' : preview(resultPreview(value), 160));
    hub.websim.update(entry);
    if (path.endsWith('agent.create')) wrapMethods(value, 'agent#');
  };
  const fail = (error: unknown) => {
    entry.ms = performance.now() - started;
    entry.level = 'error';
    (entry.detail as Obj).error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    entry.summary = path + ' ✕ ' + errorMessage(error);
    hub.websim.update(entry);
  };
  let result: unknown;
  try {
    result = fn.apply(self, args);
  } catch (error) {
    fail(error);
    throw error;
  }
  if (isThenable(result)) result.then(done, fail);
  else done(result);
  return result;
}

function resultPreview(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as Obj;
    if (typeof v.content === 'string') return v.content;
    if (typeof v.url === 'string') return v.url;
    if (typeof v.text === 'string') return v.text;
  }
  return value;
}

export function installWebsimHook(): void {
  whenGlobal('websim', (ws, late) => {
    if (!ws || typeof ws !== 'object') return;
    wrapMethods(ws, 'websim.');
    const ns = ws as Obj;
    for (const key of ['chat', 'agent', 'notifications']) {
      const child = ns[key];
      if (child && typeof child === 'object') wrapMethods(child, `websim.${key}.`);
    }
    const chat = ns.chat as Obj | undefined;
    if (chat?.completions && typeof chat.completions === 'object') wrapMethods(chat.completions, 'websim.chat.completions.');
    // Passive listener: comment events are captured even before the tab opens.
    const add = unwrap(ns.addEventListener);
    if (typeof add === 'function') {
      try {
        (add as AnyFn).call(ws, 'comment:created', (data: unknown) => {
          const c = (data as { comment?: Obj } | undefined)?.comment;
          const author = (c?.author as Obj | undefined)?.username;
          hub.comments.push({
            tag: String(author ?? '?'),
            level: 'in',
            summary: preview(c?.raw_content ?? data, 300),
            detail: data,
          });
        });
      } catch {
        // ignore
      }
    }
    hub.hooks.set('websim', late ? 'installed (after page load)' : 'installed');
  });
}

// ---------------------------------------------------------------- rooms

const PASSIVE = function wbsmutilPassive(): void {};
let roomCount = 0;
const attached = new WeakSet<object>();

function roomLabel(room: object): string {
  return hub.rooms.list.find((r) => r.room === room)?.label ?? 'room';
}

/**
 * Hook `obj[prop]` (onmessage etc) so every handler the page assigns is
 * wrapped with `observe`. Works whether the socket implements the property
 * as a plain field or as an accessor on its prototype.
 */
function hookHandler(obj: Obj, prop: string, observe: (args: unknown[]) => void, passive: boolean): void {
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = obj; p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, prop);
  const wrap = (fn: unknown): unknown => {
    if (typeof fn !== 'function' || isPatched(fn)) return fn;
    return mark(function (this: unknown, ...args: unknown[]) {
      try {
        observe(args);
      } catch {
        // ignore
      }
      return (fn as AnyFn).apply(this, args);
    }, fn as AnyFn);
  };
  // With `passive`, a log-only handler is installed whenever the page has
  // none, so incoming packets are seen even if the page only sends.
  const fallback = (v: unknown) => (typeof v === 'function' ? v : passive ? PASSIVE : v);
  if (desc && (desc.get || desc.set) && desc.configurable !== false) {
    const { get, set } = desc;
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const orig = unwrap(get?.call(this));
        return orig === PASSIVE ? null : orig;
      },
      set(v: unknown) {
        set?.call(this, wrap(fallback(v)));
      },
    });
    set?.call(obj, wrap(fallback(get?.call(obj))));
  } else if (!desc || desc.writable !== false) {
    let value = wrap(fallback(desc && 'value' in desc ? desc.value : undefined));
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set(v: unknown) {
        value = wrap(fallback(v));
      },
    });
  }
}

function packetEntry(room: object, level: 'in' | 'out', data: unknown, via: string): void {
  const parsed = tryParse(data);
  const type = parsed && typeof parsed === 'object' && 'type' in parsed ? String((parsed as Obj).type) : '';
  hub.room.push({
    tag: roomLabel(room),
    level,
    summary: (type ? `[${type}] ` : '') + preview(parsed, 300),
    detail: { via, data: parsed },
    data: parsed,
  });
}

/** Start observing a room instance (idempotent). */
export function attachRoom(room: unknown, source: string): void {
  if (!room || typeof room !== 'object' || attached.has(room)) return;
  const r = room as Obj;
  if (typeof r.send !== 'function' && typeof r.collection !== 'function') return;
  attached.add(room);
  const label = `room${++roomCount}`;
  hub.rooms.add({ room: r, label, source });
  hub.room.push({ tag: label, level: 'info', summary: `Attached ${label} (${source})`, detail: { source } });

  for (const method of ['send', 'updatePresence', 'updateRoomState', 'requestPresenceUpdate']) {
    const fn = r[method];
    if (typeof fn !== 'function' || isPatched(fn)) continue;
    try {
      r[method] = mark(function (this: unknown, ...args: unknown[]) {
        packetEntry(room, 'out', args.length === 1 ? args[0] : args, method);
        return (fn as AnyFn).apply(this, args);
      }, fn as AnyFn);
    } catch {
      // read-only
    }
  }
  try {
    hookHandler(r, 'onmessage', (args) => {
      const ev = args[0] as { data?: unknown } | undefined;
      packetEntry(room, 'in', ev && typeof ev === 'object' && 'data' in ev ? ev.data : ev, 'onmessage');
    }, true);
    for (const prop of ['onreconnect', 'onclose', 'onopen']) {
      hookHandler(r, prop, (args) => {
        hub.room.push({
          tag: label,
          level: prop === 'onclose' ? 'warn' : 'info',
          summary: prop.slice(2) + (args[0] && typeof args[0] === 'object' && 'reason' in args[0] ? ': ' + String((args[0] as Obj).reason) : ''),
          detail: args[0],
        });
      }, false);
    }
    hub.hooks.set('room:' + label, 'observing (' + source + ')');
  } catch (error) {
    hub.hooks.set('room:' + label, 'send only; handler hook failed: ' + errorMessage(error));
  }
}

export function installRoomHook(): void {
  whenGlobal('WebsimSocket', (WS, late) => {
    if (typeof WS !== 'function') return;
    const Ctor = WS as unknown as Obj & (new (...a: unknown[]) => object);
    const join = Ctor.joinRoom;
    if (typeof join === 'function' && !isPatched(join)) {
      try {
        Ctor.joinRoom = mark(function (this: unknown, ...args: unknown[]) {
          const result = (join as AnyFn).apply(this, args);
          if (isThenable(result)) result.then((room) => attachRoom(room, 'joinRoom'), () => {});
          else attachRoom(result, 'joinRoom');
          return result;
        }, join as AnyFn);
      } catch {
        // read-only static
      }
    }
    hub.hooks.set('WebsimSocket', late ? 'installed (after page load)' : 'installed');
    // Legacy `new WebsimSocket()`: observe instances as they're constructed.
    return new Proxy(Ctor, {
      construct(target, args, newTarget) {
        const instance = Reflect.construct(target, args, newTarget) as object;
        try {
          attachRoom(instance, 'new WebsimSocket');
        } catch {
          // ignore
        }
        return instance;
      },
    });
  });
}

/** Look for room instances the page already holds in well-known globals. */
export function discoverRooms(): number {
  const before = hub.rooms.list.length;
  const candidates: unknown[] = [];
  try {
    candidates.push(typeof room !== 'undefined' ? room : undefined);
  } catch {
    // TDZ
  }
  const w = window as unknown as Obj;
  candidates.push(w.room, w.websimDBRoom, w.party, w.socket, w.ws);
  for (const key of Object.keys(window)) {
    if (!/room|socket|party|net|multi/i.test(key)) continue;
    try {
      candidates.push(w[key]);
    } catch {
      // ignore
    }
  }
  for (const c of candidates) {
    if (c && typeof c === 'object' && typeof (c as Obj).send === 'function' && ('onmessage' in (c as object) || 'roomState' in (c as object) || 'peers' in (c as object))) {
      attachRoom(c, 'found in page globals');
    }
  }
  return hub.rooms.list.length - before;
}

export function installHooks(): void {
  for (const [name, install] of [
    ['console', installConsoleHook],
    ['fetch', installFetchHook],
    ['websim', installWebsimHook],
    ['WebsimSocket', installRoomHook],
  ] as const) {
    try {
      install();
    } catch (error) {
      hub.hooks.set(name, 'failed: ' + errorMessage(error));
    }
  }
}
