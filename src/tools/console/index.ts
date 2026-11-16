import { hub } from '../../core/hub';
import { logView } from '../../core/logview';
import type { Tool } from '../../core/tool';
import { h, preview } from '../../core/ui';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => () => Promise<unknown>;

export const consoleTool: Tool = {
  id: 'console',
  label: 'Console',
  css: `
.con-input { border-top: 1px solid #303841; flex-wrap: nowrap; align-items: stretch; }
.con-input textarea { resize: none; }
`,
  mount(ctx) {
    const input = h('textarea', {
      class: 'code grow',
      rows: 2,
      placeholder: 'JavaScript in the project frame (Enter runs, Shift+Enter newline). await works.',
      spellcheck: false,
    });
    const history: string[] = [];
    let cursor = 0;

    async function run(): Promise<void> {
      const code = input.value;
      if (!code.trim()) return;
      history.push(code);
      cursor = history.length;
      input.value = '';
      hub.console.push({ tag: 'eval', level: 'debug', summary: '› ' + code.replace(/\s+/g, ' '), detail: code });
      try {
        let result: unknown;
        try {
          // Expression first, so `room.peers` prints without `return`.
          result = await new AsyncFunction(`return (${code}\n)`)();
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          result = await new AsyncFunction(code)();
        }
        hub.console.push({ tag: 'eval', level: 'info', summary: '‹ ' + preview(result, 400), detail: result });
      } catch (error) {
        const blocked = error instanceof EvalError || /unsafe-eval|Content Security Policy/i.test(String(error));
        hub.console.push({
          tag: 'eval',
          level: 'error',
          summary: '‹ ' + (blocked ? 'Blocked by the page’s Content-Security-Policy (no eval).' : preview(error instanceof Error ? `${error.name}: ${error.message}` : error, 400)),
          detail: error,
        });
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void run();
      } else if (e.key === 'ArrowUp' && !input.value.includes('\n') && cursor > 0) {
        e.preventDefault();
        input.value = history[--cursor] ?? '';
      } else if (e.key === 'ArrowDown' && !input.value.includes('\n') && cursor < history.length) {
        e.preventDefault();
        input.value = history[++cursor] ?? '';
      }
    });

    ctx.pane.append(
      logView({
        channel: hub.console,
        signal: ctx.signal,
        levels: ['log', 'info', 'warn', 'error', 'debug'],
        tagLabel: 'Source',
        empty: 'console.* output, uncaught errors and unhandled rejections from the project frame appear here, recorded since page load.',
      }).el,
      h('div', { class: 'row pad con-input' }, input, h('button', { type: 'button', class: 'primary', text: 'Run', onclick: () => void run() })),
    );
  },
};
