# WbSmUtil

Dev toolkit userscript for websim projects.

## Install and use

```sh
npm install
npm run build      # -> dist/wbsmutil.user.js
npm run watch      # rebuild on change
npm run typecheck
```

**[Install](https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js)** (Tampermonkey or Violentmonkey; updates automatically), or build it and install `dist/wbsmutil.user.js`. Then open a project on websim.com, and press **Ctrl+`** (backtick, the key left of 1). The shortcut is set in `src/core/hotkey.ts`. You can also run `WbSmUtil.open()` from the console.

Websim shows each project inside an iframe on a `*.websim.com` subdomain. The script runs in both the websim.com page and the project iframe:

- **websim.com page:** it only forwards the hotkey to the project iframe (by `postMessage`). If the window ever ends up there, **⧉ Move into project frame** sends it to the iframe.
- **Project iframe:** this is where the tools run. Hooks are installed at `document-start`, so the logs include what the project did before you opened the panel.

## Tabs

| Tab | What it does |
|---|---|
| Database | Legacy `room.collection()` databases: discover collections, browse records, create entries |
| API | Request builder for `/api/*` (sent with your real identity headers), saved requests, a log of every `fetch`, and route discovery from the public `server.js` and page source |
| Multiplayer | Packet sniffer for `WebsimSocket.joinRoom()` rooms and legacy sockets: shows packets in (↓) and out (↑), sends packets, simulates incoming ones, replays them, and shows legacy presence/roomState |
| AI | Monitor for `websim.chat`, `imageGen`, `textToSpeech` and agent calls, plus chat, image and speech playgrounds |
| Comments | Browse, search and react to comments, see live `comment:created` events, post comments and replies |
| Project | Frame and hook status, project/viewer/creator identity, notification permission, `websim.upload`, the public users API, and a log of all `websim.*` calls |
| Console | Captured `console.*`, uncaught errors and rejections, and a JS runner in the project frame (unless the page's CSP blocks eval) |
| Storage | localStorage and sessionStorage editor, read-only IndexedDB browser, cookies |

## Layout

```
scripts/build.mjs        esbuild bundle + userscript header
src/main.ts              entry: role (site page vs project frame), hotkey, window.WbSmUtil
src/core/bridge.ts       site page ↔ project iframe postMessage bridge
src/core/hooks.ts        document-start hooks: console, fetch, websim.*, WebsimSocket rooms
src/core/hub.ts          ring-buffered channels the hooks write to and tools read
src/core/logview.ts      reusable live log (filter, pause, detail pane, actions)
src/core/shell.ts        floating window, tabs, status line, abort/timeouts
src/core/ui.ts           h() element builder, pretty(), subtabs(), helpers
src/core/source.ts       same-origin source crawler (scripts, imports, server.js)
src/core/websim.ts       websim / legacy socket types and helpers
src/tools/<name>/        one folder per tab
src/tools/index.ts       tab registry (order)
```

## Adding a tool

Create `src/tools/<name>/index.ts` exporting a `Tool` (`id`, `label`, optional `css`, `mount(ctx)`) and add it to `src/tools/index.ts`. `mount` runs the first time the tab is opened. Use `ctx.on`, `ctx.wait` and `ctx.signal` so that listeners and pending work stop when the window closes. To capture something from page load onward, add a hook in `hooks.ts` that writes to a `hub` channel, then render it with `logView()`.

## Hook guarantees

Every wrapper calls the original with the same `this` and arguments and returns its result unchanged. Logging errors are swallowed. A room with no `onmessage` handler gets a log-only one so incoming packets still show up. The getter hides that handler from the page (it reads as `null`). Streamed chat completions are logged as calls, but their chunks aren't captured.
