import { hub } from '../../core/hub';
import { logView } from '../../core/logview';
import type { Tool, ToolContext } from '../../core/tool';
import { avatar, errorMessage, h, jsonBlock, subtabs } from '../../core/ui';
import { requireWebsim, type CommentPage } from '../../core/websim';

type Comment = Record<string, unknown> & {
  id?: string;
  raw_content?: string;
  created_at?: string;
  author?: { id?: string; username?: string };
  reactions?: Array<{ emoji?: { name?: string } | string; count?: number; me?: boolean }>;
  reply_count?: number;
  parent_comment_id?: string | null;
  card_data?: { type?: string; credits_spent?: number };
};

export const commentsTool: Tool = {
  id: 'comments',
  label: 'Comments',
  css: `
.c-list { display: flex; flex-direction: column; }
.c-item { padding: 8px; border-bottom: 1px solid #2a3037; display: flex; flex-direction: column; gap: 4px; }
.c-item .head { display: flex; gap: 6px; align-items: center; font-size: 11px; }
.c-item .body { white-space: pre-wrap; overflow-wrap: anywhere; }
.c-item .acts { display: flex; gap: 4px; flex-wrap: wrap; }
.c-item .acts button { font-size: 10px; padding: 1px 6px; }
.c-item .reply { margin-left: 18px; border-left: 2px solid #303841; padding-left: 8px; }
.c-filters { border-bottom: 1px solid #303841; }
.c-filters input[type=number] { width: 60px; }
`,
  mount(ctx) {
    const browse = h('div');
    const live = h('div');
    const post = h('div');
    const composer = postView(ctx, post);
    const select = subtabs(ctx.pane, [
      {
        id: 'browse',
        label: 'Browse',
        el: browse,
        init: () =>
          browseView(ctx, browse, (id) => {
            composer.replyTo(id);
            select('post');
          }),
      },
      {
        id: 'live',
        label: 'Live events',
        el: live,
        init: () =>
          live.append(
            logView({
              channel: hub.comments,
              signal: ctx.signal,
              tagLabel: 'Author',
              empty: 'comment:created events appear here as they happen (recorded since the page loaded).',
            }).el,
          ),
      },
      { id: 'post', label: 'Post', el: post },
    ]);
  },
};

function emojiName(e: unknown): string {
  return typeof e === 'string' ? e : String((e as { name?: string } | undefined)?.name ?? '?');
}

function browseView(ctx: ToolContext, root: HTMLElement, reply: (id: string) => void): void {
  const first = h('input', { type: 'number', value: 20, min: 1, max: 100, title: 'first' });
  const sort = h('select', {}, h('option', { value: '', text: 'Newest' }), h('option', { value: 'best', text: 'Best' }));
  const q = h('input', { placeholder: 'Search text', class: 'grow' });
  const author = h('input', { placeholder: 'author_username', style: 'width:120px' });
  const tips = h('input', { type: 'checkbox' });
  const video = h('input', { type: 'checkbox' });
  const replies = h('input', { type: 'number', value: 0, min: 0, max: 10, title: 'include_replies' });
  const list = h('div', { class: 'c-list scroll' });
  const more = h('button', { type: 'button', text: 'Load more', hidden: true });
  const count = h('span', { class: 'muted' });
  let page: CommentPage | null = null;

  function item(c: Comment, nested = false): HTMLElement {
    const tip = c.card_data?.type === 'tip_comment' ? h('span', { class: 'badge good', text: `tip ${c.card_data.credits_spent ?? ''}` }) : null;
    const raw = h('div', { hidden: true }, jsonBlock(c));
    const reactions = (c.reactions ?? []).map((r) =>
      h('span', { class: 'badge' + (r.me ? ' good' : ''), text: `${emojiName(r.emoji)} ${r.count ?? ''}` }),
    );
    const react = (emoji: string) =>
      h('button', {
        type: 'button',
        text: emoji === '+1' ? '▲' : emoji === '-1' ? '▼' : emoji,
        title: `reactToComment ${emoji} (consumes this click)`,
        onclick: async () => {
          // Must run directly in the click handler: websim needs the gesture.
          try {
            const mine = (c.reactions ?? []).some((r) => emojiName(r.emoji) === emoji && r.me);
            const res = await requireWebsim('reactToComment')({ comment_id: c.id, emoji, remove: mine });
            if (res.error) throw new Error(String(res.error));
            ctx.status(`${mine ? 'Removed' : 'Added'} ${emoji} on ${c.id}`);
            if (res.comment) el.replaceWith(item(res.comment as Comment, nested));
          } catch (error) {
            ctx.status('React failed: ' + errorMessage(error), true);
          }
        },
      });
    const el = h(
      'div',
      { class: 'c-item' + (nested ? ' reply' : '') },
      h(
        'div',
        { class: 'head' },
        avatar(c.author?.username),
        h('strong', { text: c.author?.username ?? '?' }),
        h('span', { class: 'muted', text: c.created_at ? new Date(c.created_at).toLocaleString() : '' }),
        tip,
        h('span', { class: 'muted', text: c.id ?? '' }),
      ),
      h('div', { class: 'body', text: c.raw_content ?? '' }),
      h(
        'div',
        { class: 'acts' },
        ...reactions,
        react('+1'),
        react('-1'),
        react('heart'),
        h('button', { type: 'button', text: 'Reply', onclick: () => c.id && reply(c.id) }),
        h('button', { type: 'button', text: 'Raw', onclick: () => (raw.hidden = !raw.hidden) }),
        c.reply_count ? h('span', { class: 'muted', text: `${c.reply_count} replies` }) : null,
      ),
      raw,
    );
    const nestedPage = (c.replies as CommentPage | undefined)?.comments;
    if (nestedPage) for (const r of nestedPage) el.append(item(r as Comment, true));
    return el;
  }

  function show(p: CommentPage, append: boolean): void {
    page = p;
    if (!append) list.replaceChildren();
    for (const c of p.comments ?? []) list.append(item(c as Comment));
    if (!list.childElementCount) list.append(h('div', { class: 'empty', text: 'No comments match.' }));
    more.hidden = !p.next;
    count.textContent = (p.count != null ? `${p.count} total · ` : '') + `${list.querySelectorAll(':scope > .c-item').length} loaded`;
  }

  async function load(): Promise<void> {
    const params: Record<string, unknown> = { first: Number(first.value) || 20, include_count: true };
    if (sort.value) params.sort_by = sort.value;
    if (q.value.trim()) params.q = q.value.trim();
    if (author.value.trim()) params.author_username = author.value.trim();
    if (tips.checked) params.only_tips = true;
    if (video.checked) params.only_video = true;
    if (Number(replies.value)) params.include_replies = Number(replies.value);
    list.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
    try {
      show(await ctx.wait(requireWebsim('getComments')(params)), false);
    } catch (error) {
      list.replaceChildren(h('div', { class: 'empty error-text', text: errorMessage(error) }));
      ctx.status('getComments failed: ' + errorMessage(error), true);
    }
  }

  more.addEventListener('click', async () => {
    if (!page?.next) return;
    more.disabled = true;
    try {
      show(await ctx.wait(page.next()), true);
    } catch (error) {
      ctx.status('Next page failed: ' + errorMessage(error), true);
    } finally {
      more.disabled = false;
    }
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void load();
  });

  root.append(
    h(
      'div',
      { class: 'row pad c-filters' },
      q,
      author,
      sort,
      h('label', { class: 'check' }, tips, 'tips'),
      h('label', { class: 'check' }, video, 'video'),
      h('label', { class: 'check', title: 'include_replies' }, 'replies', replies),
      h('label', { class: 'check', title: 'first' }, 'page', first),
      h('button', { type: 'button', class: 'primary', text: 'Load', onclick: () => void load() }),
      count,
    ),
    list,
    h('div', { class: 'row pad' }, more),
  );
  void load();
}

function postView(ctx: ToolContext, root: HTMLElement): { replyTo(id: string): void } {
  const content = h('textarea', { class: 'code', rows: 4, placeholder: 'Comment text (markdown links allowed)' });
  const images = h('textarea', { class: 'code', rows: 2, placeholder: 'Image/video URLs, one per line (max 4)' });
  const parent = h('input', { class: 'code', placeholder: 'parent_comment_id (reply)' });
  const credits = h('input', { type: 'number', min: 0, placeholder: 'credits (tip)', style: 'width:110px' });
  const art = h('input', { type: 'checkbox' });
  const result = h('div');
  const go = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Post to comments',
    onclick: async () => {
      // Called straight from the click: postComment requires the user gesture.
      const opts: Record<string, unknown> = { content: content.value };
      const urls = images.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
      if (urls.length) opts.images = urls;
      if (parent.value.trim()) opts.parent_comment_id = parent.value.trim();
      if (Number(credits.value)) opts.credits = Number(credits.value);
      if (art.checked) opts.data = { type: 'project_board_post', kind: 'art', status: 'art' };
      go.disabled = true;
      try {
        const res = await requireWebsim('postComment')(opts);
        if (res.error) throw new Error(String(res.error));
        result.replaceChildren(jsonBlock(res));
        ctx.status(opts.credits ? 'Tip composer opened; the comment exists once you press Post there.' : 'Comment posted.');
        if (!opts.credits) content.value = '';
      } catch (error) {
        result.replaceChildren(h('div', { class: 'error-text', text: errorMessage(error) }));
        ctx.status('postComment failed: ' + errorMessage(error), true);
      } finally {
        go.disabled = false;
      }
    },
  });
  root.append(
    h(
      'div',
      { class: 'scroll pad stack' },
      h('p', { class: 'hint', text: 'Posts publicly as you, immediately, with the “App” badge. Tips open websim’s own composer to confirm the spend.' }),
      h('label', { class: 'field' }, 'Content', content),
      h('label', { class: 'field' }, 'Images', images),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, parent), credits, h('label', { class: 'check' }, art, 'fan art')),
      h('div', { class: 'row' }, go),
      result,
    ),
  );
  return {
    replyTo(id) {
      parent.value = id;
      content.focus();
    },
  };
}
