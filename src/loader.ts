// Gets WbSmUtil into the page's own JavaScript world.
//
// The tools need page globals (websim, WebsimSocket, the page's fetch), so the
// main code must run in the page world, not a userscript sandbox. websim.com
// and project frames use a nonce-based Content-Security-Policy, which blocks
// the inline <script> that Violentmonkey (on Firefox) normally injects with,
// and the script silently never runs. So with `@inject-into auto` the manager
// falls back to a content script, and this loader re-injects the main code as
// an inline <script> carrying the page's own nonce, which CSP allows.
//
// The build wraps the main bundle in `__wbsmutilMain`, which sets FLAG on
// <html> as its first act, so injection success is visible from any world.

declare function __wbsmutilMain(): void;

const FLAG = 'data-wbsmutil';
const TAG = '[WbSmUtil]';

const running = (): boolean => !!document.documentElement?.hasAttribute(FLAG);

/** Firefox content scripts see the page through an Xray wrapper. */
const contentWorld = typeof (window as unknown as { wrappedJSObject?: unknown }).wrappedJSObject === 'object';

function inject(nonce?: string): boolean {
  const parent = document.head ?? document.documentElement;
  if (!parent) return false;
  const script = document.createElement('script');
  if (nonce) {
    script.nonce = nonce;
    script.setAttribute('nonce', nonce);
  }
  script.textContent = `(${__wbsmutilMain.toString()})();`;
  parent.appendChild(script); // inline scripts run synchronously on insert
  script.remove();
  return running();
}

/** Nonce of any script already in the document (property survives nonce hiding). */
function pageNonce(): string {
  for (const s of document.querySelectorAll('script')) {
    const n = s.nonce || s.getAttribute('nonce');
    if (n) return n;
  }
  return '';
}

function load(): void {
  if (running()) return;
  // Pages without a CSP: plain inline injection works.
  if (!pageNonce() && inject()) return;
  const nonce = pageNonce();
  if (nonce && inject(nonce)) return;
  if (!contentWorld) {
    // Already in the page world (e.g. Tampermonkey on Chrome, which is exempt
    // from page CSP): just run here.
    __wbsmutilMain();
    return;
  }
  // document-start: the page's scripts don't exist yet. Mutation callbacks run
  // in the microtask checkpoint the parser performs before executing each
  // script, so injecting on the first nonced script still beats page code.
  const observer = new MutationObserver(() => {
    if (running()) return observer.disconnect();
    const n = pageNonce();
    if (n && inject(n)) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      observer.disconnect();
      if (!running()) {
        console.warn(
          `${TAG} could not run in ${location.host}: the page's Content-Security-Policy blocked injection and no script nonce was available.`,
        );
      }
    },
    { once: true },
  );
}

try {
  load();
} catch (error) {
  console.warn(`${TAG} loader error in ${location.host}:`, error);
}
