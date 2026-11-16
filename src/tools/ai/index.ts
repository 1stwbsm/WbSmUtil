import { hub } from '../../core/hub';
import { logView } from '../../core/logview';
import type { Tool, ToolContext } from '../../core/tool';
import { errorMessage, fileToDataUrl, h, jsonBlock, parseJsonField, pretty, subtabs } from '../../core/ui';
import { requireWebsim } from '../../core/websim';
import css from './ai.css';

const AI_CALL = /^websim\.(chat|imageGen|textToSpeech|agent|ai)|^agent#/;
const ASPECTS = ['', '1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '9:16', '9:21'];
const VOICES = ['en-female', 'en-male', 'es-female', 'es-male', 'fr-female', 'fr-male', 'de-female', 'de-male', 'ja-female', 'ja-male'];

export const aiTool: Tool = {
  id: 'ai',
  label: 'AI',
  css,
  mount(ctx) {
    const monitor = h('div');
    const chat = h('div');
    const image = h('div');
    const speech = h('div');
    subtabs(ctx.pane, [
      {
        id: 'monitor',
        label: 'Monitor',
        el: monitor,
        init: () =>
          monitor.append(
            logView({
              channel: hub.websim,
              signal: ctx.signal,
              include: (e) => AI_CALL.test(e.tag),
              tagLabel: 'Call',
              empty: 'No AI calls yet. Calls the project makes to websim.chat, imageGen, textToSpeech and agents appear here with their arguments, results, errors and timing.',
            }).el,
          ),
      },
      { id: 'chat', label: 'Chat', el: chat, init: () => chatPlayground(ctx, chat) },
      { id: 'image', label: 'Image', el: image, init: () => imagePlayground(ctx, image) },
      { id: 'speech', label: 'Speech', el: speech, init: () => speechPlayground(ctx, speech) },
    ]);
  },
};

interface Msg {
  role: string;
  content: unknown;
}

function chatPlayground(ctx: ToolContext, root: HTMLElement): void {
  let history: Msg[] = [];
  let busy: AbortController | null = null;

  const system = h('textarea', { class: 'code', rows: 2, placeholder: 'System prompt (optional)' });
  const log = h('div', { class: 'chat-log scroll' });
  const input = h('textarea', { class: 'code grow', rows: 2, placeholder: 'User message… (Ctrl+Enter to send)' });
  const json = h('input', { type: 'checkbox' });
  const stream = h('input', { type: 'checkbox' });
  const schema = h('textarea', { class: 'code', rows: 4, placeholder: '{"type":"object","properties":{…}}' });
  const imageInput = h('input', { type: 'file', accept: 'image/*' });
  const raw = h('pre', { class: 'json' });
  const sendBtn = h('button', { type: 'button', class: 'primary', text: 'Send', onclick: () => void send() });
  const stopBtn = h('button', { type: 'button', text: 'Stop', hidden: true, onclick: () => busy?.abort() });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
  });

  function bubble(role: string, text: string): HTMLElement {
    const el = h('div', { class: 'msg msg-' + role }, h('span', { class: 'role', text: role }), h('div', { class: 'text', text }));
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el.querySelector('.text') as HTMLElement;
  }

  function renderHistory(): void {
    log.replaceChildren();
    for (const m of history) bubble(m.role, typeof m.content === 'string' ? m.content : pretty(m.content));
    if (!history.length) log.append(h('div', { class: 'empty', text: 'Calls websim.chat.completions.create as this page. Requests are metered like the project’s own.' }));
  }

  async function send(): Promise<void> {
    if (busy) return;
    const text = input.value.trim();
    const file = imageInput.files?.[0];
    if (!text && !file) return;
    try {
      const create = requireWebsim('chat')?.completions?.create;
      if (typeof create !== 'function') throw new Error('websim.chat.completions.create is not available.');
      const content: unknown = file
        ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: await fileToDataUrl(file) } }]
        : text;
      history.push({ role: 'user', content });
      renderHistory();
      input.value = '';
      imageInput.value = '';
      const messages = [...(system.value.trim() ? [{ role: 'system', content: system.value }] : []), ...history];
      const opts: Record<string, unknown> = { messages };
      if (json.checked) opts.json = true;
      if (schema.value.trim()) opts.schema = parseJsonField(schema.value, 'Schema');
      busy = new AbortController();
      sendBtn.disabled = true;
      stopBtn.hidden = false;
      const started = performance.now();
      if (stream.checked) {
        opts.stream = true;
        opts.signal = busy.signal;
        const out = bubble('assistant', '');
        let full = '';
        const iterable = (await create.call(requireWebsim('chat').completions, opts)) as AsyncIterable<{ delta?: string; content?: string }>;
        for await (const chunk of iterable) {
          if (ctx.stopped()) return;
          full = chunk.content ?? full + (chunk.delta ?? '');
          out.textContent = full;
          log.scrollTop = log.scrollHeight;
        }
        history.push({ role: 'assistant', content: full });
        raw.textContent = '(streamed) ' + full;
      } else {
        const completion = (await ctx.wait(create.call(requireWebsim('chat').completions, opts), 120000)) as Msg & Record<string, unknown>;
        history.push({ role: completion.role ?? 'assistant', content: completion.content });
        renderHistory();
        raw.textContent = pretty(completion);
      }
      ctx.status(`Chat completion in ${Math.round(performance.now() - started)} ms`);
    } catch (error) {
      if (!ctx.stopped()) {
        bubble('error', errorMessage(error));
        ctx.status('Chat failed: ' + errorMessage(error), true);
      }
    } finally {
      busy = null;
      sendBtn.disabled = false;
      stopBtn.hidden = true;
    }
  }

  root.append(
    h(
      'div',
      { class: 'split chat' },
      h(
        'div',
        { class: 'split-v' },
        log,
        h('div', { class: 'row pad composer' }, input, h('div', { class: 'stack' }, sendBtn, stopBtn)),
      ),
      h(
        'aside',
        { class: 'chat-side scroll pad stack' },
        h('label', { class: 'field' }, 'System', system),
        h('div', { class: 'row' }, h('label', { class: 'check' }, json, 'json: true'), h('label', { class: 'check' }, stream, 'stream')),
        h('label', { class: 'field' }, 'Schema (strict JSON output)', schema),
        h('label', { class: 'field' }, 'Image input', imageInput),
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', text: 'Reset conversation', onclick: () => ((history = []), renderHistory()) }),
          h('button', {
            type: 'button',
            text: 'Edit history',
            title: 'Edit the messages array as JSON',
            onclick: () => {
              const value = prompt('Messages JSON', JSON.stringify(history));
              if (value === null) return;
              try {
                const parsed = JSON.parse(value) as unknown;
                if (!Array.isArray(parsed)) throw new Error('Expected an array');
                history = parsed as Msg[];
                renderHistory();
              } catch (error) {
                ctx.status('History not changed: ' + errorMessage(error), true);
              }
            },
          }),
        ),
        h('details', {}, h('summary', { text: 'Last raw response' }), raw),
      ),
    ),
  );
  renderHistory();
}

function imagePlayground(ctx: ToolContext, root: HTMLElement): void {
  const promptEl = h('textarea', { class: 'code', rows: 3, placeholder: 'A crayon drawing of a turtle' });
  const aspect = h('select', {}, ASPECTS.map((a) => h('option', { value: a, text: a || 'default' })));
  const width = h('input', { type: 'number', placeholder: 'width', min: 64, step: 64, style: 'width:80px' });
  const height = h('input', { type: 'number', placeholder: 'height', min: 64, step: 64, style: 'width:80px' });
  const seed = h('input', { type: 'number', placeholder: 'seed', style: 'width:80px' });
  const transparent = h('input', { type: 'checkbox' });
  const inputs = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const result = h('div', { class: 'stack' });
  const go = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Generate',
    onclick: async () => {
      const opts: Record<string, unknown> = { prompt: promptEl.value };
      if (aspect.value) opts.aspect_ratio = aspect.value;
      if (width.value) opts.width = Number(width.value);
      if (height.value) opts.height = Number(height.value);
      if (seed.value) opts.seed = Number(seed.value);
      if (transparent.checked) opts.transparent = true;
      go.disabled = true;
      const started = performance.now();
      result.replaceChildren(h('div', { class: 'muted', text: 'Generating… (usually ~10 s)' }));
      try {
        const files = [...(inputs.files ?? [])].slice(0, 4);
        if (files.length) opts.image_inputs = await Promise.all(files.map(async (f) => ({ url: await fileToDataUrl(f) })));
        const res = await ctx.wait(requireWebsim('imageGen')(opts), 120000);
        if (ctx.stopped()) return;
        result.replaceChildren(
          res.url ? h('a', { href: res.url, target: '_blank', rel: 'noopener' }, h('img', { class: 'gen', src: res.url, alt: String(opts.prompt) })) : '',
          res.url ? h('input', { class: 'code', readOnly: true, value: res.url, onclick: (e: Event) => (e.target as HTMLInputElement).select() }) : '',
          jsonBlock(res),
        );
        ctx.status(`Image generated in ${Math.round(performance.now() - started)} ms`);
      } catch (error) {
        result.replaceChildren(h('div', { class: 'error-text', text: errorMessage(error) }));
        ctx.status('imageGen failed: ' + errorMessage(error), true);
      } finally {
        go.disabled = false;
      }
    },
  });
  root.append(
    h(
      'div',
      { class: 'scroll pad stack' },
      h('label', { class: 'field' }, 'Prompt', promptEl),
      h(
        'div',
        { class: 'row' },
        h('label', { class: 'field' }, 'Aspect', aspect),
        h('label', { class: 'field' }, 'Size', h('span', { class: 'row' }, width, '×', height)),
        h('label', { class: 'field' }, 'Seed', seed),
        h('label', { class: 'check' }, transparent, 'transparent'),
      ),
      h('label', { class: 'field' }, 'Image inputs (1–4, sent as data URLs)', inputs),
      h('div', { class: 'row' }, go),
      result,
    ),
  );
}

function speechPlayground(ctx: ToolContext, root: HTMLElement): void {
  const text = h('textarea', { class: 'code', rows: 3, value: 'Hello, world!' });
  const voice = h('input', { list: 'wbsm-voices', placeholder: 'en-female', style: 'width:120px' });
  const list = h('datalist', { id: 'wbsm-voices' }, VOICES.map((v) => h('option', { value: v })));
  const file = h('input', { type: 'checkbox' });
  const result = h('div', { class: 'stack' });
  const go = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Speak',
    onclick: async () => {
      const opts: Record<string, unknown> = { text: text.value };
      if (voice.value.trim()) opts.voice = voice.value.trim();
      if (file.checked) opts.generateFile = true;
      go.disabled = true;
      const started = performance.now();
      result.replaceChildren(h('div', { class: 'muted', text: file.checked ? 'Generating audio file…' : 'Speaking…' }));
      try {
        const res = await ctx.wait(requireWebsim('textToSpeech')(opts), 120000);
        if (ctx.stopped()) return;
        result.replaceChildren(res.url ? h('audio', { controls: true, src: res.url }) : '', jsonBlock(res));
        ctx.status(`textToSpeech finished in ${Math.round(performance.now() - started)} ms`);
      } catch (error) {
        result.replaceChildren(h('div', { class: 'error-text', text: errorMessage(error) }));
        ctx.status('textToSpeech failed: ' + errorMessage(error), true);
      } finally {
        go.disabled = false;
      }
    },
  });
  root.append(
    h(
      'div',
      { class: 'scroll pad stack' },
      h('label', { class: 'field' }, 'Text', text),
      h(
        'div',
        { class: 'row' },
        h('label', { class: 'field' }, 'Voice (<language>-<gender>)', voice),
        list,
        h('label', { class: 'check', title: 'Server-side engine; returns an audio URL' }, file, 'generateFile'),
      ),
      h('div', { class: 'row' }, go),
      result,
    ),
  );
}
