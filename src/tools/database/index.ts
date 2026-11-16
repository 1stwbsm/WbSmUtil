import css from './database.css';
import { errorMessage } from '../../core/shell';
import type { Tool, ToolContext } from '../../core/tool';
import { findSocket, type LegacySocket, type WebsimRecord } from '../../core/websim';
import { crawlSources } from '../../core/source';
import { scanCollections } from './source-scan';
import { entryTemplate } from './template';

const PAGE_SIZE = 100;
const NO_ROOM =
  'No room. The page has no database room (room.collection) yet, and WbSmUtil does not create one. Scan again once the page has joined.';
const SCAN_PAGE = 1000;
const SCAN_MAX_OFFSET = 10000;

const ACTIONS = `
<button class="scan" title="Discover collections from records, schema and project source">Scan</button>
<button class="refresh">Refresh</button>
<button class="new">+ Entry</button>`;

const PANE = `
<aside class="side">
  <nav class="names" aria-label="Collections"></nav>
  <form class="manual"><input placeholder="Collection" aria-label="Collection name" required><button title="Open collection">↵</button></form>
</aside>
<div class="view">
  <div class="tools"><span class="name">Collections</span><input class="filter" placeholder="Filter page" aria-label="Filter loaded records"></div>
  <div class="records"></div>
  <form class="panel editor" hidden>
    <div class="panel-head"><strong>New entry</strong><button type="button" class="cancel">Cancel</button></div>
    <span class="hint">JSON object. Submitted as entered; Websim enforces its schema and permissions.</span>
    <textarea aria-label="Entry JSON" spellcheck="false">{}</textarea>
    <span class="entry-status" role="alert"></span>
    <button class="save">Create</button>
  </form>
  <section class="panel detail" hidden>
    <div class="panel-head"><strong>Record</strong><button class="use-template">Use as template</button><button class="back">Back</button></div>
    <pre></pre>
  </section>
</div>`;

const FOOT = `
<span class="page"></span>
<button class="prev" aria-label="Previous page">‹</button>
<button class="next" aria-label="Next page">›</button>`;

export const databaseTool: Tool = {
  id: 'database',
  label: 'Database',
  css,
  mount,
};

async function mount(ctx: ToolContext): Promise<void> {
  const { $, on, wait, status, stopped } = ctx;
  ctx.pane.classList.add('db');
  ctx.pane.innerHTML = PANE;
  ctx.actions.innerHTML = ACTIONS;
  ctx.foot.innerHTML = FOOT;

  let db: LegacySocket | null = null;
  let current = '';
  let offset = 0;
  let records: WebsimRecord[] = [];
  let loadId = 0;
  let scanning = false;
  let saving = false;
  const names = new Set<string>();
  const origins = new Map<string, Set<string>>();
  const samples = new Map<string, WebsimRecord>();

  const recordsEl = $('.records');
  const filter = $<HTMLInputElement>('.filter');
  const manualInput = $<HTMLInputElement>('.manual input');
  const editor = $<HTMLFormElement>('.editor');
  const textarea = $<HTMLTextAreaElement>('.editor textarea');
  const detail = $('.detail');
  const pageEl = $('.page');

  function message(text: string): void {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = text;
    recordsEl.replaceChildren(p);
  }

  function add(name: unknown, source: string): void {
    if (typeof name !== 'string' || !name.trim()) return;
    names.add(name);
    let set = origins.get(name);
    if (!set) origins.set(name, (set = new Set()));
    set.add(source);
  }

  function sidebar(): void {
    const frag = document.createDocumentFragment();
    for (const name of [...names].sort()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.dataset.name = name;
      b.title = [...(origins.get(name) ?? [])].join(', ');
      b.className = name === current ? 'active' : '';
      frag.append(b);
    }
    $('.names').replaceChildren(frag);
  }
  on<MouseEvent>($('.names'), 'click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-name]');
    if (b?.dataset.name) select(b.dataset.name);
  });

  function render(): void {
    const search = filter.value.toLowerCase();
    const list = records.filter((r) => JSON.stringify(r).toLowerCase().includes(search));
    pageEl.textContent = records.length ? offset + 1 + '–' + (offset + records.length) : '0';
    if (!list.length) {
      message(search ? 'No matching records on this page.' : 'No records returned.');
      return;
    }
    const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const header = document.createElement('tr');
    for (const key of columns) {
      const th = document.createElement('th');
      th.textContent = key;
      header.append(th);
    }
    thead.append(header);
    table.append(thead);
    const body = document.createElement('tbody');
    for (const record of list) {
      const index = records.indexOf(record);
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.dataset.record = String(index);
      tr.setAttribute('aria-label', 'Inspect record ' + (record.id ?? index));
      for (const key of columns) {
        const td = document.createElement('td');
        const value = record[key];
        td.textContent =
          value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        td.title = td.textContent;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    recordsEl.replaceChildren(table);
  }

  function inspect(e: Event): void {
    const row = (e.target as Element).closest<HTMLElement>('tr[data-record]');
    if (!row) return;
    const record = records[Number(row.dataset.record)];
    if (!record) return;
    samples.set(current, record);
    $('.detail pre').textContent = JSON.stringify(record, null, 2);
    detail.hidden = false;
  }
  on(recordsEl, 'click', inspect);
  on<KeyboardEvent>(recordsEl, 'keydown', (e) => {
    if (e.key === 'Enter') inspect(e);
  });
  on($('.back'), 'click', () => (detail.hidden = true));

  /** Read one page of a collection, or of all records when name is null. */
  async function read(name: string | null, skip: number, size: number): Promise<unknown> {
    db ??= findSocket();
    if (!db) throw new Error(NO_ROOM);
    // Fetch directly when available: getList() may return an already cached list.
    if (typeof db.getDatabaseRecords === 'function') {
      return wait(db.getDatabaseRecords(name === null ? {} : { $type: name }, { limit: size, offset: skip }));
    }
    if (name === null) throw new Error('This socket has no all-records reader. Scanning project source instead.');
    let query = db.collection(name);
    const limited = typeof query.limit === 'function';
    if (query.limit) query = query.limit(size);
    if (query.offset) query = query.offset(skip);
    else if (skip) throw new Error('This socket does not support pagination.');
    const rows = await wait(query.getList());
    return limited ? rows : rows.slice(0, size);
  }

  async function load(): Promise<void> {
    if (stopped()) return;
    if (!current) {
      status('Select a collection, or enter its name.');
      return;
    }
    const id = ++loadId;
    const target = current;
    status('Reading ' + target + '…');
    message('Loading…');
    try {
      const result = await read(target, offset, PAGE_SIZE);
      if (stopped() || id !== loadId) return;
      if (!Array.isArray(result)) throw new Error('Websim returned a non-array response.');
      records = result as WebsimRecord[];
      const first = records[0];
      if (first && !samples.has(target)) samples.set(target, first);
      render();
      status(target + ' · ' + records.length + ' records on this page');
    } catch (error) {
      if (stopped() || id !== loadId) return;
      records = [];
      pageEl.textContent = '';
      message(errorMessage(error));
      status('Read failed: ' + errorMessage(error), true);
    }
  }

  function select(name: string): void {
    current = name;
    offset = 0;
    $('.name').textContent = name;
    filter.value = '';
    editor.hidden = true;
    detail.hidden = true;
    sidebar();
    void load();
  }

  on<SubmitEvent>($('.manual'), 'submit', (e) => {
    e.preventDefault();
    const name = manualInput.value.trim();
    if (!name) return;
    add(name, 'manual');
    manualInput.value = '';
    select(name);
  });
  on($('.refresh'), 'click', () => void load());
  on(filter, 'input', render);
  on($('.prev'), 'click', () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    void load();
  });
  on($('.next'), 'click', () => {
    if (records.length < PAGE_SIZE) {
      status('End of returned records.');
      return;
    }
    offset += PAGE_SIZE;
    void load();
  });

  function newEntry(): void {
    if (!current) {
      manualInput.focus();
      status('Enter or select the destination collection.');
      return;
    }
    const sample = samples.get(current);
    textarea.value = JSON.stringify(entryTemplate(sample), null, 2);
    $('.editor .hint').textContent = sample
      ? 'Template inferred from ' + (sample.id ?? 'a record') + '. Metadata omitted; review before creating.'
      : 'No record available to infer a template. Enter a JSON object.';
    $('.editor strong').textContent = 'New entry / ' + current;
    $('.entry-status').textContent = '';
    detail.hidden = true;
    editor.hidden = false;
    textarea.focus();
  }
  on($('.new'), 'click', newEntry);
  on($('.use-template'), 'click', newEntry);
  on($('.cancel'), 'click', () => (editor.hidden = true));

  on<SubmitEvent>(editor, 'submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const target = current;
    const save = $('.save');
    try {
      const value: unknown = JSON.parse(textarea.value);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Entry must be a JSON object.');
      db ??= findSocket();
      if (!db) throw new Error(NO_ROOM);
      saving = true;
      save.textContent = 'Creating…';
      $('.entry-status').textContent = '';
      const created = await wait(db.collection(target).create(value as Record<string, unknown>));
      if (stopped()) return;
      if (current === target) {
        editor.hidden = true;
        offset = 0;
        await load();
      }
      if (!stopped()) status('Created ' + (created?.id ?? 'entry') + ' in ' + target);
    } catch (error) {
      if (!stopped()) {
        $('.entry-status').textContent = errorMessage(error);
        status('Create failed: ' + errorMessage(error), true);
      }
    } finally {
      saving = false;
      if (!stopped()) save.textContent = 'Create';
    }
  });

  function addSchemaNames(): void {
    if (db?.schema && typeof db.schema === 'object') for (const name of Object.keys(db.schema)) add(name, 'socket schema');
  }

  async function scan(): Promise<void> {
    if (stopped() || scanning) return;
    scanning = true;
    const button = $('.scan');
    button.textContent = 'Scanning…';
    status('Scanning schema, records and project source…');
    let databaseError = '';
    let total = 0;
    let capped = false;
    try {
      addSchemaNames();
      sidebar();
      const sources = crawlSources({
        signal: ctx.signal,
        stopped,
        onText: (text) => scanCollections(text, add),
        progress: sidebar,
      });
      db ??= findSocket();
      if (db) {
        try {
          for (let skip = 0; skip <= SCAN_MAX_OFFSET && !stopped(); skip += SCAN_PAGE) {
            const rows = await read(null, skip, SCAN_PAGE);
            if (stopped()) return;
            if (!Array.isArray(rows)) throw new Error('All-records reader returned a non-array response.');
            total += rows.length;
            for (const row of rows as WebsimRecord[]) {
              const name = row.$type ?? row.type;
              add(name, 'database records');
              if (typeof name === 'string' && !samples.has(name)) samples.set(name, row);
            }
            sidebar();
            if (rows.length < SCAN_PAGE) break;
            if (skip === SCAN_MAX_OFFSET) capped = true;
          }
        } catch (error) {
          databaseError = errorMessage(error);
        }
      } else databaseError = NO_ROOM;
      const sourceSummary = await sources;
      if (stopped()) return;
      addSchemaNames();
      sidebar();
      const summary =
        names.size +
        ' collections · ' +
        total +
        ' records scanned' +
        (capped ? ` (${(SCAN_MAX_OFFSET + SCAN_PAGE).toLocaleString('en-US')}-record limit)` : '') +
        ' · ' +
        sourceSummary +
        (databaseError ? ' · Database scan: ' + databaseError : '');
      const firstName = [...names].sort()[0];
      if (!current && firstName) select(firstName);
      else if (!current) {
        message(
          'No collections discovered.\n' +
            (databaseError || 'No typed records or static collection references found.') +
            '\nDynamic or unreferenced empty collections may not be discoverable. Enter a name to read one directly.' +
            '\nPrivate server.js databases require an endpoint provided by that project.',
        );
      }
      status(summary, Boolean(databaseError));
    } catch (error) {
      if (!stopped()) status('Scan failed: ' + errorMessage(error), true);
    } finally {
      scanning = false;
      if (!stopped()) button.textContent = 'Scan';
    }
  }
  on($('.scan'), 'click', () => void scan());

  try {
    db = findSocket();
    if (db && typeof db.initialize === 'function') await wait(db.initialize(), 15000);
  } catch (error) {
    if (!stopped()) status('Socket initialization: ' + errorMessage(error), true);
  }
  if (!stopped()) await scan();
}
