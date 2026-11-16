// websim.com shows each project inside an iframe on a *.websim.com subdomain.
// The tool only works inside that frame (it needs the frame's `websim`,
// `WebsimSocket` and same-origin /api). The userscript runs in both; the
// site-page copy forwards open/close requests to the frame copy by
// postMessage.

const TAG = '__wbsmutil';
type Command = 'open' | 'close' | 'toggle';
interface Message {
  [TAG]: 1;
  cmd?: Command;
  ack?: Command;
}

const SITE_HOSTS = new Set(['websim.com', 'www.websim.com', 'websim.ai', 'www.websim.ai']);
const ASSET_HOSTS = new Set(['api.websim.com', 'images.websim.com', 'avatars.websim.com']);

/** True on the websim site page itself (not a project). */
export function isSitePage(): boolean {
  return SITE_HOSTS.has(location.hostname);
}

function isWebsimOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'websim.com' || host.endsWith('.websim.com') || host === 'websim.ai' || host.endsWith('.websim.ai');
  } catch {
    return false;
  }
}

export interface FrameCandidate {
  frame: HTMLIFrameElement;
  origin: string;
  area: number;
}

/** Project iframes on this page, largest visible first. */
export function findProjectFrames(): FrameCandidate[] {
  const out: FrameCandidate[] = [];
  for (const frame of document.querySelectorAll('iframe')) {
    const src = frame.src || frame.getAttribute('src') || '';
    let url: URL;
    try {
      url = new URL(src, location.href);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || ASSET_HOSTS.has(url.hostname) || url.origin === location.origin) continue;
    if (!isWebsimOrigin(url.origin)) continue;
    const rect = frame.getBoundingClientRect();
    out.push({ frame, origin: url.origin, area: rect.width * rect.height });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** Every iframe host on the page, for diagnostics. */
export function iframeHosts(): string[] {
  return [...document.querySelectorAll('iframe')].map((f) => {
    try {
      return new URL(f.src, location.href).host || '(no src)';
    } catch {
      return '(invalid src)';
    }
  });
}

/**
 * Ask the project frame's copy of WbSmUtil to run `cmd`. Resolves true once
 * it acknowledges, false if no frame answers within the timeout (no project
 * frame, or the userscript isn't running in it).
 */
export function sendToProjectFrame(cmd: Command, timeout = 1200): Promise<boolean> {
  const candidates = findProjectFrames();
  if (!candidates.length) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeout);
    const onMessage = (e: MessageEvent) => {
      const data = e.data as Message | undefined;
      if (!data || data[TAG] !== 1 || data.ack !== cmd) return;
      if (!candidates.some((c) => c.frame.contentWindow === e.source)) return;
      finish(true);
    };
    function finish(ok: boolean) {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    }
    window.addEventListener('message', onMessage);
    // Only the largest frame: that is the project; smaller ones are embeds.
    const target = candidates[0]!;
    target.frame.contentWindow?.postMessage({ [TAG]: 1, cmd } satisfies Message, target.origin);
  });
}

/** In the project frame: obey commands from the websim page that embeds us. */
export function listenForCommands(handlers: Record<Command, () => void>): void {
  window.addEventListener('message', (e) => {
    const data = e.data as Message | undefined;
    if (!data || data[TAG] !== 1 || !data.cmd || !(data.cmd in handlers)) return;
    if (e.source !== window.parent || !isWebsimOrigin(e.origin)) return;
    handlers[data.cmd]();
    (e.source as Window).postMessage({ [TAG]: 1, ack: data.cmd } satisfies Message, e.origin);
  });
}
