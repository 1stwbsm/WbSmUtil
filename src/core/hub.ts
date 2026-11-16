// Central store for everything the page hooks capture. Hooks run from
// document-start, long before the window opens, so each channel keeps a ring
// buffer that a tool replays when it mounts.

export type Level = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'in' | 'out' | 'sim' | 'ok' | 'pending';

export interface LogEntry {
  id: number;
  time: number;
  /** Short category shown in its own column (method, room label, API name…). */
  tag: string;
  level: Level;
  summary: string;
  /** Shown pretty-printed when the entry is selected. */
  detail?: unknown;
  /** Channel-specific payload (e.g. a request to replay). */
  data?: unknown;
  /** Milliseconds, once known. */
  ms?: number;
}

type Listener = (entry: LogEntry, isNew: boolean) => void;

let nextId = 1;

export class Channel {
  readonly entries: LogEntry[] = [];
  private listeners = new Set<Listener>();
  private clearListeners = new Set<() => void>();

  constructor(readonly max = 500) {}

  push(entry: Omit<LogEntry, 'id' | 'time'> & { time?: number }): LogEntry {
    const full: LogEntry = { id: nextId++, time: entry.time ?? Date.now(), ...entry };
    this.entries.push(full);
    if (this.entries.length > this.max) this.entries.shift();
    for (const fn of this.listeners) safe(() => fn(full, true));
    return full;
  }

  /** Notify listeners that a pushed entry changed (e.g. a request finished). */
  update(entry: LogEntry): void {
    for (const fn of this.listeners) safe(() => fn(entry, false));
  }

  clear(): void {
    this.entries.length = 0;
    for (const fn of this.clearListeners) safe(fn);
  }

  subscribe(fn: Listener, signal: AbortSignal, onClear?: () => void): void {
    this.listeners.add(fn);
    if (onClear) this.clearListeners.add(onClear);
    signal.addEventListener(
      'abort',
      () => {
        this.listeners.delete(fn);
        if (onClear) this.clearListeners.delete(onClear);
      },
      { once: true },
    );
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // A broken listener must never break the page's own code path.
  }
}

export interface RoomRef {
  room: Record<string, unknown>;
  label: string;
  source: string;
}

class RoomRegistry {
  readonly list: RoomRef[] = [];
  private listeners = new Set<() => void>();
  add(ref: RoomRef): void {
    this.list.push(ref);
    for (const fn of this.listeners) safe(fn);
  }
  subscribe(fn: () => void, signal: AbortSignal): void {
    this.listeners.add(fn);
    signal.addEventListener('abort', () => this.listeners.delete(fn), { once: true });
  }
}

export const hub = {
  console: new Channel(1000),
  net: new Channel(500),
  /** Every call into window.websim.* */
  websim: new Channel(500),
  /** Multiplayer packets and room lifecycle. */
  room: new Channel(2000),
  /** comment:created events. */
  comments: new Channel(200),
  rooms: new RoomRegistry(),
  /** Hook name → status text, shown on the Project tab. */
  hooks: new Map<string, string>(),
};
