import type { Channel, Level, LogEntry } from './hub';
import { clock, copyText, h, pretty } from './ui';

export interface LogAction {
  label: string;
  run(entry: LogEntry): void;
}

export interface LogViewOptions {
  channel: Channel;
  signal: AbortSignal;
  /** Fixed predicate: which channel entries this view shows at all. */
  include?(entry: LogEntry): boolean;
  /** Buttons shown above the detail of a selected entry. */
  actions?: LogAction[];
  /** Offer a level dropdown with these levels. */
  levels?: Level[];
  /** Text for the empty state. */
  empty?: string;
  /** Extra toolbar nodes (after the filter). */
  tools?: Node[];
  /** Column header for the tag column. */
  tagLabel?: string;
  /** Detail renderer; defaults to pretty JSON of entry.detail. */
  renderDetail?(entry: LogEntry): Node;
}

const MAX_ROWS = 1000;

/**
 * A filterable, pausable live log over a hub channel, with a detail pane.
 * Filter syntax: space-separated terms, all must match; prefix with - to exclude.
 */
export function logView(opts: LogViewOptions): { el: HTMLElement; select(entry: LogEntry): void } {
  const { channel, signal } = opts;
  let paused = false;
  let selected: LogEntry | null = null;
  let queue: LogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let held = 0;
  const rows = new Map<number, HTMLElement>();

  const filterInput = h('input', {
    class: 'log-filter',
    placeholder: 'Filter (-term excludes)',
    'aria-label': 'Filter entries',
    oninput: () => rebuild(),
  });
  const levelSelect = opts.levels
    ? h(
        'select',
        { 'aria-label': 'Level', onchange: () => rebuild() },
        h('option', { value: '', text: 'All' }),
        opts.levels.map((l) => h('option', { value: l, text: l })),
      )
    : null;
  const pauseBtn = h('button', {
    type: 'button',
    text: 'Pause',
    title: 'Stop adding new rows (entries are still recorded)',
    onclick: () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      pauseBtn.classList.toggle('on', paused);
      if (!paused) rebuild();
    },
  });
  const count = h('span', { class: 'muted log-count' });
  const list = h('div', { class: 'log-list', role: 'list' });
  const detailBody = h('div', { class: 'log-detail-body' });
  const detailActions = h('div', { class: 'log-detail-actions' });
  const detail = h(
    'div',
    { class: 'log-detail', hidden: true },
    h(
      'div',
      { class: 'log-detail-head' },
      detailActions,
      h('button', {
        type: 'button',
        text: 'Copy',
        onclick: () => {
          if (selected) void copyText(pretty(selected.detail ?? selected));
        },
      }),
      h('button', { type: 'button', text: '×', 'aria-label': 'Close detail', onclick: () => select(null) }),
    ),
    detailBody,
  );
  const header = h(
    'div',
    { class: 'log-row log-head' },
    h('span', { class: 'c-time', text: 'Time' }),
    h('span', { class: 'c-tag', text: opts.tagLabel ?? 'Type' }),
    h('span', { class: 'c-sum', text: 'Summary' }),
    h('span', { class: 'c-ms', text: 'ms' }),
  );
  const el = h(
    'div',
    { class: 'log' },
    h(
      'div',
      { class: 'log-tools' },
      filterInput,
      levelSelect,
      ...(opts.tools ?? []),
      pauseBtn,
      h('button', { type: 'button', text: 'Clear', onclick: () => channel.clear() }),
      count,
    ),
    h('div', { class: 'log-body' }, h('div', { class: 'log-scroll' }, header, list), detail),
  );

  function matches(entry: LogEntry): boolean {
    if (opts.include && !opts.include(entry)) return false;
    const level = levelSelect?.value;
    if (level && entry.level !== level) return false;
    const terms = filterInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = (entry.tag + ' ' + entry.level + ' ' + entry.summary).toLowerCase();
    return terms.every((t) => (t.startsWith('-') && t.length > 1 ? !hay.includes(t.slice(1)) : hay.includes(t)));
  }

  function fill(row: HTMLElement, entry: LogEntry): void {
    row.className = 'log-row lv-' + entry.level + (entry === selected ? ' selected' : '');
    row.replaceChildren(
      h('span', { class: 'c-time', text: clock(entry.time) }),
      h('span', { class: 'c-tag', text: entry.tag, title: entry.tag }),
      h('span', { class: 'c-sum', text: entry.summary, title: entry.summary.slice(0, 2000) }),
      h('span', { class: 'c-ms', text: entry.ms === undefined ? '' : String(Math.round(entry.ms)) }),
    );
  }

  function addRow(entry: LogEntry): void {
    const row = h('div', { role: 'listitem', tabIndex: 0 });
    row.dataset.id = String(entry.id);
    fill(row, entry);
    rows.set(entry.id, row);
    list.append(row);
    while (list.childElementCount > MAX_ROWS) {
      const first = list.firstElementChild as HTMLElement | null;
      if (!first) break;
      rows.delete(Number(first.dataset.id));
      first.remove();
    }
  }

  function updateCount(): void {
    count.textContent = rows.size + ' shown' + (held ? ` · ${held} held` : '');
  }

  function stickToBottom<T>(fn: () => T): T {
    const scroller = list.parentElement!;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 30;
    const result = fn();
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    return result;
  }

  function rebuild(): void {
    held = 0;
    queue = [];
    rows.clear();
    stickToBottom(() => {
      list.replaceChildren();
      const visible = channel.entries.filter(matches).slice(-MAX_ROWS);
      for (const entry of visible) addRow(entry);
      if (!visible.length) list.append(h('div', { class: 'empty', text: opts.empty ?? 'Nothing captured yet.' }));
    });
    updateCount();
  }

  function flush(): void {
    flushTimer = null;
    const batch = queue;
    queue = [];
    if (!batch.length) return;
    stickToBottom(() => {
      list.querySelector(':scope > .empty')?.remove();
      for (const entry of batch) addRow(entry);
    });
    updateCount();
  }

  function select(entry: LogEntry | null): void {
    rows.get(selected?.id ?? -1)?.classList.remove('selected');
    selected = entry;
    detail.hidden = !entry;
    if (!entry) return;
    rows.get(entry.id)?.classList.add('selected');
    renderDetail();
  }

  function renderDetail(): void {
    if (!selected) return;
    const entry = selected;
    detailActions.replaceChildren(
      ...(opts.actions ?? []).map((a) =>
        h('button', { type: 'button', text: a.label, onclick: () => a.run(entry) }),
      ),
    );
    detailBody.replaceChildren(
      opts.renderDetail ? opts.renderDetail(entry) : h('pre', { class: 'json', text: pretty(entry.detail ?? entry.summary) }),
    );
  }

  const pick = (e: Event) => {
    const row = (e.target as Element).closest<HTMLElement>('.log-row[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id);
    const entry = channel.entries.find((x) => x.id === id);
    if (entry) select(entry);
  };
  list.addEventListener('click', pick);
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pick(e);
  });

  channel.subscribe(
    (entry, isNew) => {
      if (isNew) {
        if (!matches(entry)) return;
        if (paused) {
          held++;
          updateCount();
          return;
        }
        queue.push(entry);
        flushTimer ??= setTimeout(flush, 50);
      } else {
        const row = rows.get(entry.id);
        if (row) fill(row, entry);
        if (entry === selected) renderDetail();
      }
    },
    signal,
    () => {
      select(null);
      rebuild();
    },
  );
  signal.addEventListener('abort', () => flushTimer && clearTimeout(flushTimer), { once: true });

  rebuild();
  return { el, select };
}
