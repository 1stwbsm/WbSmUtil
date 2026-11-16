/**
 * A WbSmUtil tool: one tab of the toolkit window. To add a tool, implement
 * this interface and list it in src/tools/index.ts.
 */
export interface Tool {
  /** Stable id, used for the tab and DOM lookups. */
  id: string;
  /** Tab label. */
  label: string;
  /** Styles added to the shared shadow root. Scope selectors to your markup. */
  css?: string;
  /** Called once, the first time the tool's tab is shown. */
  mount(ctx: ToolContext): void | Promise<void>;
}

export interface ToolContext {
  /** Main content area for this tool. */
  pane: HTMLElement;
  /** Slot in the title bar, shown while this tool is active. */
  actions: HTMLElement;
  /** Slot in the footer next to the status line, shown while active. */
  foot: HTMLElement;
  /** Aborted when the window closes. Pass it to fetch() and listeners. */
  signal: AbortSignal;
  /** True once the window has closed; bail out of async work. */
  stopped(): boolean;
  /** querySelector over this tool's pane, actions and foot. Throws if missing. */
  $<T extends Element = HTMLElement>(selector: string): T;
  /** addEventListener that is removed automatically on close. */
  on<E extends Event = Event>(el: EventTarget, type: string, fn: (event: E) => void): void;
  /** Race a promise against a timeout and the window closing. */
  wait<T>(promise: PromiseLike<T> | T, ms?: number): Promise<T>;
  /** Update the shared status line. */
  status(text: string, error?: boolean): void;
  /** Switch to another tool's tab by id. */
  open(id: string): void;
}
