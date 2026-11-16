// Crawl the project's same-origin source: inline scripts, script src,
// modulepreload links and their static/dynamic imports.

const MAX_FILES = 64;
const BATCH = 4;
const IMPORTS = /\b(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface CrawlOptions {
  signal: AbortSignal;
  stopped(): boolean;
  /** Called with each source text and its URL. */
  onText(text: string, url: string): void;
  /** Called after each batch of files. */
  progress?(): void;
  /** Extra same-origin paths to fetch first (e.g. /server.js). */
  extra?: string[];
}

export async function crawlSources({ signal, stopped, onText, progress, extra = [] }: CrawlOptions): Promise<string> {
  const queue: string[] = [];
  const seen = new Set<string>();
  let count = 0;
  let failed = 0;

  function enqueue(path: string, base: string): void {
    try {
      if (!/^(\.?\.?\/|\/|https?:)/.test(path)) return;
      const url = new URL(path, base);
      if (url.origin !== location.origin || seen.has(url.href)) return;
      seen.add(url.href);
      queue.push(url.href);
    } catch {
      // Unparseable specifier; ignore.
    }
  }
  function scan(text: string, url: string): void {
    onText(text, url);
    for (const m of text.matchAll(IMPORTS)) {
      const path = m[1] ?? m[2];
      if (path) enqueue(path, url);
    }
  }

  for (const path of extra) enqueue(path, location.href);
  for (const script of document.scripts) {
    if (script.src) enqueue(script.src, location.href);
    else scan(script.textContent ?? '', location.href);
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')) {
    enqueue(link.href, location.href);
  }

  while (queue.length && !stopped() && count < MAX_FILES) {
    const batch = queue.splice(0, Math.min(BATCH, MAX_FILES - count));
    count += batch.length;
    await Promise.all(
      batch.map(async (url) => {
        try {
          const response = await fetch(url, { signal, credentials: 'same-origin' });
          if (!response.ok) throw new Error(String(response.status));
          const text = await response.text();
          if (stopped()) return;
          scan(text, url);
        } catch (error) {
          if ((error as Error).name !== 'AbortError') failed++;
        }
      }),
    );
    if (!stopped()) progress?.();
  }
  return (
    count +
    ' source files' +
    (failed ? ', ' + failed + ' unreadable' : '') +
    (queue.length ? ` (${MAX_FILES}-file scan limit)` : '')
  );
}
