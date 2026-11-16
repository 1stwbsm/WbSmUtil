// ==UserScript==
// @name         WbSmUtil
// @namespace    wbsmutil
// @version      0.4.4
// @description  Dev toolkit userscript for websim projects. Ctrl+Backtick toggles the panel inside a project frame.
// @match        https://websim.com/*
// @match        https://*.websim.com/*
// @match        https://websim.ai/*
// @match        https://*.websim.ai/*
// @exclude      https://api.websim.com/*
// @exclude      https://images.websim.com/*
// @exclude      https://avatars.websim.com/*
// @icon        https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/docs/img/icon-128.png
// @homepageURL  https://1stwbsm.github.io/WbSmUtil/
// @downloadURL  https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js
// @updateURL    https://raw.githubusercontent.com/1stwbsm/WbSmUtil/main/dist/wbsmutil.user.js
// @grant        none
// @inject-into  auto
// @run-at       document-start
// ==/UserScript==

(function () {
function __wbsmutilMain() {
if (window.__wbsmutilLoaded) return; window.__wbsmutilLoaded = true;
try { document.documentElement.setAttribute('data-wbsmutil', ''); } catch (e) {}
"use strict";
(() => {
  // src/core/bridge.ts
  var TAG = "__wbsmutil";
  var SITE_HOSTS = /* @__PURE__ */ new Set(["websim.com", "www.websim.com", "websim.ai", "www.websim.ai"]);
  var ASSET_HOSTS = /* @__PURE__ */ new Set(["api.websim.com", "images.websim.com", "avatars.websim.com"]);
  function isSitePage() {
    return SITE_HOSTS.has(location.hostname);
  }
  function isWebsimOrigin(origin) {
    try {
      const host = new URL(origin).hostname;
      return host === "websim.com" || host.endsWith(".websim.com") || host === "websim.ai" || host.endsWith(".websim.ai");
    } catch {
      return false;
    }
  }
  function findProjectFrames() {
    const out = [];
    for (const frame of document.querySelectorAll("iframe")) {
      const src = frame.src || frame.getAttribute("src") || "";
      let url;
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
  function iframeHosts() {
    return [...document.querySelectorAll("iframe")].map((f) => {
      try {
        return new URL(f.src, location.href).host || "(no src)";
      } catch {
        return "(invalid src)";
      }
    });
  }
  function sendToProjectFrame(cmd, timeout = 1200) {
    const candidates = findProjectFrames();
    if (!candidates.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), timeout);
      const onMessage = (e) => {
        const data = e.data;
        if (!data || data[TAG] !== 1 || data.ack !== cmd) return;
        if (!candidates.some((c) => c.frame.contentWindow === e.source)) return;
        finish(true);
      };
      function finish(ok) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(ok);
      }
      window.addEventListener("message", onMessage);
      const target = candidates[0];
      target.frame.contentWindow?.postMessage({ [TAG]: 1, cmd }, target.origin);
    });
  }
  function listenForCommands(handlers) {
    window.addEventListener("message", (e) => {
      const data = e.data;
      if (!data || data[TAG] !== 1 || !data.cmd || !(data.cmd in handlers)) return;
      if (e.source !== window.parent || !isWebsimOrigin(e.origin)) return;
      handlers[data.cmd]();
      e.source.postMessage({ [TAG]: 1, ack: data.cmd }, e.origin);
    });
  }

  // src/core/hub.ts
  var nextId = 1;
  var Channel = class {
    constructor(max = 500) {
      this.max = max;
    }
    max;
    entries = [];
    listeners = /* @__PURE__ */ new Set();
    clearListeners = /* @__PURE__ */ new Set();
    push(entry) {
      const full = { id: nextId++, time: entry.time ?? Date.now(), ...entry };
      this.entries.push(full);
      if (this.entries.length > this.max) this.entries.shift();
      for (const fn of this.listeners) safe(() => fn(full, true));
      return full;
    }
    /** Notify listeners that a pushed entry changed (e.g. a request finished). */
    update(entry) {
      for (const fn of this.listeners) safe(() => fn(entry, false));
    }
    clear() {
      this.entries.length = 0;
      for (const fn of this.clearListeners) safe(fn);
    }
    subscribe(fn, signal, onClear) {
      this.listeners.add(fn);
      if (onClear) this.clearListeners.add(onClear);
      signal.addEventListener(
        "abort",
        () => {
          this.listeners.delete(fn);
          if (onClear) this.clearListeners.delete(onClear);
        },
        { once: true }
      );
    }
  };
  function safe(fn) {
    try {
      fn();
    } catch {
    }
  }
  var RoomRegistry = class {
    list = [];
    listeners = /* @__PURE__ */ new Set();
    add(ref) {
      this.list.push(ref);
      for (const fn of this.listeners) safe(fn);
    }
    subscribe(fn, signal) {
      this.listeners.add(fn);
      signal.addEventListener("abort", () => this.listeners.delete(fn), { once: true });
    }
  };
  var hub = {
    console: new Channel(1e3),
    net: new Channel(500),
    /** Every call into window.websim.* */
    websim: new Channel(500),
    /** Multiplayer packets and room lifecycle. */
    room: new Channel(2e3),
    /** comment:created events. */
    comments: new Channel(200),
    rooms: new RoomRegistry(),
    /** Hook name → status text, shown on the Project tab. */
    hooks: /* @__PURE__ */ new Map()
  };

  // src/core/ui.ts
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === void 0 || value === null || value === false) continue;
        if (key === "class") el.className = String(value);
        else if (key === "text") el.textContent = String(value);
        else if (key === "style") el.setAttribute("style", String(value));
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") {
          el.addEventListener(key.slice(2), value);
        } else if (key in el) el[key] = value;
        else el.setAttribute(key, value === true ? "" : String(value));
      }
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      if (Array.isArray(child)) append(el, child);
      else el.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
    }
  }
  function errorMessage(error) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object" && "error" in error) return String(error.error);
    return String(error);
  }
  function pretty(value, indent = 2, maxDepth = 8) {
    const seen = /* @__PURE__ */ new WeakSet();
    const walk = (v, depth) => {
      if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
      if (typeof v === "bigint") return v.toString() + "n";
      if (typeof v === "symbol") return v.toString();
      if (typeof v === "string") return v.length > 5e4 ? v.slice(0, 5e4) + `… (${v.length} chars)` : v;
      if (v === void 0) return "[undefined]";
      if (!v || typeof v !== "object") return v;
      if (seen.has(v)) return "[Circular]";
      if (depth > maxDepth) return Array.isArray(v) ? `[Array(${v.length})]` : "[Object]";
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof Node !== "undefined" && v instanceof Node) return `[${v.nodeName.toLowerCase()}]`;
      if (typeof Blob !== "undefined" && v instanceof Blob) return `[${v.constructor.name} ${v.size} bytes ${v.type}]`;
      if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength} bytes]`;
      if (ArrayBuffer.isView(v)) return `[${v.constructor.name} ${v.byteLength} bytes]`;
      if (typeof MessageEvent !== "undefined" && v instanceof MessageEvent) return { type: v.type, data: walk(v.data, depth + 1) };
      if (typeof Event !== "undefined" && v instanceof Event) return `[${v.constructor.name} ${v.type}]`;
      if (v instanceof Map) return { "[Map]": walk(Object.fromEntries(v), depth + 1) };
      if (v instanceof Set) return { "[Set]": walk([...v], depth + 1) };
      if (v instanceof Promise) return "[Promise]";
      seen.add(v);
      if (Array.isArray(v)) {
        const out2 = v.slice(0, 500).map((x) => walk(x, depth + 1));
        if (v.length > 500) out2.push(`… ${v.length - 500} more`);
        return out2;
      }
      const out = {};
      let n = 0;
      for (const key in v) {
        if (n++ >= 300) {
          out["…"] = "more keys omitted";
          break;
        }
        try {
          out[key] = walk(v[key], depth + 1);
        } catch (error) {
          out[key] = `[Threw: ${errorMessage(error)}]`;
        }
      }
      return out;
    };
    try {
      const result = JSON.stringify(walk(value, 0), null, indent);
      return result === void 0 ? String(value) : result;
    } catch (error) {
      return `[Unserializable: ${errorMessage(error)}]`;
    }
  }
  function preview(value, max = 200) {
    let text;
    if (typeof value === "string") text = value;
    else if (value === void 0) text = "undefined";
    else text = pretty(value, 0, 3);
    text = text.replace(/\s+/g, " ");
    return text.length > max ? text.slice(0, max) + "…" : text;
  }
  function tryParse(text) {
    if (typeof text !== "string") return text;
    const t = text.trim();
    if (!t || !'{["0123456789-tfn'.includes(t[0] ?? "")) return text;
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  function clock(time) {
    const d = new Date(time);
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }
  function avatar(username) {
    if (!username) return null;
    return h("img", {
      class: "avatar",
      src: `https://images.websim.com/avatar/${encodeURIComponent(username)}`,
      alt: "",
      loading: "lazy"
    });
  }
  function jsonBlock(value) {
    return h("pre", { class: "json", text: typeof value === "string" ? value : pretty(value) });
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  function subtabs(host, tabs) {
    const nav = h("nav", { class: "subtabs" });
    const body = h("div", { class: "subbody" });
    const started = /* @__PURE__ */ new Set();
    const buttons = /* @__PURE__ */ new Map();
    const select = (id) => {
      for (const tab of tabs) {
        const on = tab.id === id;
        tab.el.hidden = !on;
        buttons.get(tab.id)?.classList.toggle("active", on);
        if (on && !started.has(tab.id)) {
          started.add(tab.id);
          tab.init?.();
        }
      }
    };
    for (const tab of tabs) {
      tab.el.classList.add("subview");
      tab.el.hidden = true;
      const b = h("button", { type: "button", text: tab.label, onclick: () => select(tab.id) });
      buttons.set(tab.id, b);
      nav.append(b);
      body.append(tab.el);
    }
    host.append(nav, body);
    const first = tabs[0];
    if (first) select(first.id);
    return select;
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  function parseJsonField(text, label, fallback) {
    if (!text.trim()) {
      if (fallback !== void 0) return fallback;
      throw new Error(label + " is empty.");
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(label + ": " + errorMessage(error));
    }
  }

  // src/core/hooks.ts
  var ORIGINAL = /* @__PURE__ */ Symbol.for("wbsmutil.original");
  var PATCHED = /* @__PURE__ */ Symbol.for("wbsmutil.patched");
  function isThenable(v) {
    return !!v && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
  }
  function unwrap(fn) {
    return fn?.[ORIGINAL] ?? fn;
  }
  function mark(wrapper, original) {
    try {
      Object.defineProperty(wrapper, ORIGINAL, { value: original });
      Object.defineProperty(wrapper, PATCHED, { value: true });
      Object.defineProperty(wrapper, "name", { value: original.name });
      Object.defineProperty(wrapper, "length", { value: original.length });
    } catch {
    }
    return wrapper;
  }
  function isPatched(fn) {
    return typeof fn === "function" && !!fn[PATCHED];
  }
  var CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"];
  function installConsoleHook() {
    for (const level of CONSOLE_LEVELS) {
      const original = console[level];
      if (isPatched(original)) continue;
      console[level] = mark(function(...args) {
        try {
          hub.console.push({
            tag: "console",
            level,
            summary: args.map((a) => preview(a, 300)).join(" "),
            detail: args.length === 1 ? args[0] : args
          });
        } catch {
        }
        return original.apply(this, args);
      }, original);
    }
    window.addEventListener("error", (e) => {
      if (e.error === void 0 && !e.message) return;
      hub.console.push({
        tag: "error",
        level: "error",
        summary: e.message + (e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno}:${e.colno})` : ""),
        detail: e.error ?? { message: e.message, filename: e.filename, line: e.lineno, column: e.colno }
      });
    });
    window.addEventListener("unhandledrejection", (e) => {
      hub.console.push({
        tag: "rejection",
        level: "error",
        summary: "Unhandled rejection: " + preview(e.reason instanceof Error ? e.reason.message : e.reason, 300),
        detail: e.reason
      });
    });
    hub.hooks.set("console", "installed");
  }
  var BODY_LIMIT = 256 * 1024;
  function describeBody(body) {
    if (body === void 0 || body === null) return void 0;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return "[FormData " + [...body.keys()].join(", ") + "]";
    if (body instanceof Blob) return `[${body.constructor.name} ${body.size} bytes ${body.type}]`;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[binary ${body.byteLength} bytes]`;
    return "[" + (body.constructor?.name ?? "body") + "]";
  }
  var fetchDepth = 0;
  function wrapFetch(original) {
    return mark(function(...args) {
      if (fetchDepth > 0) return original.apply(this, args);
      const [input, init] = args;
      let entry = null;
      const started = performance.now();
      try {
        const req2 = input instanceof Request ? input : null;
        const url = new URL(req2 ? req2.url : String(input), location.href).href;
        const method = (init?.method ?? req2?.method ?? "GET").toUpperCase();
        const headers = {};
        new Headers(init?.headers ?? req2?.headers).forEach((v, k) => headers[k] = v);
        const spec = { method, url, headers, body: describeBody(init?.body) };
        entry = hub.net.push({
          tag: method,
          level: "pending",
          summary: shortUrl(url),
          detail: { request: spec },
          data: spec
        });
      } catch {
      }
      let promise;
      fetchDepth++;
      try {
        promise = original.apply(this, args);
      } finally {
        fetchDepth--;
      }
      if (entry) {
        const e = entry;
        promise.then(
          async (res) => {
            e.ms = performance.now() - started;
            e.level = res.ok ? "ok" : "error";
            e.summary = res.status + " " + shortUrl(res.url || e.data.url);
            const headers = {};
            res.headers.forEach((v, k) => headers[k] = v);
            const response = { status: res.status, statusText: res.statusText, headers };
            e.detail.response = response;
            hub.net.update(e);
            const type = res.headers.get("content-type") ?? "";
            const size = Number(res.headers.get("content-length") ?? "0");
            if (/json|text|javascript|xml/.test(type) && !/event-stream/.test(type) && size <= BODY_LIMIT) {
              try {
                const text = await res.clone().text();
                response.body = type.includes("json") ? tryParse(text) : text.slice(0, BODY_LIMIT);
                hub.net.update(e);
              } catch {
              }
            } else response.body = `[${type || "unknown type"}${size ? ", " + size + " bytes" : ""}; not captured]`;
          },
          (error) => {
            e.ms = performance.now() - started;
            e.level = "error";
            e.summary = "FAILED " + e.summary + " · " + errorMessage(error);
            e.detail.error = errorMessage(error);
            hub.net.update(e);
          }
        );
      }
      return promise;
    }, original);
  }
  function installFetchHook() {
    if (isPatched(window.fetch)) return;
    let current = wrapFetch(window.fetch);
    let replaced = 0;
    try {
      Object.defineProperty(window, "fetch", {
        configurable: true,
        enumerable: true,
        get: () => current,
        set(value) {
          if (typeof value !== "function") return;
          current = isPatched(value) ? value : wrapFetch(value);
          hub.hooks.set("fetch", `installed (page replaced fetch ${++replaced}×, re-wrapped)`);
        }
      });
    } catch {
      window.fetch = current;
    }
    hub.hooks.set("fetch", "installed");
  }
  function shortUrl(url) {
    try {
      const u = new URL(url);
      return u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname + u.search;
    } catch {
      return url;
    }
  }
  function whenGlobal(name, cb) {
    const w = window;
    let done = false;
    const fire = (value, late) => {
      if (done) return value;
      done = true;
      try {
        return cb(value, late) ?? value;
      } catch (error) {
        hub.hooks.set(name, "failed: " + errorMessage(error));
        return value;
      }
    };
    if (w[name] !== void 0) {
      const replacement = fire(w[name], true);
      if (replacement !== w[name]) {
        try {
          w[name] = replacement;
        } catch {
        }
      }
      return;
    }
    hub.hooks.set(name, "waiting");
    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (!desc || desc.configurable) {
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          enumerable: true,
          get: () => void 0,
          set(value) {
            const replacement = fire(value, false);
            Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: replacement });
          }
        });
      } catch {
      }
    }
    const started = Date.now();
    const poll = setInterval(() => {
      if (done) return clearInterval(poll);
      let value;
      try {
        value = w[name];
      } catch {
        value = void 0;
      }
      if (value !== void 0) {
        clearInterval(poll);
        const replacement = fire(value, true);
        if (replacement !== value) {
          try {
            w[name] = replacement;
          } catch {
          }
        }
      } else if (Date.now() - started > 3e4) {
        clearInterval(poll);
        hub.hooks.set(name, "not found on this page");
      }
    }, 50);
  }
  var SKIP = /* @__PURE__ */ new Set(["addEventListener", "removeEventListener", "dispatchEvent", "constructor"]);
  function functionKeys(obj) {
    const keys = /* @__PURE__ */ new Set();
    for (let p = obj; p && p !== Object.prototype && p !== Function.prototype; p = Object.getPrototypeOf(p)) {
      for (const key of Object.getOwnPropertyNames(p)) {
        if (SKIP.has(key)) continue;
        try {
          if (typeof obj[key] === "function") keys.add(key);
        } catch {
        }
      }
    }
    return [...keys];
  }
  function wrapMethods(obj, prefix, depth = 0) {
    if (!obj || typeof obj !== "object" && typeof obj !== "function") return;
    const target = obj;
    for (const key of functionKeys(target)) {
      const fn = target[key];
      if (isPatched(fn)) continue;
      const path = prefix + key;
      const wrapper = mark(function(...args) {
        return logCall(path, fn, this, args);
      }, fn);
      for (const k of Object.keys(fn)) {
        try {
          wrapper[k] = fn[k];
        } catch {
        }
      }
      try {
        target[key] = wrapper;
      } catch {
        try {
          Object.defineProperty(target, key, { configurable: true, writable: true, value: wrapper });
        } catch {
          continue;
        }
      }
      if (depth < 2) wrapMethods(wrapper, path + ".", depth + 1);
    }
  }
  function logCall(path, fn, self, args) {
    const started = performance.now();
    const first = args[0];
    const streaming = !!first && typeof first === "object" && first.stream === true;
    const entry = hub.websim.push({
      tag: path,
      level: "pending",
      summary: path + "(" + (args.length ? preview(first, 160) : "") + ")",
      detail: { args: args.length === 1 ? first : args }
    });
    const done = (value) => {
      entry.ms = performance.now() - started;
      const failed = !!value && typeof value === "object" && "error" in value && !!value.error;
      entry.level = failed ? "error" : "ok";
      entry.detail.result = streaming ? "[stream: chunks go straight to the page and are not captured]" : value;
      entry.summary = path + " → " + (streaming ? "stream" : preview(resultPreview(value), 160));
      hub.websim.update(entry);
      if (path.endsWith("agent.create")) wrapMethods(value, "agent#");
    };
    const fail = (error) => {
      entry.ms = performance.now() - started;
      entry.level = "error";
      entry.detail.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
      entry.summary = path + " ✕ " + errorMessage(error);
      hub.websim.update(entry);
    };
    let result;
    try {
      result = fn.apply(self, args);
    } catch (error) {
      fail(error);
      throw error;
    }
    if (isThenable(result)) result.then(done, fail);
    else done(result);
    return result;
  }
  function resultPreview(value) {
    if (value && typeof value === "object") {
      const v = value;
      if (typeof v.content === "string") return v.content;
      if (typeof v.url === "string") return v.url;
      if (typeof v.text === "string") return v.text;
    }
    return value;
  }
  function installWebsimHook() {
    whenGlobal("websim", (ws, late) => {
      if (!ws || typeof ws !== "object") return;
      wrapMethods(ws, "websim.");
      const ns = ws;
      for (const key of ["chat", "agent", "notifications"]) {
        const child = ns[key];
        if (child && typeof child === "object") wrapMethods(child, `websim.${key}.`);
      }
      const chat = ns.chat;
      if (chat?.completions && typeof chat.completions === "object") wrapMethods(chat.completions, "websim.chat.completions.");
      const add = unwrap(ns.addEventListener);
      if (typeof add === "function") {
        try {
          add.call(ws, "comment:created", (data) => {
            const c = data?.comment;
            const author = c?.author?.username;
            hub.comments.push({
              tag: String(author ?? "?"),
              level: "in",
              summary: preview(c?.raw_content ?? data, 300),
              detail: data
            });
          });
        } catch {
        }
      }
      hub.hooks.set("websim", late ? "installed (after page load)" : "installed");
    });
  }
  var PASSIVE = function wbsmutilPassive() {
  };
  var roomCount = 0;
  var attached = /* @__PURE__ */ new WeakSet();
  function roomLabel(room2) {
    return hub.rooms.list.find((r) => r.room === room2)?.label ?? "room";
  }
  function hookHandler(obj, prop, observe, passive) {
    let desc;
    for (let p = obj; p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, prop);
    const wrap = (fn) => {
      if (typeof fn !== "function" || isPatched(fn)) return fn;
      return mark(function(...args) {
        try {
          observe(args);
        } catch {
        }
        return fn.apply(this, args);
      }, fn);
    };
    const fallback = (v) => typeof v === "function" ? v : passive ? PASSIVE : v;
    if (desc && (desc.get || desc.set) && desc.configurable !== false) {
      const { get, set } = desc;
      Object.defineProperty(obj, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          const orig = unwrap(get?.call(this));
          return orig === PASSIVE ? null : orig;
        },
        set(v) {
          set?.call(this, wrap(fallback(v)));
        }
      });
      set?.call(obj, wrap(fallback(get?.call(obj))));
    } else if (!desc || desc.writable !== false) {
      let value = wrap(fallback(desc && "value" in desc ? desc.value : void 0));
      Object.defineProperty(obj, prop, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set(v) {
          value = wrap(fallback(v));
        }
      });
    }
  }
  function packetEntry(room2, level, data, via) {
    const parsed = tryParse(data);
    const type = parsed && typeof parsed === "object" && "type" in parsed ? String(parsed.type) : "";
    hub.room.push({
      tag: roomLabel(room2),
      level,
      summary: (type ? `[${type}] ` : "") + preview(parsed, 300),
      detail: { via, data: parsed },
      data: parsed
    });
  }
  function attachRoom(room2, source) {
    if (!room2 || typeof room2 !== "object" || attached.has(room2)) return;
    const r = room2;
    if (typeof r.send !== "function" && typeof r.collection !== "function") return;
    attached.add(room2);
    const label = `room${++roomCount}`;
    hub.rooms.add({ room: r, label, source });
    hub.room.push({ tag: label, level: "info", summary: `Attached ${label} (${source})`, detail: { source } });
    for (const method of ["send", "updatePresence", "updateRoomState", "requestPresenceUpdate"]) {
      const fn = r[method];
      if (typeof fn !== "function" || isPatched(fn)) continue;
      try {
        r[method] = mark(function(...args) {
          packetEntry(room2, "out", args.length === 1 ? args[0] : args, method);
          return fn.apply(this, args);
        }, fn);
      } catch {
      }
    }
    try {
      hookHandler(r, "onmessage", (args) => {
        const ev = args[0];
        packetEntry(room2, "in", ev && typeof ev === "object" && "data" in ev ? ev.data : ev, "onmessage");
      }, true);
      for (const prop of ["onreconnect", "onclose", "onopen"]) {
        hookHandler(r, prop, (args) => {
          hub.room.push({
            tag: label,
            level: prop === "onclose" ? "warn" : "info",
            summary: prop.slice(2) + (args[0] && typeof args[0] === "object" && "reason" in args[0] ? ": " + String(args[0].reason) : ""),
            detail: args[0]
          });
        }, false);
      }
      hub.hooks.set("room:" + label, "observing (" + source + ")");
    } catch (error) {
      hub.hooks.set("room:" + label, "send only; handler hook failed: " + errorMessage(error));
    }
  }
  function installRoomHook() {
    whenGlobal("WebsimSocket", (WS, late) => {
      if (typeof WS !== "function") return;
      const Ctor = WS;
      const join = Ctor.joinRoom;
      if (typeof join === "function" && !isPatched(join)) {
        try {
          Ctor.joinRoom = mark(function(...args) {
            const result = join.apply(this, args);
            if (isThenable(result)) result.then((room2) => attachRoom(room2, "joinRoom"), () => {
            });
            else attachRoom(result, "joinRoom");
            return result;
          }, join);
        } catch {
        }
      }
      hub.hooks.set("WebsimSocket", late ? "installed (after page load)" : "installed");
      return new Proxy(Ctor, {
        construct(target, args, newTarget) {
          const instance = Reflect.construct(target, args, newTarget);
          try {
            attachRoom(instance, "new WebsimSocket");
          } catch {
          }
          return instance;
        }
      });
    });
  }
  function discoverRooms() {
    const before = hub.rooms.list.length;
    const candidates = [];
    try {
      candidates.push(typeof room !== "undefined" ? room : void 0);
    } catch {
    }
    const w = window;
    candidates.push(w.room, w.websimDBRoom, w.party, w.socket, w.ws);
    for (const key of Object.keys(window)) {
      if (!/room|socket|party|net|multi/i.test(key)) continue;
      try {
        candidates.push(w[key]);
      } catch {
      }
    }
    for (const c of candidates) {
      if (c && typeof c === "object" && typeof c.send === "function" && ("onmessage" in c || "roomState" in c || "peers" in c)) {
        attachRoom(c, "found in page globals");
      }
    }
    return hub.rooms.list.length - before;
  }
  function installHooks() {
    for (const [name, install] of [
      ["console", installConsoleHook],
      ["fetch", installFetchHook],
      ["websim", installWebsimHook],
      ["WebsimSocket", installRoomHook]
    ]) {
      try {
        install();
      } catch (error) {
        hub.hooks.set(name, "failed: " + errorMessage(error));
      }
    }
  }

  // src/core/hotkey.ts
  var HOTKEY = {
    ctrl: true,
    alt: false,
    shift: false,
    code: "Backquote",
    label: "Ctrl+`"
  };
  function isHotkey(e) {
    return e.code === HOTKEY.code && e.ctrlKey === HOTKEY.ctrl && e.altKey === HOTKEY.alt && e.shiftKey === HOTKEY.shift && !e.metaKey && !e.repeat;
  }

  // src/core/shell.css
  var shell_default = ":host {\n  all: initial;\n  position: fixed;\n  z-index: 2147483647;\n  display: block;\n  width: min(900px, calc(100vw - 24px));\n  height: min(560px, calc(100dvh - 24px));\n  color: #c6cdd4;\n  font: 12px/1.4 system-ui, sans-serif;\n  color-scheme: dark;\n  text-align: left;\n}\n* { box-sizing: border-box; }\n[hidden] { display: none !important; }\nbutton, input, textarea, select { font: inherit; color: inherit; }\nbutton {\n  cursor: pointer;\n  border: 1px solid #424a53;\n  border-radius: 3px;\n  background: #2a3037;\n  padding: 4px 8px;\n  white-space: nowrap;\n}\nbutton:hover { background: #3a424b; }\nbutton:disabled { opacity: .55; cursor: default; }\nbutton.primary, button.on { background: #3c4c37; color: #d6e8cb; border-color: #4f6448; }\nbutton.danger { color: #f0b3a9; }\nbutton:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {\n  outline: 2px solid #a7c38d;\n  outline-offset: 1px;\n}\ninput, textarea, select {\n  background: #15191e;\n  border: 1px solid #424a53;\n  border-radius: 3px;\n  padding: 4px 6px;\n  min-width: 0;\n}\ninput[type=checkbox] { padding: 0; }\ntextarea { font: 11px/1.5 ui-monospace, monospace; resize: vertical; }\ntextarea.code, input.code { font: 11px/1.5 ui-monospace, monospace; }\na { color: #a7c38d; }\n\n.window {\n  height: 100%;\n  min-width: 320px;\n  min-height: 240px;\n  display: flex;\n  flex-direction: column;\n  background: #1c2025;\n  border: 1px solid #48515b;\n  border-radius: 5px;\n  box-shadow: 0 12px 32px #0005;\n  overflow: hidden;\n  resize: both;\n}\n\n.bar {\n  height: 36px;\n  flex-shrink: 0;\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  padding: 5px 7px;\n  background: #292f36;\n  border-bottom: 1px solid #424a53;\n  cursor: move;\n  touch-action: none;\n  user-select: none;\n}\n.title { font-weight: 600; color: #eef0f3; white-space: nowrap; }\n.where { font-size: 10px; color: #8c98a4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }\n.where.bad { color: #f0b3a9; }\n.actions { margin-left: auto; display: flex; }\n.slot { display: flex; gap: 5px; align-items: center; }\n.to-frame { background: #4a3c25; border-color: #6d5a35; color: #f1dcb2; }\n.close { font-size: 16px; line-height: 17px; padding: 2px 7px; }\n\n.tabs {\n  display: flex;\n  gap: 2px;\n  padding: 3px 6px 0;\n  background: #22272d;\n  border-bottom: 1px solid #38414b;\n  overflow-x: auto;\n  scrollbar-width: thin;\n  flex-shrink: 0;\n}\n.tabs button {\n  background: transparent;\n  border: 1px solid transparent;\n  border-bottom: 0;\n  border-radius: 3px 3px 0 0;\n  padding: 4px 10px 5px;\n  color: #9ca8b3;\n}\n.tabs button.active { background: #1c2025; border-color: #38414b; color: #eef0f3; margin-bottom: -1px; }\n\n.panes { flex: 1; min-height: 0; display: flex; }\n.pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }\n\n.foot {\n  border-top: 1px solid #38414b;\n  padding: 5px 7px;\n  display: flex;\n  gap: 6px;\n  align-items: center;\n  min-height: 31px;\n  font-size: 10px;\n}\n.foot button { padding: 1px 6px; }\n.status {\n  flex: 1;\n  min-width: 0;\n  overflow: auto;\n  max-height: 44px;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  line-height: 1.5;\n}\n.status.error { color: #f0b3a9; }\n\n/* ---------- shared tool UI ---------- */\n.muted { color: #8c98a4; }\n.hint { font-size: 10px; color: #9ca8b3; }\n.error-text { color: #f0b3a9; white-space: pre-wrap; }\n.empty { white-space: pre-wrap; color: #9ca8b3; padding: 12px; font-size: 11px; line-height: 1.6; }\n.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }\n.row > .grow { flex: 1; min-width: 80px; }\n.stack { display: flex; flex-direction: column; gap: 6px; }\n.scroll { overflow: auto; flex: 1; min-height: 0; }\n.pad { padding: 8px; }\nlabel.check { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }\nlabel.field { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: #9ca8b3; }\nlabel.field > input, label.field > select, label.field > textarea { font-size: 12px; color: #c6cdd4; }\nfieldset { border: 1px solid #38414b; border-radius: 4px; padding: 8px; margin: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }\nlegend { color: #aab6c3; padding: 0 4px; font-weight: 600; }\npre.json {\n  margin: 0;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  color: #c4d2bd;\n  font: 11px/1.55 ui-monospace, monospace;\n}\n.box { background: #171b20; border: 1px solid #303841; border-radius: 4px; padding: 8px; overflow: auto; }\n.split { display: flex; flex: 1; min-height: 0; }\n.split > * { min-width: 0; }\n.split-v { display: flex; flex-direction: column; flex: 1; min-height: 0; }\n.avatar { width: 20px; height: 20px; border-radius: 50%; vertical-align: middle; background: #2a3037; flex-shrink: 0; }\n.badge { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: #2a3037; border: 1px solid #424a53; white-space: nowrap; }\n.badge.good { background: #2c3a28; border-color: #4f6448; color: #cfe3c2; }\n.badge.bad { background: #3d2a28; border-color: #6d4741; color: #f0b3a9; }\ntable.grid { border-collapse: collapse; width: 100%; font: 11px/1.5 ui-monospace, monospace; }\ntable.grid th { position: sticky; top: 0; background: #29313a; color: #aab6c3; font-weight: 400; text-align: left; }\ntable.grid th, table.grid td { padding: 4px 8px; border-bottom: 1px solid #303841; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\ntable.grid tbody tr { cursor: pointer; }\ntable.grid tbody tr:hover { background: #29362b; }\ntable.grid tbody tr.selected { background: #2f3d2b; }\n\n.subtabs { display: flex; gap: 3px; padding: 5px 6px; border-bottom: 1px solid #303841; flex-shrink: 0; overflow-x: auto; }\n.subtabs button { padding: 2px 9px; font-size: 11px; background: transparent; border-color: #353d45; color: #9ca8b3; }\n.subtabs button.active { background: #2f3a44; color: #eef0f3; border-color: #4b5662; }\n.subbody { flex: 1; min-height: 0; display: flex; flex-direction: column; }\n.subview { flex: 1; min-height: 0; display: flex; flex-direction: column; }\n\n/* ---------- log view ---------- */\n.log { flex: 1; min-height: 0; display: flex; flex-direction: column; }\n.log-tools { display: flex; gap: 5px; align-items: center; padding: 5px 6px; border-bottom: 1px solid #303841; flex-wrap: wrap; }\n.log-filter { flex: 1; min-width: 90px; font-size: 11px; }\n.log-tools select, .log-tools button { font-size: 11px; padding: 2px 7px; }\n.log-count { font-size: 10px; white-space: nowrap; }\n.log-body { flex: 1; min-height: 0; display: flex; position: relative; }\n.log-scroll { flex: 1; overflow: auto; min-width: 0; }\n.log-row { display: flex; gap: 8px; padding: 3px 8px; border-bottom: 1px solid #262c33; font: 11px/1.45 ui-monospace, monospace; cursor: pointer; white-space: nowrap; }\n.log-row:hover { background: #242b31; }\n.log-row.selected { background: #2f3d2b; }\n.log-head { position: sticky; top: 0; background: #22282f; color: #8c98a4; cursor: default; z-index: 1; }\n.log-head:hover { background: #22282f; }\n.c-time { width: 84px; flex-shrink: 0; color: #7d8994; }\n.c-tag { width: 130px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; color: #aab6c3; }\n.c-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }\n.c-ms { width: 44px; flex-shrink: 0; text-align: right; color: #7d8994; }\n.lv-warn .c-sum { color: #e9d38f; }\n.lv-error .c-sum, .lv-error .c-tag { color: #f0b3a9; }\n.lv-pending .c-sum { color: #8c98a4; font-style: italic; }\n.lv-ok .c-sum { color: #c4d2bd; }\n.lv-in .c-tag::before { content: '↓ '; color: #8fc1e9; }\n.lv-out .c-tag::before { content: '↑ '; color: #e9b98f; }\n.lv-sim .c-tag::before { content: '⇣ '; color: #c38fe9; }\n.lv-debug .c-sum { color: #8c98a4; }\n.log-detail { width: 45%; min-width: 200px; border-left: 1px solid #38414b; display: flex; flex-direction: column; }\n.log-detail-head { display: flex; gap: 4px; padding: 4px 6px; border-bottom: 1px solid #303841; justify-content: flex-end; flex-wrap: wrap; }\n.log-detail-head button { font-size: 11px; padding: 1px 7px; }\n.log-detail-actions { display: flex; gap: 4px; margin-right: auto; flex-wrap: wrap; }\n.log-detail-body { flex: 1; overflow: auto; padding: 8px; }\n\n@media (max-width: 600px) {\n  .bar { gap: 3px; }\n  .bar button { padding: 4px 6px; font-size: 11px; }\n  .title { font-size: 11px; }\n  .status { font-size: 9px; }\n  .c-tag { width: 80px; }\n  .c-time { display: none; }\n  .log-detail { position: absolute; inset: 0; width: auto; background: #1c2025; z-index: 2; }\n  .split { flex-direction: column; }\n}\n";

  // src/core/shell.ts
  var WINDOW_KEY = "__wbsmutilWindow";
  var FRAME = `
<div class="bar">
  <span class="title">WbSmUtil</span>
  <span class="where" title="Frame this window is running in"></span>
  <div class="actions"></div>
  <button class="to-frame" title="Move into the project iframe (the tools only work there)">⧉ Move into project frame</button>
  <button class="close" aria-label="Close and stop" title="Close and stop">×</button>
</div>
<nav class="tabs" aria-label="Tools"></nav>
<div class="panes"></div>
<div class="foot"><span class="status" role="status">Ready</span><div class="foot-slots"></div></div>`;
  function isOpen() {
    return !!window[WINDOW_KEY];
  }
  function closeShell() {
    window[WINDOW_KEY]?.close();
  }
  function openShell(tools2) {
    const existing = window[WINDOW_KEY];
    if (existing) {
      existing.focus();
      return;
    }
    const abort = new AbortController();
    const timers = /* @__PURE__ */ new Set();
    let stopped = false;
    const host = document.createElement("div");
    host.setAttribute("data-wbsmutil", "");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = [shell_default, ...tools2.map((t) => t.css ?? "")].join("\n");
    const frame = document.createElement("section");
    frame.className = "window";
    frame.innerHTML = FRAME;
    shadow.append(style, frame);
    (document.body ?? document.documentElement).append(host);
    host.style.left = Math.max(12, (innerWidth - host.offsetWidth) / 2) + "px";
    host.style.top = Math.max(12, Math.min(100, innerHeight - host.offsetHeight - 12)) + "px";
    const q = (selector) => {
      const el = shadow.querySelector(selector);
      if (!el) throw new Error("WbSmUtil: missing element " + selector);
      return el;
    };
    const on = (el, type, fn) => el.addEventListener(type, fn, { signal: abort.signal });
    for (const type of ["keydown", "keyup", "keypress"]) {
      on(host, type, (e) => e.stopPropagation());
    }
    const bar = q(".bar");
    const statusEl = q(".status");
    const history = [];
    function status(text, error = false) {
      if (stopped) return;
      history.push(text);
      if (history.length > 12) history.shift();
      statusEl.textContent = text;
      statusEl.title = history.join(" · ");
      statusEl.classList.toggle("error", error);
    }
    function wait(promise, ms = 3e4) {
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          timers.delete(timer);
          abort.signal.removeEventListener("abort", cancel);
          fn();
        };
        const timer = setTimeout(() => finish(() => reject(new Error("Websim request timed out."))), ms);
        timers.add(timer);
        const cancel = () => finish(() => reject(new DOMException("Closed", "AbortError")));
        abort.signal.addEventListener("abort", cancel, { once: true });
        Promise.resolve(promise).then(
          (v) => finish(() => resolve(v)),
          (e) => finish(() => reject(e))
        );
      });
    }
    function close() {
      stopped = true;
      abort.abort();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      host.remove();
      if (window[WINDOW_KEY]?.host === host) delete window[WINDOW_KEY];
    }
    const site2 = isSitePage();
    q(".where").textContent = site2 ? "websim.com page" : location.host;
    q(".where").classList.toggle("bad", site2);
    const toFrame = q(".to-frame");
    toFrame.hidden = !site2;
    on(toFrame, "click", async () => {
      toFrame.disabled = true;
      status("Moving into the project frame…");
      const ok = await sendToProjectFrame("open");
      toFrame.disabled = false;
      if (ok) {
        close();
        return;
      }
      const hosts = iframeHosts();
      status(
        "No project frame answered. " + (hosts.length ? "Iframes on this page: " + hosts.join(", ") + ". Make sure the userscript @match covers the project frame host." : "No iframes on this page; open a project first."),
        true
      );
    });
    const mounted = /* @__PURE__ */ new Map();
    let active = null;
    const tabs = q(".tabs");
    tabs.hidden = tools2.length < 2;
    function activate(tool) {
      let m = mounted.get(tool.id);
      if (!m) {
        const pane = document.createElement("div");
        pane.className = "pane pane-" + tool.id;
        const actions = document.createElement("div");
        actions.className = "slot";
        const foot = document.createElement("div");
        foot.className = "slot";
        q(".panes").append(pane);
        q(".actions").append(actions);
        q(".foot-slots").append(foot);
        const tab = tabs.querySelector(`button[data-tool="${CSS.escape(tool.id)}"]`);
        const entry = { tool, pane, actions, foot, tab };
        m = entry;
        mounted.set(tool.id, entry);
        const ctx = {
          pane,
          actions,
          foot,
          signal: abort.signal,
          stopped: () => stopped,
          $: (selector) => {
            const el = pane.querySelector(selector) ?? actions.querySelector(selector) ?? foot.querySelector(selector);
            if (!el) throw new Error(`WbSmUtil (${tool.id}): missing element ${selector}`);
            return el;
          },
          on,
          wait,
          status,
          open: (id) => {
            const t = tools2.find((x) => x.id === id);
            if (t) activate(t);
          }
        };
        Promise.resolve().then(() => tool.mount(ctx)).catch((error) => {
          if (!stopped) status(tool.label + " failed: " + errorMessage(error), true);
        });
      }
      for (const other of mounted.values()) {
        const isActive = other === m;
        other.pane.hidden = other.actions.hidden = other.foot.hidden = !isActive;
        other.tab?.classList.toggle("active", isActive);
        other.tab?.setAttribute("aria-selected", String(isActive));
      }
      active = m;
    }
    for (const tool of tools2) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = tool.label;
      b.dataset.tool = tool.id;
      b.setAttribute("role", "tab");
      on(b, "click", () => activate(tool));
      tabs.append(b);
    }
    window[WINDOW_KEY] = {
      host,
      close,
      focus: () => (active?.tab ?? q(".close")).focus()
    };
    on(q(".close"), "click", close);
    on(window, "pagehide", close);
    let drag = null;
    on(bar, "pointerdown", (e) => {
      if (e.target.closest("button, input, select")) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, l: parseFloat(host.style.left), t: parseFloat(host.style.top) };
      bar.setPointerCapture(e.pointerId);
    });
    on(bar, "pointermove", (e) => {
      if (!drag) return;
      host.style.left = Math.max(0, Math.min(innerWidth - host.offsetWidth, drag.l + e.clientX - drag.x)) + "px";
      host.style.top = Math.max(0, Math.min(innerHeight - 36, drag.t + e.clientY - drag.y)) + "px";
    });
    on(bar, "pointerup", () => drag = null);
    on(bar, "pointercancel", () => drag = null);
    on(window, "resize", () => {
      host.style.left = Math.max(0, Math.min(parseFloat(host.style.left), innerWidth - host.offsetWidth)) + "px";
      host.style.top = Math.max(0, Math.min(parseFloat(host.style.top), innerHeight - 36)) + "px";
    });
    const first = tools2[0];
    if (first) activate(first);
  }

  // src/core/logview.ts
  var MAX_ROWS = 1e3;
  function logView(opts) {
    const { channel, signal } = opts;
    let paused = false;
    let selected = null;
    let queue = [];
    let flushTimer = null;
    let held = 0;
    const rows = /* @__PURE__ */ new Map();
    const filterInput = h("input", {
      class: "log-filter",
      placeholder: "Filter (-term excludes)",
      "aria-label": "Filter entries",
      oninput: () => rebuild()
    });
    const levelSelect = opts.levels ? h(
      "select",
      { "aria-label": "Level", onchange: () => rebuild() },
      h("option", { value: "", text: "All" }),
      opts.levels.map((l) => h("option", { value: l, text: l }))
    ) : null;
    const pauseBtn = h("button", {
      type: "button",
      text: "Pause",
      title: "Stop adding new rows (entries are still recorded)",
      onclick: () => {
        paused = !paused;
        pauseBtn.textContent = paused ? "Resume" : "Pause";
        pauseBtn.classList.toggle("on", paused);
        if (!paused) rebuild();
      }
    });
    const count = h("span", { class: "muted log-count" });
    const list = h("div", { class: "log-list", role: "list" });
    const detailBody = h("div", { class: "log-detail-body" });
    const detailActions = h("div", { class: "log-detail-actions" });
    const detail = h(
      "div",
      { class: "log-detail", hidden: true },
      h(
        "div",
        { class: "log-detail-head" },
        detailActions,
        h("button", {
          type: "button",
          text: "Copy",
          onclick: () => {
            if (selected) void copyText(pretty(selected.detail ?? selected));
          }
        }),
        h("button", { type: "button", text: "×", "aria-label": "Close detail", onclick: () => select(null) })
      ),
      detailBody
    );
    const header = h(
      "div",
      { class: "log-row log-head" },
      h("span", { class: "c-time", text: "Time" }),
      h("span", { class: "c-tag", text: opts.tagLabel ?? "Type" }),
      h("span", { class: "c-sum", text: "Summary" }),
      h("span", { class: "c-ms", text: "ms" })
    );
    const el = h(
      "div",
      { class: "log" },
      h(
        "div",
        { class: "log-tools" },
        filterInput,
        levelSelect,
        ...opts.tools ?? [],
        pauseBtn,
        h("button", { type: "button", text: "Clear", onclick: () => channel.clear() }),
        count
      ),
      h("div", { class: "log-body" }, h("div", { class: "log-scroll" }, header, list), detail)
    );
    function matches(entry) {
      if (opts.include && !opts.include(entry)) return false;
      const level = levelSelect?.value;
      if (level && entry.level !== level) return false;
      const terms = filterInput.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return true;
      const hay = (entry.tag + " " + entry.level + " " + entry.summary).toLowerCase();
      return terms.every((t) => t.startsWith("-") && t.length > 1 ? !hay.includes(t.slice(1)) : hay.includes(t));
    }
    function fill(row, entry) {
      row.className = "log-row lv-" + entry.level + (entry === selected ? " selected" : "");
      row.replaceChildren(
        h("span", { class: "c-time", text: clock(entry.time) }),
        h("span", { class: "c-tag", text: entry.tag, title: entry.tag }),
        h("span", { class: "c-sum", text: entry.summary, title: entry.summary.slice(0, 2e3) }),
        h("span", { class: "c-ms", text: entry.ms === void 0 ? "" : String(Math.round(entry.ms)) })
      );
    }
    function addRow(entry) {
      const row = h("div", { role: "listitem", tabIndex: 0 });
      row.dataset.id = String(entry.id);
      fill(row, entry);
      rows.set(entry.id, row);
      list.append(row);
      while (list.childElementCount > MAX_ROWS) {
        const first = list.firstElementChild;
        if (!first) break;
        rows.delete(Number(first.dataset.id));
        first.remove();
      }
    }
    function updateCount() {
      count.textContent = rows.size + " shown" + (held ? ` · ${held} held` : "");
    }
    function stickToBottom(fn) {
      const scroller = list.parentElement;
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 30;
      const result = fn();
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
      return result;
    }
    function rebuild() {
      held = 0;
      queue = [];
      rows.clear();
      stickToBottom(() => {
        list.replaceChildren();
        const visible = channel.entries.filter(matches).slice(-MAX_ROWS);
        for (const entry of visible) addRow(entry);
        if (!visible.length) list.append(h("div", { class: "empty", text: opts.empty ?? "Nothing captured yet." }));
      });
      updateCount();
    }
    function flush() {
      flushTimer = null;
      const batch = queue;
      queue = [];
      if (!batch.length) return;
      stickToBottom(() => {
        list.querySelector(":scope > .empty")?.remove();
        for (const entry of batch) addRow(entry);
      });
      updateCount();
    }
    function select(entry) {
      rows.get(selected?.id ?? -1)?.classList.remove("selected");
      selected = entry;
      detail.hidden = !entry;
      if (!entry) return;
      rows.get(entry.id)?.classList.add("selected");
      renderDetail();
    }
    function renderDetail() {
      if (!selected) return;
      const entry = selected;
      detailActions.replaceChildren(
        ...(opts.actions ?? []).map(
          (a) => h("button", { type: "button", text: a.label, onclick: () => a.run(entry) })
        )
      );
      detailBody.replaceChildren(
        opts.renderDetail ? opts.renderDetail(entry) : h("pre", { class: "json", text: pretty(entry.detail ?? entry.summary) })
      );
    }
    const pick = (e) => {
      const row = e.target.closest(".log-row[data-id]");
      if (!row) return;
      const id = Number(row.dataset.id);
      const entry = channel.entries.find((x) => x.id === id);
      if (entry) select(entry);
    };
    list.addEventListener("click", pick);
    list.addEventListener("keydown", (e) => {
      if (e.key === "Enter") pick(e);
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
      }
    );
    signal.addEventListener("abort", () => flushTimer && clearTimeout(flushTimer), { once: true });
    rebuild();
    return { el, select };
  }

  // src/core/websim.ts
  function isLegacySocket(value) {
    return !!value && typeof value.collection === "function";
  }
  function getWebsim() {
    const ws = window.websim;
    return ws && typeof ws === "object" ? ws : null;
  }
  function requireWebsim(key) {
    const ws = getWebsim();
    if (!ws) throw new Error("window.websim is not available in this frame.");
    const value = ws[key];
    if (value === void 0 || value === null) throw new Error(`websim.${String(key)} is not available on this page.`);
    return value;
  }
  function pageRoom() {
    return typeof room !== "undefined" ? room : void 0;
  }
  function findSocket() {
    for (const candidate of [pageRoom(), window.websimDBRoom, window.room, ...hub.rooms.list.map((r) => r.room)]) {
      if (isLegacySocket(candidate)) return candidate;
    }
    return null;
  }

  // src/tools/ai/ai.css
  var ai_default = ".chat { flex: 1; }\n.chat > .split-v { flex: 1; }\n.chat-side { width: 260px; flex: none; border-left: 1px solid #303841; }\n.chat-log { padding: 8px; display: flex; flex-direction: column; gap: 6px; }\n.composer { border-top: 1px solid #303841; align-items: stretch; flex-wrap: nowrap; }\n.composer textarea { resize: none; }\n.msg { border: 1px solid #303841; border-radius: 4px; padding: 6px 8px; background: #20262c; }\n.msg .role { font-size: 10px; color: #8c98a4; text-transform: uppercase; letter-spacing: .04em; }\n.msg .text { white-space: pre-wrap; overflow-wrap: anywhere; }\n.msg-user { background: #232b33; align-self: flex-end; max-width: 85%; }\n.msg-assistant { background: #222a22; max-width: 95%; }\n.msg-error { border-color: #6d4741; color: #f0b3a9; }\nimg.gen { max-width: 100%; max-height: 320px; border-radius: 4px; display: block; background: repeating-conic-gradient(#2a3037 0 25%, #20252b 0 50%) 0 0 / 16px 16px; }\ndetails summary { cursor: pointer; color: #aab6c3; }\n@media (max-width: 600px) { .chat-side { width: auto; border-left: 0; border-top: 1px solid #303841; max-height: 40%; } }\n";

  // src/tools/ai/index.ts
  var AI_CALL = /^websim\.(chat|imageGen|textToSpeech|agent|ai)|^agent#/;
  var ASPECTS = ["", "1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"];
  var VOICES = ["en-female", "en-male", "es-female", "es-male", "fr-female", "fr-male", "de-female", "de-male", "ja-female", "ja-male"];
  var aiTool = {
    id: "ai",
    label: "AI",
    css: ai_default,
    mount(ctx) {
      const monitor = h("div");
      const chat = h("div");
      const image = h("div");
      const speech = h("div");
      subtabs(ctx.pane, [
        {
          id: "monitor",
          label: "Monitor",
          el: monitor,
          init: () => monitor.append(
            logView({
              channel: hub.websim,
              signal: ctx.signal,
              include: (e) => AI_CALL.test(e.tag),
              tagLabel: "Call",
              empty: "No AI calls yet. Calls the project makes to websim.chat, imageGen, textToSpeech and agents appear here with their arguments, results, errors and timing."
            }).el
          )
        },
        { id: "chat", label: "Chat", el: chat, init: () => chatPlayground(ctx, chat) },
        { id: "image", label: "Image", el: image, init: () => imagePlayground(ctx, image) },
        { id: "speech", label: "Speech", el: speech, init: () => speechPlayground(ctx, speech) }
      ]);
    }
  };
  function chatPlayground(ctx, root) {
    let history = [];
    let busy = null;
    const system = h("textarea", { class: "code", rows: 2, placeholder: "System prompt (optional)" });
    const log = h("div", { class: "chat-log scroll" });
    const input = h("textarea", { class: "code grow", rows: 2, placeholder: "User message… (Ctrl+Enter to send)" });
    const json = h("input", { type: "checkbox" });
    const stream = h("input", { type: "checkbox" });
    const schema = h("textarea", { class: "code", rows: 4, placeholder: '{"type":"object","properties":{…}}' });
    const imageInput = h("input", { type: "file", accept: "image/*" });
    const raw = h("pre", { class: "json" });
    const sendBtn = h("button", { type: "button", class: "primary", text: "Send", onclick: () => void send() });
    const stopBtn = h("button", { type: "button", text: "Stop", hidden: true, onclick: () => busy?.abort() });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
    });
    function bubble(role, text) {
      const el = h("div", { class: "msg msg-" + role }, h("span", { class: "role", text: role }), h("div", { class: "text", text }));
      log.append(el);
      log.scrollTop = log.scrollHeight;
      return el.querySelector(".text");
    }
    function renderHistory() {
      log.replaceChildren();
      for (const m of history) bubble(m.role, typeof m.content === "string" ? m.content : pretty(m.content));
      if (!history.length) log.append(h("div", { class: "empty", text: "Calls websim.chat.completions.create as this page. Requests are metered like the project’s own." }));
    }
    async function send() {
      if (busy) return;
      const text = input.value.trim();
      const file = imageInput.files?.[0];
      if (!text && !file) return;
      try {
        const create = requireWebsim("chat")?.completions?.create;
        if (typeof create !== "function") throw new Error("websim.chat.completions.create is not available.");
        const content = file ? [{ type: "text", text }, { type: "image_url", image_url: { url: await fileToDataUrl(file) } }] : text;
        history.push({ role: "user", content });
        renderHistory();
        input.value = "";
        imageInput.value = "";
        const messages = [...system.value.trim() ? [{ role: "system", content: system.value }] : [], ...history];
        const opts = { messages };
        if (json.checked) opts.json = true;
        if (schema.value.trim()) opts.schema = parseJsonField(schema.value, "Schema");
        busy = new AbortController();
        sendBtn.disabled = true;
        stopBtn.hidden = false;
        const started = performance.now();
        if (stream.checked) {
          opts.stream = true;
          opts.signal = busy.signal;
          const out = bubble("assistant", "");
          let full = "";
          const iterable = await create.call(requireWebsim("chat").completions, opts);
          for await (const chunk of iterable) {
            if (ctx.stopped()) return;
            full = chunk.content ?? full + (chunk.delta ?? "");
            out.textContent = full;
            log.scrollTop = log.scrollHeight;
          }
          history.push({ role: "assistant", content: full });
          raw.textContent = "(streamed) " + full;
        } else {
          const completion = await ctx.wait(create.call(requireWebsim("chat").completions, opts), 12e4);
          history.push({ role: completion.role ?? "assistant", content: completion.content });
          renderHistory();
          raw.textContent = pretty(completion);
        }
        ctx.status(`Chat completion in ${Math.round(performance.now() - started)} ms`);
      } catch (error) {
        if (!ctx.stopped()) {
          bubble("error", errorMessage(error));
          ctx.status("Chat failed: " + errorMessage(error), true);
        }
      } finally {
        busy = null;
        sendBtn.disabled = false;
        stopBtn.hidden = true;
      }
    }
    root.append(
      h(
        "div",
        { class: "split chat" },
        h(
          "div",
          { class: "split-v" },
          log,
          h("div", { class: "row pad composer" }, input, h("div", { class: "stack" }, sendBtn, stopBtn))
        ),
        h(
          "aside",
          { class: "chat-side scroll pad stack" },
          h("label", { class: "field" }, "System", system),
          h("div", { class: "row" }, h("label", { class: "check" }, json, "json: true"), h("label", { class: "check" }, stream, "stream")),
          h("label", { class: "field" }, "Schema (strict JSON output)", schema),
          h("label", { class: "field" }, "Image input", imageInput),
          h(
            "div",
            { class: "row" },
            h("button", { type: "button", text: "Reset conversation", onclick: () => (history = [], renderHistory()) }),
            h("button", {
              type: "button",
              text: "Edit history",
              title: "Edit the messages array as JSON",
              onclick: () => {
                const value = prompt("Messages JSON", JSON.stringify(history));
                if (value === null) return;
                try {
                  const parsed = JSON.parse(value);
                  if (!Array.isArray(parsed)) throw new Error("Expected an array");
                  history = parsed;
                  renderHistory();
                } catch (error) {
                  ctx.status("History not changed: " + errorMessage(error), true);
                }
              }
            })
          ),
          h("details", {}, h("summary", { text: "Last raw response" }), raw)
        )
      )
    );
    renderHistory();
  }
  function imagePlayground(ctx, root) {
    const promptEl = h("textarea", { class: "code", rows: 3, placeholder: "A crayon drawing of a turtle" });
    const aspect = h("select", {}, ASPECTS.map((a) => h("option", { value: a, text: a || "default" })));
    const width = h("input", { type: "number", placeholder: "width", min: 64, step: 64, style: "width:80px" });
    const height = h("input", { type: "number", placeholder: "height", min: 64, step: 64, style: "width:80px" });
    const seed = h("input", { type: "number", placeholder: "seed", style: "width:80px" });
    const transparent = h("input", { type: "checkbox" });
    const inputs = h("input", { type: "file", accept: "image/*", multiple: true });
    const result = h("div", { class: "stack" });
    const go = h("button", {
      type: "button",
      class: "primary",
      text: "Generate",
      onclick: async () => {
        const opts = { prompt: promptEl.value };
        if (aspect.value) opts.aspect_ratio = aspect.value;
        if (width.value) opts.width = Number(width.value);
        if (height.value) opts.height = Number(height.value);
        if (seed.value) opts.seed = Number(seed.value);
        if (transparent.checked) opts.transparent = true;
        go.disabled = true;
        const started = performance.now();
        result.replaceChildren(h("div", { class: "muted", text: "Generating… (usually ~10 s)" }));
        try {
          const files = [...inputs.files ?? []].slice(0, 4);
          if (files.length) opts.image_inputs = await Promise.all(files.map(async (f) => ({ url: await fileToDataUrl(f) })));
          const res = await ctx.wait(requireWebsim("imageGen")(opts), 12e4);
          if (ctx.stopped()) return;
          result.replaceChildren(
            res.url ? h("a", { href: res.url, target: "_blank", rel: "noopener" }, h("img", { class: "gen", src: res.url, alt: String(opts.prompt) })) : "",
            res.url ? h("input", { class: "code", readOnly: true, value: res.url, onclick: (e) => e.target.select() }) : "",
            jsonBlock(res)
          );
          ctx.status(`Image generated in ${Math.round(performance.now() - started)} ms`);
        } catch (error) {
          result.replaceChildren(h("div", { class: "error-text", text: errorMessage(error) }));
          ctx.status("imageGen failed: " + errorMessage(error), true);
        } finally {
          go.disabled = false;
        }
      }
    });
    root.append(
      h(
        "div",
        { class: "scroll pad stack" },
        h("label", { class: "field" }, "Prompt", promptEl),
        h(
          "div",
          { class: "row" },
          h("label", { class: "field" }, "Aspect", aspect),
          h("label", { class: "field" }, "Size", h("span", { class: "row" }, width, "×", height)),
          h("label", { class: "field" }, "Seed", seed),
          h("label", { class: "check" }, transparent, "transparent")
        ),
        h("label", { class: "field" }, "Image inputs (1–4, sent as data URLs)", inputs),
        h("div", { class: "row" }, go),
        result
      )
    );
  }
  function speechPlayground(ctx, root) {
    const text = h("textarea", { class: "code", rows: 3, value: "Hello, world!" });
    const voice = h("input", { list: "wbsm-voices", placeholder: "en-female", style: "width:120px" });
    const list = h("datalist", { id: "wbsm-voices" }, VOICES.map((v) => h("option", { value: v })));
    const file = h("input", { type: "checkbox" });
    const result = h("div", { class: "stack" });
    const go = h("button", {
      type: "button",
      class: "primary",
      text: "Speak",
      onclick: async () => {
        const opts = { text: text.value };
        if (voice.value.trim()) opts.voice = voice.value.trim();
        if (file.checked) opts.generateFile = true;
        go.disabled = true;
        const started = performance.now();
        result.replaceChildren(h("div", { class: "muted", text: file.checked ? "Generating audio file…" : "Speaking…" }));
        try {
          const res = await ctx.wait(requireWebsim("textToSpeech")(opts), 12e4);
          if (ctx.stopped()) return;
          result.replaceChildren(res.url ? h("audio", { controls: true, src: res.url }) : "", jsonBlock(res));
          ctx.status(`textToSpeech finished in ${Math.round(performance.now() - started)} ms`);
        } catch (error) {
          result.replaceChildren(h("div", { class: "error-text", text: errorMessage(error) }));
          ctx.status("textToSpeech failed: " + errorMessage(error), true);
        } finally {
          go.disabled = false;
        }
      }
    });
    root.append(
      h(
        "div",
        { class: "scroll pad stack" },
        h("label", { class: "field" }, "Text", text),
        h(
          "div",
          { class: "row" },
          h("label", { class: "field" }, "Voice (<language>-<gender>)", voice),
          list,
          h("label", { class: "check", title: "Server-side engine; returns an audio URL" }, file, "generateFile")
        ),
        h("div", { class: "row" }, go),
        result
      )
    );
  }

  // src/core/source.ts
  var MAX_FILES = 64;
  var BATCH = 4;
  var IMPORTS = /\b(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  async function crawlSources({ signal, stopped, onText, progress, extra = [] }) {
    const queue = [];
    const seen = /* @__PURE__ */ new Set();
    let count = 0;
    let failed = 0;
    function enqueue(path, base) {
      try {
        if (!/^(\.?\.?\/|\/|https?:)/.test(path)) return;
        const url = new URL(path, base);
        if (url.origin !== location.origin || seen.has(url.href)) return;
        seen.add(url.href);
        queue.push(url.href);
      } catch {
      }
    }
    function scan(text, url) {
      onText(text, url);
      for (const m of text.matchAll(IMPORTS)) {
        const path = m[1] ?? m[2];
        if (path) enqueue(path, url);
      }
    }
    for (const path of extra) enqueue(path, location.href);
    for (const script of document.scripts) {
      if (script.src) enqueue(script.src, location.href);
      else scan(script.textContent ?? "", location.href);
    }
    for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
      enqueue(link.href, location.href);
    }
    while (queue.length && !stopped() && count < MAX_FILES) {
      const batch = queue.splice(0, Math.min(BATCH, MAX_FILES - count));
      count += batch.length;
      await Promise.all(
        batch.map(async (url) => {
          try {
            const response = await fetch(url, { signal, credentials: "same-origin" });
            if (!response.ok) throw new Error(String(response.status));
            const text = await response.text();
            if (stopped()) return;
            scan(text, url);
          } catch (error) {
            if (error.name !== "AbortError") failed++;
          }
        })
      );
      if (!stopped()) progress?.();
    }
    return count + " source files" + (failed ? ", " + failed + " unreadable" : "") + (queue.length ? ` (${MAX_FILES}-file scan limit)` : "");
  }

  // src/tools/api/api.css
  var api_default = ".api { flex: 1; }\n.api-req { width: 46%; flex: none; border-right: 1px solid #303841; }\n.api-resp { flex: 1; }\n.resp-status { min-height: 24px; }\n.pad-x { padding: 0 8px; }\n.api-resp pre.json { font-size: 11px; }\n@media (max-width: 600px) { .api-req { width: auto; border-right: 0; border-bottom: 1px solid #303841; max-height: 55%; } }\n.presets { padding: 0 8px 8px; display: flex; flex-direction: column; gap: 10px; }\n.presets h4 { margin: 0 0 4px; font-size: 10px; color: #8c98a4; font-weight: 400; text-transform: uppercase; letter-spacing: .04em; }\n.presets section { display: flex; flex-direction: column; gap: 3px; }\n.preset { display: grid; grid-template-columns: 52px minmax(120px, 220px) 1fr; gap: 2px 10px; align-items: baseline; text-align: left; white-space: normal; padding: 5px 8px; }\n.preset .m { font: 10px ui-monospace, monospace; color: #e9b98f; }\n.preset .n { color: #eef0f3; }\n.preset .u { font: 10px ui-monospace, monospace; color: #8c98a4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.preset .note { grid-column: 2 / -1; font-size: 10px; color: #9ca8b3; }\n@media (max-width: 600px) { .preset { grid-template-columns: 44px 1fr; } .preset .u { grid-column: 2; } }\n";

  // src/tools/api/presets.ts
  var API = "https://websim.com/api/v1";
  var enc = (json) => encodeURIComponent(json);
  var PRESETS = [
    // Project origin
    { group: "This project", name: "server.js source", method: "GET", url: "/server.js", note: "The backend source. It is public, like every project file." },
    { group: "This project", name: "Page HTML", method: "GET", url: "/" },
    { group: "This project", name: "GET /api route", method: "GET", url: "/api/", note: "Template: add your route name." },
    {
      group: "This project",
      name: "POST JSON to /api route",
      method: "POST",
      url: "/api/",
      headers: { "Content-Type": "application/json" },
      body: "{\n  \n}",
      note: "Template. Your x-websim-* identity headers are added by the platform."
    },
    // Creator
    { group: "Creator", name: "Profile", method: "GET", url: `${API}/users/{creator}` },
    { group: "Creator", name: "Stats", method: "GET", url: `${API}/users/{creator}/stats`, note: "Followers, following, total likes and views." },
    { group: "Creator", name: "Followers", method: "GET", url: `${API}/users/{creator}/follower-users?first=50&include=${enc('["follower"]')}` },
    { group: "Creator", name: "Following", method: "GET", url: `${API}/users/{creator}/following-users?first=50&include=${enc('["following"]')}` },
    { group: "Creator", name: "Projects (recently updated)", method: "GET", url: `${API}/users/{creator}/projects` },
    { group: "Creator", name: "Projects (newest)", method: "GET", url: `${API}/users/{creator}/projects?sort_by=created_at` },
    // Viewer
    { group: "You", name: "Profile", method: "GET", url: `${API}/users/{me}`, note: 'Needs you signed in (signed-out id "1" is rejected).' },
    { group: "You", name: "Stats", method: "GET", url: `${API}/users/{me}/stats` },
    { group: "You", name: "Projects", method: "GET", url: `${API}/users/{me}/projects` },
    {
      group: "You",
      name: "Do you follow the creator?",
      method: "GET",
      url: `${API}/users/{creator_id}/follower-users?ids=${enc('["{me_id}"]')}`,
      note: "Yes when `data` has a row."
    },
    // Comments
    { group: "Comments", name: "Newest 20", method: "GET", url: `${API}/projects/{project_id}/comments?first=20` },
    { group: "Comments", name: "Best", method: "GET", url: `${API}/projects/{project_id}/comments?first=20&sort_by=best` },
    { group: "Comments", name: "Tips only", method: "GET", url: `${API}/projects/{project_id}/comments?first=20&only_tips=true` },
    { group: "Comments", name: "With video", method: "GET", url: `${API}/projects/{project_id}/comments?first=20&only_video=true` },
    { group: "Comments", name: "By the creator", method: "GET", url: `${API}/projects/{project_id}/comments?first=20&author_id={creator_id}` },
    { group: "Comments", name: "Search “bug” (with count)", method: "GET", url: `${API}/projects/{project_id}/comments?q=bug&include_count=true` },
    { group: "Comments", name: "Replies to a comment", method: "GET", url: `${API}/projects/{project_id}/comments/{comment_id}/replies`, note: "Replace {comment_id}." }
  ];
  async function presetVars() {
    const ws = getWebsim();
    const vars = {};
    const settle = async (p) => {
      try {
        return await p;
      } catch {
        return void 0;
      }
    };
    const [creator, me, project] = await Promise.all([
      settle(ws?.getCreator?.()),
      settle(ws?.getCurrentUser?.()),
      settle(ws?.getCurrentProject?.())
    ]);
    if (creator?.username) vars.creator = String(creator.username);
    if (creator?.id) vars.creator_id = String(creator.id);
    if (me?.id && me.id !== "1") {
      vars.me_id = String(me.id);
      vars.me = String(me.username ?? me.id);
    }
    if (project?.id) vars.project_id = String(project.id);
    return vars;
  }
  function fillPreset(p, vars) {
    const missing = /* @__PURE__ */ new Set();
    const url = p.url.replace(/\{(\w+)\}|%7B(\w+)%7D/g, (match, a, b) => {
      const key = a ?? b;
      if (vars[key] !== void 0) return encodeURIComponent(vars[key]);
      missing.add(key);
      return match;
    });
    const spec = { method: p.method, url, headers: { ...p.headers ?? {} } };
    if (p.body !== void 0) spec.body = p.body;
    return { spec, missing: [...missing] };
  }

  // src/tools/api/index.ts
  var METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
  var SAVED_KEY = "wbsmutil:requests";
  var apiTool = {
    id: "api",
    label: "API",
    css: api_default,
    mount(ctx) {
      const requestEl = h("div");
      const trafficEl = h("div");
      const routesEl = h("div");
      const presetsEl = h("div");
      const builder = requestBuilder(ctx, requestEl);
      const select = subtabs(ctx.pane, [
        { id: "request", label: "Request", el: requestEl },
        {
          id: "presets",
          label: "Presets",
          el: presetsEl,
          init: () => presetsView(ctx, presetsEl, (spec) => {
            builder.load(spec);
            select("request");
          })
        },
        {
          id: "traffic",
          label: "Traffic",
          el: trafficEl,
          init: () => trafficEl.append(
            logView({
              channel: hub.net,
              signal: ctx.signal,
              tagLabel: "Method",
              empty: "Every fetch() the page makes is recorded here (XHR and WebSocket traffic are not). Try the filter “/api/”.",
              actions: [
                {
                  label: "Open in builder",
                  run: (e) => {
                    builder.load(e.data);
                    select("request");
                  }
                },
                { label: "Copy as fetch", run: (e) => void copyText(asFetch(e.data)) }
              ]
            }).el
          )
        },
        {
          id: "routes",
          label: "Routes",
          el: routesEl,
          init: () => routesView(ctx, routesEl, (spec) => {
            builder.load(spec);
            select("request");
          })
        }
      ]);
    }
  };
  function asFetch(spec) {
    const init = {};
    if (spec.method !== "GET") init.method = spec.method;
    if (Object.keys(spec.headers).length) init.headers = spec.headers;
    if (spec.body !== void 0) init.body = spec.body;
    return `await fetch(${JSON.stringify(spec.url)}${Object.keys(init).length ? ", " + JSON.stringify(init, null, 2) : ""});`;
  }
  function readSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }
  function writeSaved(list) {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
    }
  }
  function parseHeaders(text) {
    const t = text.trim();
    if (!t) return {};
    if (t.startsWith("{")) {
      const obj = JSON.parse(t);
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    }
    const out = {};
    for (const line of t.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  }
  function requestBuilder(ctx, root) {
    const method = h("select", { "aria-label": "Method" }, METHODS.map((m) => h("option", { value: m, text: m })));
    const url = h("input", { class: "code grow", value: "/api/", "aria-label": "URL", spellcheck: false });
    const headers = h("textarea", { class: "code", rows: 3, placeholder: "Content-Type: application/json\n(or a JSON object)", spellcheck: false });
    const body = h("textarea", { class: "code", rows: 6, placeholder: '{"key": "value"}', spellcheck: false });
    const savedSelect = h("select", { "aria-label": "Saved requests" });
    const statusLine = h("div", { class: "row resp-status" });
    const respHeaders = h("pre", { class: "json" });
    const respBody = h("pre", { class: "json" });
    const sendBtn = h("button", { type: "button", class: "primary", text: "Send", onclick: () => void send() });
    url.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void send();
    });
    function spec() {
      const s = { method: method.value, url: url.value.trim(), headers: parseHeaders(headers.value) };
      if (body.value && method.value !== "GET" && method.value !== "HEAD") {
        s.body = body.value;
        const hasType = Object.keys(s.headers).some((k) => k.toLowerCase() === "content-type");
        if (!hasType && typeof tryParse(body.value) === "object") s.headers["Content-Type"] = "application/json";
      }
      return s;
    }
    function load(s) {
      method.value = METHODS.includes(s.method) ? s.method : "GET";
      let u = s.url;
      try {
        const parsed = new URL(s.url, location.href);
        if (parsed.origin === location.origin) u = parsed.pathname + parsed.search;
      } catch {
      }
      url.value = u;
      headers.value = Object.entries(s.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
      const placeholder = /^\[(FormData|Blob|File|binary|[A-Z]\w*)[ \]]/.test(s.body ?? "");
      body.value = s.body && !placeholder ? s.body : "";
      if (placeholder) ctx.status("The original body was " + s.body + " and cannot be replayed as text.");
    }
    function refreshSaved() {
      const list = readSaved();
      savedSelect.replaceChildren(
        h("option", { value: "", text: list.length ? `Saved (${list.length})…` : "No saved requests" }),
        ...list.map((s, i) => h("option", { value: String(i), text: `${s.spec.method} ${s.name}` }))
      );
    }
    savedSelect.addEventListener("change", () => {
      const item = readSaved()[Number(savedSelect.value)];
      if (item) load(item.spec);
    });
    async function send() {
      let s;
      try {
        s = spec();
        if (!s.url) throw new Error("Enter a URL.");
      } catch (error) {
        ctx.status(errorMessage(error), true);
        return;
      }
      if (/^\/api\/v1\//.test(s.url)) {
        ctx.status("Note: /api/v1/ on the project origin is reserved for the platform, not server.js.");
      }
      sendBtn.disabled = true;
      statusLine.replaceChildren(h("span", { class: "muted", text: "Sending…" }));
      respHeaders.textContent = "";
      respBody.textContent = "";
      const started = performance.now();
      try {
        const res = await ctx.wait(
          fetch(s.url, { method: s.method, headers: s.headers, body: s.body, signal: ctx.signal, credentials: "same-origin" }),
          6e4
        );
        const text = s.method === "HEAD" ? "" : await ctx.wait(res.text(), 6e4);
        if (ctx.stopped()) return;
        const ms = Math.round(performance.now() - started);
        statusLine.replaceChildren(
          h("span", { class: "badge " + (res.ok ? "good" : "bad"), text: `${res.status} ${res.statusText}` }),
          h("span", { class: "muted", text: `${ms} ms · ${text.length.toLocaleString()} chars` }),
          h("button", { type: "button", text: "Copy body", onclick: () => void copyText(text) }),
          h("button", { type: "button", text: "Copy as fetch", onclick: () => void copyText(asFetch(s)) })
        );
        const hs = {};
        res.headers.forEach((v, k) => hs[k] = v);
        respHeaders.textContent = pretty(hs);
        const parsed = tryParse(text);
        respBody.textContent = typeof parsed === "string" ? parsed : pretty(parsed);
        ctx.status(`${s.method} ${s.url} → ${res.status} in ${ms} ms`, !res.ok);
      } catch (error) {
        if (ctx.stopped()) return;
        statusLine.replaceChildren(h("span", { class: "badge bad", text: "Failed" }));
        respBody.textContent = errorMessage(error);
        ctx.status("Request failed: " + errorMessage(error), true);
      } finally {
        sendBtn.disabled = false;
      }
    }
    root.append(
      h(
        "div",
        { class: "split api" },
        h(
          "div",
          { class: "api-req scroll pad stack" },
          h("div", { class: "row" }, method, url, sendBtn),
          h(
            "div",
            { class: "row" },
            savedSelect,
            h("button", {
              type: "button",
              text: "Save",
              onclick: () => {
                const name = prompt("Name for this request", url.value);
                if (!name) return;
                const list = readSaved().filter((x) => x.name !== name);
                list.push({ name, spec: spec() });
                writeSaved(list);
                refreshSaved();
                ctx.status("Saved “" + name + "” in this project’s localStorage.");
              }
            }),
            h("button", {
              type: "button",
              class: "danger",
              text: "Delete",
              onclick: () => {
                const list = readSaved();
                const i = Number(savedSelect.value);
                if (savedSelect.value === "" || !list[i]) return;
                list.splice(i, 1);
                writeSaved(list);
                refreshSaved();
              }
            })
          ),
          h("label", { class: "field" }, "Headers", headers),
          h("label", { class: "field" }, "Body", body),
          h(
            "p",
            { class: "hint" },
            "Requests run from this frame, so /api/* reaches the project’s server.js with your real x-websim-* identity headers (set by the platform; they can’t be forged here)."
          )
        ),
        h(
          "div",
          { class: "api-resp split-v" },
          h("div", { class: "pad" }, statusLine),
          h("details", { class: "pad-x" }, h("summary", { text: "Response headers" }), respHeaders),
          h("div", { class: "scroll pad" }, respBody)
        )
      )
    );
    refreshSaved();
    return { load };
  }
  function routesView(ctx, root, open2) {
    const routes = /* @__PURE__ */ new Map();
    const tbody = h("tbody");
    const info = h("span", { class: "muted" });
    const scanBtn = h("button", { type: "button", class: "primary", text: "Scan source", onclick: () => void scan() });
    function addRoute(method, path, where) {
      const key = method + " " + path;
      let r = routes.get(key);
      if (!r) routes.set(key, r = { method, path, where: /* @__PURE__ */ new Set() });
      r.where.add(where);
    }
    function render() {
      tbody.replaceChildren(
        ...[...routes.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)).map(
          (r) => h(
            "tr",
            { tabIndex: 0, onclick: () => open2({ method: r.method, url: r.path, headers: {} }) },
            h("td", { text: r.method }),
            h("td", { text: r.path, title: r.path }),
            h("td", { class: "muted", text: [...r.where].join(", ") })
          )
        )
      );
      info.textContent = routes.size + " routes";
    }
    function scanText(text, url) {
      const file = url.split("/").pop() || url;
      const isServer = /\/server\.js(\?|$)/.test(url);
      for (const m of text.matchAll(/(['"`])(\/api\/[^'"`\s]*)\1/g)) {
        const path = m[2];
        if (!path || path.startsWith("/api/v1/")) continue;
        const i = m.index ?? 0;
        const start = Math.max(
          text.lastIndexOf("\n", i) + 1,
          text.lastIndexOf("if", i),
          text.lastIndexOf(";", i) + 1,
          text.lastIndexOf("{", i) + 1,
          text.lastIndexOf("}", i) + 1
        );
        const after = text.slice(i + m[0].length, i + 300);
        const [tail = "", block = ""] = after.split("{");
        const statement = text.slice(start, i) + tail;
        const serverCheck = /method\s*={2,3}\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i;
        const method = isServer ? (serverCheck.exec(statement) ?? serverCheck.exec(block.split(/\bpathname\b|\}/)[0] ?? ""))?.[1] : /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i.exec(after.split(/\bfetch\s*\(/)[0] ?? "")?.[1];
        addRoute((method ?? "GET").toUpperCase(), path, isServer ? "server.js" : file);
      }
    }
    async function scan() {
      scanBtn.disabled = true;
      ctx.status("Scanning server.js and page source for /api routes…");
      try {
        const summary = await crawlSources({
          signal: ctx.signal,
          stopped: ctx.stopped,
          onText: scanText,
          progress: render,
          extra: ["/server.js"]
        });
        render();
        ctx.status(`${routes.size} routes · ${summary}`);
      } catch (error) {
        ctx.status("Route scan failed: " + errorMessage(error), true);
      } finally {
        scanBtn.disabled = false;
      }
    }
    root.append(
      h("div", { class: "pad stack" }, h("div", { class: "row" }, scanBtn, info)),
      h(
        "div",
        { class: "scroll" },
        h("table", { class: "grid" }, h("thead", {}, h("tr", {}, h("th", { text: "Method" }), h("th", { text: "Path" }), h("th", { text: "Found in" }))), tbody)
      )
    );
    void scan();
  }
  function presetsView(ctx, root, open2) {
    const filter = h("input", { class: "grow", placeholder: "Filter presets", "aria-label": "Filter presets" });
    const list = h("div", { class: "scroll presets" });
    const vars = h("span", { class: "muted" });
    let values = {};
    function render() {
      const term = filter.value.toLowerCase();
      const groups = /* @__PURE__ */ new Map();
      for (const p of PRESETS) {
        if (term && !`${p.group} ${p.name} ${p.url}`.toLowerCase().includes(term)) continue;
        const g = groups.get(p.group) ?? [];
        g.push(p);
        groups.set(p.group, g);
      }
      list.replaceChildren(
        ...[...groups].map(
          ([group, items]) => h(
            "section",
            {},
            h("h4", { text: group }),
            items.map((p) => {
              const { spec, missing } = fillPreset(p, values);
              return h(
                "button",
                {
                  type: "button",
                  class: "preset",
                  title: spec.url,
                  onclick: () => {
                    open2(spec);
                    ctx.status(
                      missing.length ? `Loaded “${p.name}”. Replace {${missing.join("}, {")}} in the URL before sending.` : `Loaded “${p.name}”. Press Send.`,
                      missing.length > 0
                    );
                  }
                },
                h("span", { class: "m", text: p.method }),
                h("span", { class: "n", text: p.name }),
                h("span", { class: "u", text: spec.url.replace("https://websim.com/api/v1", "…/v1") }),
                p.note ? h("span", { class: "note", text: p.note }) : null
              );
            })
          )
        )
      );
      if (!groups.size) list.append(h("div", { class: "empty", text: "No presets match." }));
    }
    filter.addEventListener("input", render);
    root.append(h("div", { class: "row pad" }, filter, vars), list);
    render();
    void presetVars().then((v) => {
      if (ctx.stopped()) return;
      values = v;
      const known = Object.entries(v).filter(([k]) => !k.endsWith("_id")).map(([k, val]) => `${k}=${val}`);
      vars.textContent = known.length ? "Filled in: " + known.join(", ") : "Couldn’t read creator/viewer/project; placeholders stay as {name}.";
      render();
    });
  }

  // src/tools/comments/index.ts
  var commentsTool = {
    id: "comments",
    label: "Comments",
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
      const browse = h("div");
      const live = h("div");
      const post = h("div");
      const composer = postView(ctx, post);
      const select = subtabs(ctx.pane, [
        {
          id: "browse",
          label: "Browse",
          el: browse,
          init: () => browseView(ctx, browse, (id) => {
            composer.replyTo(id);
            select("post");
          })
        },
        {
          id: "live",
          label: "Live events",
          el: live,
          init: () => live.append(
            logView({
              channel: hub.comments,
              signal: ctx.signal,
              tagLabel: "Author",
              empty: "comment:created events appear here as they happen (recorded since the page loaded)."
            }).el
          )
        },
        { id: "post", label: "Post", el: post }
      ]);
    }
  };
  function emojiName(e) {
    return typeof e === "string" ? e : String(e?.name ?? "?");
  }
  function browseView(ctx, root, reply) {
    const first = h("input", { type: "number", value: 20, min: 1, max: 100, title: "first" });
    const sort = h("select", {}, h("option", { value: "", text: "Newest" }), h("option", { value: "best", text: "Best" }));
    const q = h("input", { placeholder: "Search text", class: "grow" });
    const author = h("input", { placeholder: "author_username", style: "width:120px" });
    const tips = h("input", { type: "checkbox" });
    const video = h("input", { type: "checkbox" });
    const replies = h("input", { type: "number", value: 0, min: 0, max: 10, title: "include_replies" });
    const list = h("div", { class: "c-list scroll" });
    const more = h("button", { type: "button", text: "Load more", hidden: true });
    const count = h("span", { class: "muted" });
    let page = null;
    function item(c, nested = false) {
      const tip = c.card_data?.type === "tip_comment" ? h("span", { class: "badge good", text: `tip ${c.card_data.credits_spent ?? ""}` }) : null;
      const raw = h("div", { hidden: true }, jsonBlock(c));
      const reactions = (c.reactions ?? []).map(
        (r) => h("span", { class: "badge" + (r.me ? " good" : ""), text: `${emojiName(r.emoji)} ${r.count ?? ""}` })
      );
      const react = (emoji) => h("button", {
        type: "button",
        text: emoji === "+1" ? "▲" : emoji === "-1" ? "▼" : emoji,
        title: `reactToComment ${emoji} (consumes this click)`,
        onclick: async () => {
          try {
            const mine = (c.reactions ?? []).some((r) => emojiName(r.emoji) === emoji && r.me);
            const res = await requireWebsim("reactToComment")({ comment_id: c.id, emoji, remove: mine });
            if (res.error) throw new Error(String(res.error));
            ctx.status(`${mine ? "Removed" : "Added"} ${emoji} on ${c.id}`);
            if (res.comment) el.replaceWith(item(res.comment, nested));
          } catch (error) {
            ctx.status("React failed: " + errorMessage(error), true);
          }
        }
      });
      const el = h(
        "div",
        { class: "c-item" + (nested ? " reply" : "") },
        h(
          "div",
          { class: "head" },
          avatar(c.author?.username),
          h("strong", { text: c.author?.username ?? "?" }),
          h("span", { class: "muted", text: c.created_at ? new Date(c.created_at).toLocaleString() : "" }),
          tip,
          h("span", { class: "muted", text: c.id ?? "" })
        ),
        h("div", { class: "body", text: c.raw_content ?? "" }),
        h(
          "div",
          { class: "acts" },
          ...reactions,
          react("+1"),
          react("-1"),
          react("heart"),
          h("button", { type: "button", text: "Reply", onclick: () => c.id && reply(c.id) }),
          h("button", { type: "button", text: "Raw", onclick: () => raw.hidden = !raw.hidden }),
          c.reply_count ? h("span", { class: "muted", text: `${c.reply_count} replies` }) : null
        ),
        raw
      );
      const nestedPage = c.replies?.comments;
      if (nestedPage) for (const r of nestedPage) el.append(item(r, true));
      return el;
    }
    function show(p, append2) {
      page = p;
      if (!append2) list.replaceChildren();
      for (const c of p.comments ?? []) list.append(item(c));
      if (!list.childElementCount) list.append(h("div", { class: "empty", text: "No comments match." }));
      more.hidden = !p.next;
      count.textContent = (p.count != null ? `${p.count} total · ` : "") + `${list.querySelectorAll(":scope > .c-item").length} loaded`;
    }
    async function load() {
      const params = { first: Number(first.value) || 20, include_count: true };
      if (sort.value) params.sort_by = sort.value;
      if (q.value.trim()) params.q = q.value.trim();
      if (author.value.trim()) params.author_username = author.value.trim();
      if (tips.checked) params.only_tips = true;
      if (video.checked) params.only_video = true;
      if (Number(replies.value)) params.include_replies = Number(replies.value);
      list.replaceChildren(h("div", { class: "empty", text: "Loading…" }));
      try {
        show(await ctx.wait(requireWebsim("getComments")(params)), false);
      } catch (error) {
        list.replaceChildren(h("div", { class: "empty error-text", text: errorMessage(error) }));
        ctx.status("getComments failed: " + errorMessage(error), true);
      }
    }
    more.addEventListener("click", async () => {
      if (!page?.next) return;
      more.disabled = true;
      try {
        show(await ctx.wait(page.next()), true);
      } catch (error) {
        ctx.status("Next page failed: " + errorMessage(error), true);
      } finally {
        more.disabled = false;
      }
    });
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void load();
    });
    root.append(
      h(
        "div",
        { class: "row pad c-filters" },
        q,
        author,
        sort,
        h("label", { class: "check" }, tips, "tips"),
        h("label", { class: "check" }, video, "video"),
        h("label", { class: "check", title: "include_replies" }, "replies", replies),
        h("label", { class: "check", title: "first" }, "page", first),
        h("button", { type: "button", class: "primary", text: "Load", onclick: () => void load() }),
        count
      ),
      list,
      h("div", { class: "row pad" }, more)
    );
    void load();
  }
  function postView(ctx, root) {
    const content = h("textarea", { class: "code", rows: 4, placeholder: "Comment text (markdown links allowed)" });
    const images = h("textarea", { class: "code", rows: 2, placeholder: "Image/video URLs, one per line (max 4)" });
    const parent = h("input", { class: "code", placeholder: "parent_comment_id (reply)" });
    const credits = h("input", { type: "number", min: 0, placeholder: "credits (tip)", style: "width:110px" });
    const art = h("input", { type: "checkbox" });
    const result = h("div");
    const go = h("button", {
      type: "button",
      class: "primary",
      text: "Post to comments",
      onclick: async () => {
        const opts = { content: content.value };
        const urls = images.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 4);
        if (urls.length) opts.images = urls;
        if (parent.value.trim()) opts.parent_comment_id = parent.value.trim();
        if (Number(credits.value)) opts.credits = Number(credits.value);
        if (art.checked) opts.data = { type: "project_board_post", kind: "art", status: "art" };
        go.disabled = true;
        try {
          const res = await requireWebsim("postComment")(opts);
          if (res.error) throw new Error(String(res.error));
          result.replaceChildren(jsonBlock(res));
          ctx.status(opts.credits ? "Tip composer opened; the comment exists once you press Post there." : "Comment posted.");
          if (!opts.credits) content.value = "";
        } catch (error) {
          result.replaceChildren(h("div", { class: "error-text", text: errorMessage(error) }));
          ctx.status("postComment failed: " + errorMessage(error), true);
        } finally {
          go.disabled = false;
        }
      }
    });
    root.append(
      h(
        "div",
        { class: "scroll pad stack" },
        h("p", { class: "hint", text: "Posts publicly as you, immediately, with the “App” badge. Tips open websim’s own composer to confirm the spend." }),
        h("label", { class: "field" }, "Content", content),
        h("label", { class: "field" }, "Images", images),
        h("div", { class: "row" }, h("div", { class: "grow" }, parent), credits, h("label", { class: "check" }, art, "fan art")),
        h("div", { class: "row" }, go),
        result
      )
    );
    return {
      replyTo(id) {
        parent.value = id;
        content.focus();
      }
    };
  }

  // src/tools/console/index.ts
  var AsyncFunction = Object.getPrototypeOf(async function() {
  }).constructor;
  var consoleTool = {
    id: "console",
    label: "Console",
    css: `
.con-input { border-top: 1px solid #303841; flex-wrap: nowrap; align-items: stretch; }
.con-input textarea { resize: none; }
`,
    mount(ctx) {
      const input = h("textarea", {
        class: "code grow",
        rows: 2,
        placeholder: "JavaScript in the project frame (Enter runs, Shift+Enter newline). await works.",
        spellcheck: false
      });
      const history = [];
      let cursor = 0;
      async function run() {
        const code = input.value;
        if (!code.trim()) return;
        history.push(code);
        cursor = history.length;
        input.value = "";
        hub.console.push({ tag: "eval", level: "debug", summary: "› " + code.replace(/\s+/g, " "), detail: code });
        try {
          let result;
          try {
            result = await new AsyncFunction(`return (${code}
)`)();
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            result = await new AsyncFunction(code)();
          }
          hub.console.push({ tag: "eval", level: "info", summary: "‹ " + preview(result, 400), detail: result });
        } catch (error) {
          const blocked = error instanceof EvalError || /unsafe-eval|Content Security Policy/i.test(String(error));
          hub.console.push({
            tag: "eval",
            level: "error",
            summary: "‹ " + (blocked ? "Blocked by the page’s Content-Security-Policy (no eval)." : preview(error instanceof Error ? `${error.name}: ${error.message}` : error, 400)),
            detail: error
          });
        }
      }
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void run();
        } else if (e.key === "ArrowUp" && !input.value.includes("\n") && cursor > 0) {
          e.preventDefault();
          input.value = history[--cursor] ?? "";
        } else if (e.key === "ArrowDown" && !input.value.includes("\n") && cursor < history.length) {
          e.preventDefault();
          input.value = history[++cursor] ?? "";
        }
      });
      ctx.pane.append(
        logView({
          channel: hub.console,
          signal: ctx.signal,
          levels: ["log", "info", "warn", "error", "debug"],
          tagLabel: "Source",
          empty: "console.* output, uncaught errors and unhandled rejections from the project frame appear here, recorded since page load."
        }).el,
        h("div", { class: "row pad con-input" }, input, h("button", { type: "button", class: "primary", text: "Run", onclick: () => void run() }))
      );
    }
  };

  // src/tools/database/database.css
  var database_default = ".pane.db { flex-direction: row; }\n.db .side {\n  width: 150px;\n  min-width: 105px;\n  max-width: 30%;\n  display: flex;\n  flex-direction: column;\n  border-right: 1px solid #38414b;\n}\n.db .names { flex: 1; overflow: auto; padding: 4px; }\n.db .names button {\n  display: block;\n  width: 100%;\n  text-align: left;\n  background: transparent;\n  border: 0;\n  border-radius: 2px;\n  padding: 5px 7px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.db .names button.active { background: #3c4c37; color: #d6e8cb; }\n.db .names button:hover { background: #313c44; }\n.db .manual { display: flex; margin: 5px; gap: 3px; }\n.db .manual input {\n  width: 0;\n  flex: 1;\n  background: #15191e;\n  border: 1px solid #424a53;\n  padding: 4px;\n  font: 11px monospace;\n  min-width: 0;\n}\n.db .manual button { padding: 3px 6px; }\n\n.db .view { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }\n.db .tools { display: flex; gap: 8px; align-items: center; padding: 6px; border-bottom: 1px solid #38414b; }\n.db .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; font-weight: 600; }\n.db .filter {\n  min-width: 30px;\n  width: 120px;\n  margin-left: auto;\n  background: #15191e;\n  border: 1px solid #424a53;\n  padding: 4px;\n  font-size: 11px;\n}\n.db .records { flex: 1; overflow: auto; }\n.db .empty { white-space: pre-wrap; color: #9ca8b3; padding: 12px; font-size: 11px; line-height: 1.6; }\n\n.db table {\n  border-collapse: collapse;\n  white-space: nowrap;\n  min-width: 100%;\n  font: 11px/1.5 ui-monospace, monospace;\n  text-align: left;\n}\n.db th { position: sticky; top: 0; background: #29313a; color: #aab6c3; font-weight: 400; }\n.db th, .db td {\n  padding: 6px 9px;\n  border-bottom: 1px solid #303841;\n  max-width: 300px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.db tbody tr { cursor: pointer; }\n.db tbody tr:hover { background: #29362b; }\n.db td { color: #c4d2bd; }\n\n.db .panel {\n  position: absolute;\n  inset: 0;\n  background: #1c2025;\n  display: flex;\n  flex-direction: column;\n  padding: 8px;\n  gap: 7px;\n}\n.db .panel-head { display: flex; gap: 8px; align-items: center; }\n.db .panel-head strong { margin-right: auto; font-size: 12px; }\n.db .panel textarea {\n  background: #14191d;\n  border: 1px solid #424a53;\n  padding: 9px;\n  font: 11px/1.5 ui-monospace, monospace;\n  flex: 1;\n  resize: none;\n  min-height: 0;\n  white-space: pre;\n}\n.db .panel pre {\n  margin: 0;\n  white-space: pre-wrap;\n  overflow: auto;\n  flex: 1;\n  color: #c4d2bd;\n  font: 11px/1.6 ui-monospace, monospace;\n}\n.db .entry-status { font-size: 11px; white-space: pre-wrap; color: #f0b3a9; }\n.db .save { align-self: flex-end; background: #3c4c37; color: #d6e8cb; }\n.db .hint { font-size: 10px; color: #9ca8b3; }\n.page { white-space: nowrap; color: #929faa; }\n\n@media (max-width: 500px) {\n  .db .side { width: 110px; }\n  .db .filter { width: 70px; }\n}\n";

  // src/tools/database/source-scan.ts
  function scanCollections(text, add) {
    const constants = new Map(
      [...text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(['"`])([^'"`\r\n]+)\2/g)].map((m) => [m[1], m[3]])
    );
    for (const m of text.matchAll(/\.collection\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*\)/g)) {
      const name = m[2];
      if (name && !name.includes("${")) add(name, "source");
    }
    for (const m of text.matchAll(/\.collection\s*\(\s*([\w$]+)\s*\)/g)) {
      const value = constants.get(m[1]);
      if (value) add(value, "source");
    }
    for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
      if (m[1]) add(m[1], "SQL source");
    }
  }

  // src/tools/database/template.ts
  var METADATA = /* @__PURE__ */ new Set(["id", "$type", "user_id", "username", "created_at", "updated_at"]);
  function template(value) {
    if (Array.isArray(value)) return value.length ? [template(value[0])] : [];
    if (value === null) return null;
    if (typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, template(v)]));
    }
    if (typeof value === "string") return "";
    if (typeof value === "number") return 0;
    if (typeof value === "boolean") return false;
    return null;
  }
  function entryTemplate(sample) {
    const fields = sample ? Object.fromEntries(Object.entries(sample).filter(([key]) => !METADATA.has(key))) : {};
    return template(fields);
  }

  // src/tools/database/index.ts
  var PAGE_SIZE = 100;
  var NO_ROOM = "No room. The page has no database room (room.collection) yet, and WbSmUtil does not create one. Scan again once the page has joined.";
  var SCAN_PAGE = 1e3;
  var SCAN_MAX_OFFSET = 1e4;
  var ACTIONS = `
<button class="scan" title="Discover collections from records, schema and project source">Scan</button>
<button class="refresh">Refresh</button>
<button class="new">+ Entry</button>`;
  var PANE = `
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
  var FOOT = `
<span class="page"></span>
<button class="prev" aria-label="Previous page">‹</button>
<button class="next" aria-label="Next page">›</button>`;
  var databaseTool = {
    id: "database",
    label: "Database",
    css: database_default,
    mount
  };
  async function mount(ctx) {
    const { $, on, wait, status, stopped } = ctx;
    ctx.pane.classList.add("db");
    ctx.pane.innerHTML = PANE;
    ctx.actions.innerHTML = ACTIONS;
    ctx.foot.innerHTML = FOOT;
    let db = null;
    let current = "";
    let offset = 0;
    let records = [];
    let loadId = 0;
    let scanning = false;
    let saving = false;
    const names = /* @__PURE__ */ new Set();
    const origins = /* @__PURE__ */ new Map();
    const samples = /* @__PURE__ */ new Map();
    const recordsEl = $(".records");
    const filter = $(".filter");
    const manualInput = $(".manual input");
    const editor = $(".editor");
    const textarea = $(".editor textarea");
    const detail = $(".detail");
    const pageEl = $(".page");
    function message(text) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = text;
      recordsEl.replaceChildren(p);
    }
    function add(name, source) {
      if (typeof name !== "string" || !name.trim()) return;
      names.add(name);
      let set = origins.get(name);
      if (!set) origins.set(name, set = /* @__PURE__ */ new Set());
      set.add(source);
    }
    function sidebar() {
      const frag = document.createDocumentFragment();
      for (const name of [...names].sort()) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = name;
        b.dataset.name = name;
        b.title = [...origins.get(name) ?? []].join(", ");
        b.className = name === current ? "active" : "";
        frag.append(b);
      }
      $(".names").replaceChildren(frag);
    }
    on($(".names"), "click", (e) => {
      const b = e.target.closest("button[data-name]");
      if (b?.dataset.name) select(b.dataset.name);
    });
    function render() {
      const search = filter.value.toLowerCase();
      const list = records.filter((r) => JSON.stringify(r).toLowerCase().includes(search));
      pageEl.textContent = records.length ? offset + 1 + "–" + (offset + records.length) : "0";
      if (!list.length) {
        message(search ? "No matching records on this page." : "No records returned.");
        return;
      }
      const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const header = document.createElement("tr");
      for (const key of columns) {
        const th = document.createElement("th");
        th.textContent = key;
        header.append(th);
      }
      thead.append(header);
      table.append(thead);
      const body = document.createElement("tbody");
      for (const record of list) {
        const index = records.indexOf(record);
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.dataset.record = String(index);
        tr.setAttribute("aria-label", "Inspect record " + (record.id ?? index));
        for (const key of columns) {
          const td = document.createElement("td");
          const value = record[key];
          td.textContent = value === void 0 ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
          td.title = td.textContent;
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      recordsEl.replaceChildren(table);
    }
    function inspect(e) {
      const row = e.target.closest("tr[data-record]");
      if (!row) return;
      const record = records[Number(row.dataset.record)];
      if (!record) return;
      samples.set(current, record);
      $(".detail pre").textContent = JSON.stringify(record, null, 2);
      detail.hidden = false;
    }
    on(recordsEl, "click", inspect);
    on(recordsEl, "keydown", (e) => {
      if (e.key === "Enter") inspect(e);
    });
    on($(".back"), "click", () => detail.hidden = true);
    async function read(name, skip, size) {
      db ??= findSocket();
      if (!db) throw new Error(NO_ROOM);
      if (typeof db.getDatabaseRecords === "function") {
        return wait(db.getDatabaseRecords(name === null ? {} : { $type: name }, { limit: size, offset: skip }));
      }
      if (name === null) throw new Error("This socket has no all-records reader. Scanning project source instead.");
      let query = db.collection(name);
      const limited = typeof query.limit === "function";
      if (query.limit) query = query.limit(size);
      if (query.offset) query = query.offset(skip);
      else if (skip) throw new Error("This socket does not support pagination.");
      const rows = await wait(query.getList());
      return limited ? rows : rows.slice(0, size);
    }
    async function load() {
      if (stopped()) return;
      if (!current) {
        status("Select a collection, or enter its name.");
        return;
      }
      const id = ++loadId;
      const target = current;
      status("Reading " + target + "…");
      message("Loading…");
      try {
        const result = await read(target, offset, PAGE_SIZE);
        if (stopped() || id !== loadId) return;
        if (!Array.isArray(result)) throw new Error("Websim returned a non-array response.");
        records = result;
        const first = records[0];
        if (first && !samples.has(target)) samples.set(target, first);
        render();
        status(target + " · " + records.length + " records on this page");
      } catch (error) {
        if (stopped() || id !== loadId) return;
        records = [];
        pageEl.textContent = "";
        message(errorMessage(error));
        status("Read failed: " + errorMessage(error), true);
      }
    }
    function select(name) {
      current = name;
      offset = 0;
      $(".name").textContent = name;
      filter.value = "";
      editor.hidden = true;
      detail.hidden = true;
      sidebar();
      void load();
    }
    on($(".manual"), "submit", (e) => {
      e.preventDefault();
      const name = manualInput.value.trim();
      if (!name) return;
      add(name, "manual");
      manualInput.value = "";
      select(name);
    });
    on($(".refresh"), "click", () => void load());
    on(filter, "input", render);
    on($(".prev"), "click", () => {
      offset = Math.max(0, offset - PAGE_SIZE);
      void load();
    });
    on($(".next"), "click", () => {
      if (records.length < PAGE_SIZE) {
        status("End of returned records.");
        return;
      }
      offset += PAGE_SIZE;
      void load();
    });
    function newEntry() {
      if (!current) {
        manualInput.focus();
        status("Enter or select the destination collection.");
        return;
      }
      const sample = samples.get(current);
      textarea.value = JSON.stringify(entryTemplate(sample), null, 2);
      $(".editor .hint").textContent = sample ? "Template inferred from " + (sample.id ?? "a record") + ". Metadata omitted; review before creating." : "No record available to infer a template. Enter a JSON object.";
      $(".editor strong").textContent = "New entry / " + current;
      $(".entry-status").textContent = "";
      detail.hidden = true;
      editor.hidden = false;
      textarea.focus();
    }
    on($(".new"), "click", newEntry);
    on($(".use-template"), "click", newEntry);
    on($(".cancel"), "click", () => editor.hidden = true);
    on(editor, "submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      const target = current;
      const save = $(".save");
      try {
        const value = JSON.parse(textarea.value);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Entry must be a JSON object.");
        db ??= findSocket();
        if (!db) throw new Error(NO_ROOM);
        saving = true;
        save.textContent = "Creating…";
        $(".entry-status").textContent = "";
        const created = await wait(db.collection(target).create(value));
        if (stopped()) return;
        if (current === target) {
          editor.hidden = true;
          offset = 0;
          await load();
        }
        if (!stopped()) status("Created " + (created?.id ?? "entry") + " in " + target);
      } catch (error) {
        if (!stopped()) {
          $(".entry-status").textContent = errorMessage(error);
          status("Create failed: " + errorMessage(error), true);
        }
      } finally {
        saving = false;
        if (!stopped()) save.textContent = "Create";
      }
    });
    function addSchemaNames() {
      if (db?.schema && typeof db.schema === "object") for (const name of Object.keys(db.schema)) add(name, "socket schema");
    }
    async function scan() {
      if (stopped() || scanning) return;
      scanning = true;
      const button = $(".scan");
      button.textContent = "Scanning…";
      status("Scanning schema, records and project source…");
      let databaseError = "";
      let total = 0;
      let capped = false;
      try {
        addSchemaNames();
        sidebar();
        const sources = crawlSources({
          signal: ctx.signal,
          stopped,
          onText: (text) => scanCollections(text, add),
          progress: sidebar
        });
        db ??= findSocket();
        if (db) {
          try {
            for (let skip = 0; skip <= SCAN_MAX_OFFSET && !stopped(); skip += SCAN_PAGE) {
              const rows = await read(null, skip, SCAN_PAGE);
              if (stopped()) return;
              if (!Array.isArray(rows)) throw new Error("All-records reader returned a non-array response.");
              total += rows.length;
              for (const row of rows) {
                const name = row.$type ?? row.type;
                add(name, "database records");
                if (typeof name === "string" && !samples.has(name)) samples.set(name, row);
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
        const summary = names.size + " collections · " + total + " records scanned" + (capped ? ` (${(SCAN_MAX_OFFSET + SCAN_PAGE).toLocaleString("en-US")}-record limit)` : "") + " · " + sourceSummary + (databaseError ? " · Database scan: " + databaseError : "");
        const firstName = [...names].sort()[0];
        if (!current && firstName) select(firstName);
        else if (!current) {
          message(
            "No collections discovered.\n" + (databaseError || "No typed records or static collection references found.") + "\nDynamic or unreferenced empty collections may not be discoverable. Enter a name to read one directly.\nPrivate server.js databases require an endpoint provided by that project."
          );
        }
        status(summary, Boolean(databaseError));
      } catch (error) {
        if (!stopped()) status("Scan failed: " + errorMessage(error), true);
      } finally {
        scanning = false;
        if (!stopped()) button.textContent = "Scan";
      }
    }
    on($(".scan"), "click", () => void scan());
    try {
      db = findSocket();
      if (db && typeof db.initialize === "function") await wait(db.initialize(), 15e3);
    } catch (error) {
      if (!stopped()) status("Socket initialization: " + errorMessage(error), true);
    }
    if (!stopped()) await scan();
  }

  // src/changelog.ts
  var CHANGELOG = [
    {
      version: "0.4.4",
      date: "2026-11-16",
      changes: ["New logo, also used as the userscript icon in your userscript manager."]
    },
    {
      version: "0.4.3",
      date: "2026-11-16",
      changes: [
        "Fixed the API Traffic log going quiet after page load: websim replaces window.fetch, which bypassed the hook. Later replacements are now wrapped too, and each request is still logged once.",
        "New docs and demo site: https://1stwbsm.github.io/WbSmUtil/"
      ]
    },
    {
      version: "0.4.2",
      date: "2026-11-16",
      changes: [
        "API tab: new Presets list with 21 ready-made requests (this project, creator, you, comments). Creator, viewer and project IDs are filled in automatically.",
        "API tab: the websim API buttons moved from Routes into Presets.",
        "Project tab: when you’re viewing your own project, the viewer and creator cards merge into one."
      ]
    },
    {
      version: "0.4.1",
      date: "2026-11-16",
      changes: ["New Home tab with this changelog. The window now opens here instead of on Database."]
    },
    {
      version: "0.4.0",
      date: "2026-11-16",
      changes: [
        "Fixed WbSmUtil not running at all in Firefox/Violentmonkey: websim’s Content-Security-Policy blocked the injection.",
        "It now falls back to a content script and re-injects itself with the page’s script nonce."
      ]
    },
    {
      version: "0.3.0",
      date: "2026-11-16",
      changes: [
        "Hotkey changed from Alt+Shift+D to Ctrl+Backtick (Alt combos clash with Firefox and Linux desktops).",
        "Each frame logs a “[WbSmUtil] loaded in …” console line."
      ]
    },
    {
      version: "0.2.0",
      date: "2026-11-16",
      changes: [
        "Renamed from Pocket DB to WbSmUtil.",
        "Runs inside the project iframe; the websim.com page forwards the hotkey, and “Move into project frame” moves the window there.",
        "New tabs: API, Multiplayer, AI, Comments, Project, Console, Storage.",
        "Hooks start at page load, so logs include what the project did before you opened the panel.",
        "The Database tab only uses an existing room and never creates one."
      ]
    },
    {
      version: "Pocket DB",
      date: "2026-11-15",
      changes: ["The original websim database inspector, rewritten in TypeScript as a userscript."]
    }
  ];

  // src/tools/home/index.ts
  var SHORTCUTS = [
    ["database", "Database", "Legacy room.collection() data"],
    ["api", "API", "Call /api routes, see traffic"],
    ["multiplayer", "Multiplayer", "Sniff and send room packets"],
    ["ai", "AI", "AI call monitor and playgrounds"],
    ["comments", "Comments", "Browse, live events, post"],
    ["project", "Project", "Identity, hooks, users API"],
    ["console", "Console", "Logs, errors, run JS"],
    ["storage", "Storage", "localStorage, IndexedDB, cookies"]
  ];
  var homeTool = {
    id: "home",
    label: "Home",
    css: `
.home { gap: 12px; }
.home-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.home-head h2 { margin: 0; font-size: 18px; color: #eef0f3; }
.home-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.home-cards button { text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; white-space: normal; }
.home-cards button strong { color: #eef0f3; font-weight: 600; }
.home-cards button span { font-size: 10px; color: #8c98a4; }
.home-status { display: flex; gap: 6px; flex-wrap: wrap; }
.release { border-left: 2px solid #38414b; padding: 2px 0 2px 10px; }
.release:first-child { border-left-color: #6f8f62; }
.release h3 { margin: 0 0 3px; font-size: 12px; color: #eef0f3; display: flex; gap: 8px; align-items: baseline; }
.release h3 .muted { font-weight: 400; font-size: 10px; }
.release ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 2px; }
kbd { font: 11px ui-monospace, monospace; background: #2a3037; border: 1px solid #424a53; border-bottom-width: 2px; border-radius: 3px; padding: 0 5px; }
`,
    mount(ctx) {
      const ws = getWebsim();
      const hasSocket = typeof window.WebsimSocket === "function";
      const badge = (ok, text) => h("span", { class: "badge " + (ok ? "good" : "bad"), text });
      ctx.pane.append(
        h(
          "div",
          { class: "scroll pad stack home" },
          h(
            "div",
            { class: "home-head" },
            h("h2", { text: "WbSmUtil" }),
            h("span", { class: "badge", text: "v0.4.4" }),
            h("span", { class: "muted" }, "Toggle with ", h("kbd", { text: HOTKEY.label }), " · ", location.host)
          ),
          h(
            "div",
            { class: "home-status" },
            badge(!!ws, ws ? "websim API" : "no websim API"),
            badge(hasSocket, hasSocket ? "WebsimSocket" : "no WebsimSocket"),
            badge(hub.rooms.list.length > 0, hub.rooms.list.length ? `${hub.rooms.list.length} room(s)` : "no room"),
            badge(window !== window.top, window !== window.top ? "in project frame" : "top level")
          ),
          h(
            "div",
            { class: "home-cards" },
            SHORTCUTS.map(
              ([id, label, desc]) => h("button", { type: "button", onclick: () => ctx.open(id) }, h("strong", { text: label }), h("span", { text: desc }))
            )
          ),
          h(
            "fieldset",
            {},
            h("legend", { text: "Changelog" }),
            CHANGELOG.map(
              (r) => h(
                "div",
                { class: "release" },
                h("h3", {}, r.version, h("span", { class: "muted", text: r.date })),
                h("ul", {}, r.changes.map((c) => h("li", { text: c })))
              )
            )
          ),
          h(
            "p",
            { class: "hint" },
            "Source and issues: ",
            h("a", { href: "https://github.com/1stwbsm/WbSmUtil", target: "_blank", rel: "noopener", text: "github.com/1stwbsm/WbSmUtil" })
          )
        )
      );
      ctx.status(`WbSmUtil v${"0.4.4"} ready.`);
    }
  };

  // src/tools/multiplayer/index.ts
  var multiplayerTool = {
    id: "multiplayer",
    label: "Multiplayer",
    css: `
.mp-top { border-bottom: 1px solid #303841; }
.mp-composer { border-top: 1px solid #303841; align-items: stretch; flex-wrap: nowrap; }
.mp-composer textarea { resize: none; }
.mp-state { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.mp-state .box { max-height: 260px; }
.mp-state h4 { margin: 0 0 4px; font-size: 11px; color: #aab6c3; font-weight: 600; }
`,
    mount(ctx) {
      const roomSelect = h("select", { "aria-label": "Room" });
      const info = h("span", { class: "muted" });
      const current = () => hub.rooms.list.find((r) => r.label === roomSelect.value) ?? hub.rooms.list[0];
      function refreshRooms() {
        const value = roomSelect.value;
        roomSelect.replaceChildren(
          ...hub.rooms.list.length ? hub.rooms.list.map((r2) => h("option", { value: r2.label, text: `${r2.label} · ${r2.source}` })) : [h("option", { value: "", text: "No room yet" })]
        );
        if (value) roomSelect.value = value;
        const r = current();
        info.textContent = r ? kind(r.room) : "The page hasn’t joined a room yet, or joined before hooks were installed (try Find).";
      }
      hub.rooms.subscribe(refreshRooms, ctx.signal);
      roomSelect.addEventListener("change", refreshRooms);
      const top = h(
        "div",
        { class: "row pad mp-top" },
        roomSelect,
        h("button", {
          type: "button",
          text: "Find",
          title: "Look for room objects in page globals (room, socket, party…)",
          onclick: () => {
            const n = discoverRooms();
            ctx.status(n ? `Attached ${n} room(s) found in page globals.` : "No new rooms found in page globals.");
          }
        }),
        h("button", {
          type: "button",
          text: "Join debug connection",
          title: "WebsimSocket.joinRoom(): a separate connection of your own",
          onclick: () => void joinDebug(ctx)
        }),
        info
      );
      ctx.pane.append(top);
      const packets = h("div");
      const state = h("div");
      subtabs(ctx.pane, [
        { id: "packets", label: "Packets", el: packets, init: () => packetsView(ctx, packets, current) },
        { id: "state", label: "State", el: state, init: () => stateView(ctx, state, current) }
      ]);
      refreshRooms();
    }
  };
  function kind(room2) {
    const legacy = "roomState" in room2 || "peers" in room2 || "presence" in room2;
    const parts = [legacy ? "legacy WebsimSocket (presence/roomState)" : "server room (send/onmessage)"];
    if (typeof room2.clientId === "string") parts.push("clientId " + room2.clientId);
    return parts.join(" · ");
  }
  async function joinDebug(ctx) {
    const WS = window.WebsimSocket;
    if (typeof WS?.joinRoom !== "function") {
      ctx.status("WebsimSocket.joinRoom is not available on this page.", true);
      return;
    }
    if (!confirm("Open a separate room connection as you? The server runs onConnect for it like a new player, and it stays open until the page reloads.")) return;
    try {
      const room2 = await ctx.wait(WS.joinRoom(), 2e4);
      attachRoom(room2, "debug connection");
      ctx.status("Joined a debug connection.");
    } catch (error) {
      ctx.status("joinRoom failed: " + errorMessage(error), true);
    }
  }
  function packetsView(ctx, root, current) {
    const payload = h("textarea", { class: "code grow", rows: 3, placeholder: '{"type": "chat", "text": "hi"}  (Ctrl+Enter)', spellcheck: false });
    const mode = h(
      "select",
      { "aria-label": "Direction" },
      h("option", { value: "send", text: "Send to server (as you)" }),
      h("option", { value: "sim", text: "Simulate incoming" })
    );
    const raw = h("input", { type: "checkbox" });
    const go = h("button", { type: "button", class: "primary", text: "Go", onclick: () => run() });
    payload.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
    });
    function value() {
      if (raw.checked) return payload.value;
      try {
        return JSON.parse(payload.value);
      } catch (error) {
        throw new Error("Not valid JSON (tick “raw string” to send text as is): " + errorMessage(error));
      }
    }
    function send(ref, data) {
      const fn = ref.room.send;
      if (typeof fn !== "function") throw new Error(ref.label + " has no send().");
      fn.call(ref.room, data);
      ctx.status(`Sent to ${ref.label}: ${preview(data, 80)}`);
    }
    function simulate(ref, data) {
      const handler = unwrap(ref.room.onmessage);
      if (typeof handler !== "function" || handler.name === "wbsmutilPassive") {
        throw new Error(ref.label + " has no onmessage handler set by the page.");
      }
      const legacy = "roomState" in ref.room || "peers" in ref.room;
      const eventData = legacy || typeof data === "string" ? data : JSON.stringify(data);
      hub.room.push({ tag: ref.label, level: "sim", summary: preview(data, 300), detail: { simulated: true, data }, data });
      handler.call(ref.room, legacy ? { data: eventData } : new MessageEvent("message", { data: eventData }));
      ctx.status(`Delivered simulated packet to ${ref.label}’s onmessage.`);
    }
    function run() {
      try {
        const ref = current();
        if (!ref) throw new Error("No room. The page must join one first, or use Find / Join debug connection.");
        const data = value();
        if (mode.value === "send") send(ref, data);
        else simulate(ref, data);
      } catch (error) {
        ctx.status(errorMessage(error), true);
      }
    }
    const refFor = (label) => hub.rooms.list.find((r) => r.label === label);
    root.append(
      logView({
        channel: hub.room,
        signal: ctx.signal,
        levels: ["in", "out", "sim", "info", "warn"],
        tagLabel: "Room",
        empty: "Packets the page sends (↑) and receives (↓) appear here. Use the filter to hide noisy types, e.g. “-snapshot”.",
        actions: [
          {
            label: "Edit",
            run: (e) => {
              payload.value = typeof e.data === "string" ? e.data : pretty(e.data);
              raw.checked = typeof e.data === "string";
              mode.value = e.level === "in" ? "sim" : "send";
            }
          },
          {
            label: "Resend",
            run: (e) => {
              try {
                const ref = refFor(e.tag);
                if (!ref) throw new Error("Room gone.");
                send(ref, e.data);
              } catch (error) {
                ctx.status(errorMessage(error), true);
              }
            }
          },
          {
            label: "Replay as incoming",
            run: (e) => {
              try {
                const ref = refFor(e.tag);
                if (!ref) throw new Error("Room gone.");
                simulate(ref, e.data);
              } catch (error) {
                ctx.status(errorMessage(error), true);
              }
            }
          }
        ]
      }).el,
      h("div", { class: "row pad mp-composer" }, payload, h("div", { class: "stack" }, mode, h("label", { class: "check" }, raw, "raw string"), go))
    );
  }
  function stateView(ctx, root, current) {
    const grid = h("div", { class: "mp-state" });
    const auto = h("input", { type: "checkbox", checked: true });
    const presence = h("textarea", { class: "code", rows: 3, placeholder: '{"x": 0, "y": 0}' });
    const roomState = h("textarea", { class: "code", rows: 3, placeholder: '{"level": 2}' });
    function section(title, value) {
      return h("div", {}, h("h4", { text: title }), h("div", { class: "box" }, h("pre", { class: "json", text: pretty(value, 2, 5) })));
    }
    function render() {
      const ref = current();
      if (!ref) {
        grid.replaceChildren(h("div", { class: "empty", text: "No room attached." }));
        return;
      }
      const r = ref.room;
      const fields = {};
      for (const key of Object.keys(r)) {
        if (["peers", "presence", "roomState"].includes(key)) continue;
        try {
          const v = r[key];
          if (typeof v !== "function") fields[key] = v;
        } catch {
        }
      }
      const methods = /* @__PURE__ */ new Set();
      for (let p = r; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const k of Object.getOwnPropertyNames(p)) {
          try {
            if (k !== "constructor" && typeof r[k] === "function") methods.add(k);
          } catch {
          }
        }
      }
      grid.replaceChildren(
        ..."peers" in r ? [section("peers", r.peers)] : [],
        ..."presence" in r ? [section("presence", r.presence)] : [],
        ..."roomState" in r ? [section("roomState", r.roomState)] : [],
        section("Other fields", fields),
        section("Methods", [...methods].sort())
      );
    }
    function call(method, text) {
      try {
        const ref = current();
        if (!ref) throw new Error("No room attached.");
        const fn = ref.room[method];
        if (typeof fn !== "function") throw new Error(`${ref.label} has no ${method}() (only legacy sockets do).`);
        fn.call(ref.room, JSON.parse(text));
        ctx.status(`${method} sent.`);
        setTimeout(render, 300);
      } catch (error) {
        ctx.status(errorMessage(error), true);
      }
    }
    const timer = setInterval(() => {
      if (auto.checked && !root.hidden && root.isConnected) render();
    }, 1e3);
    ctx.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    root.append(
      h(
        "div",
        { class: "scroll pad stack" },
        h("div", { class: "row" }, h("button", { type: "button", text: "Refresh", onclick: render }), h("label", { class: "check" }, auto, "auto-refresh (1 s)")),
        grid,
        h(
          "fieldset",
          {},
          h("legend", { text: "Legacy socket updates" }),
          h("div", { class: "row" }, h("div", { class: "grow stack" }, presence), h("button", { type: "button", text: "updatePresence", onclick: () => call("updatePresence", presence.value) })),
          h("div", { class: "row" }, h("div", { class: "grow stack" }, roomState), h("button", { type: "button", text: "updateRoomState", onclick: () => call("updateRoomState", roomState.value) }))
        )
      )
    );
    render();
  }

  // src/tools/project/index.ts
  var projectTool = {
    id: "project",
    label: "Project",
    css: `
.p-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
.p-card .who { display: flex; gap: 6px; align-items: center; }
.p-card .box { max-height: 180px; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; font: 11px/1.5 ui-monospace, monospace; }
.kv dt { color: #8c98a4; }
.kv dd { margin: 0; overflow-wrap: anywhere; }
`,
    mount(ctx) {
      const overview = h("div");
      const users = h("div");
      const calls = h("div");
      subtabs(ctx.pane, [
        { id: "overview", label: "Overview", el: overview, init: () => overviewView(ctx, overview) },
        { id: "users", label: "Users API", el: users, init: () => usersView(ctx, users) },
        {
          id: "calls",
          label: "All websim calls",
          el: calls,
          init: () => calls.append(
            logView({
              channel: hub.websim,
              signal: ctx.signal,
              tagLabel: "Call",
              empty: "Every call the page makes into window.websim.* appears here."
            }).el
          )
        }
      ]);
    }
  };
  function kv(entries) {
    return h("dl", { class: "kv" }, entries.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: String(v) })]));
  }
  function overviewView(ctx, root) {
    const env = h("div");
    const hooks = h("div");
    const identity = h("div", { class: "p-grid" });
    const notif = h("span", { class: "badge", text: "?" });
    const upload = h("input", { type: "file" });
    const transcode = h("input", { type: "checkbox" });
    const uploadResult = h("div");
    function renderEnv() {
      const ws = getWebsim();
      env.replaceChildren(
        kv([
          ["origin", location.origin],
          ["path", location.pathname + location.search],
          ["framed", window !== window.top ? "yes (inside websim page)" : "no (top level)"],
          ["window.websim", ws ? Object.keys(ws).sort().join(", ") : "missing"],
          ["WebsimSocket", typeof window.WebsimSocket === "function" ? "present" : "missing"],
          ["rooms attached", hub.rooms.list.map((r) => `${r.label} (${r.source})`).join(", ") || "none"],
          ["user agent", navigator.userAgent],
          ["viewport", `${innerWidth}×${innerHeight} @${devicePixelRatio}x`]
        ])
      );
      hooks.replaceChildren(kv([...hub.hooks.entries()]));
    }
    async function fetchIdentity(key) {
      try {
        return { value: await ctx.wait(requireWebsim(key)(), 15e3) };
      } catch (error) {
        return { error };
      }
    }
    function card(title, result, extra = [], json) {
      if ("error" in result) {
        return h("div", { class: "p-card" }, h("strong", { text: title }), h("div", { class: "error-text", text: errorMessage(result.error) }));
      }
      const { value } = result;
      const username = value.username;
      return h(
        "div",
        { class: "p-card stack" },
        h("div", { class: "who" }, avatar(username), h("strong", { text: title }), h("span", { class: "muted", text: String(username ?? value.title ?? value.id ?? "") })),
        extra.length ? kv(extra) : null,
        h("div", { class: "box" }, jsonBlock(json ?? value))
      );
    }
    async function loadIdentity() {
      identity.replaceChildren(h("div", { class: "muted", text: "Loading…" }));
      const [project, viewer, creator] = await Promise.all([
        fetchIdentity("getCurrentProject"),
        fetchIdentity("getCurrentUser"),
        fetchIdentity("getCreator")
      ]);
      if (ctx.stopped()) return;
      const cards = [
        card("Project", project, "value" in project ? [["link", `https://websim.com/p/${String(project.value.id)}`]] : [])
      ];
      const viewerId = "value" in viewer ? viewer.value.id : void 0;
      const creatorId = "value" in creator ? creator.value.id : void 0;
      if (viewerId !== void 0 && viewerId !== "1" && viewerId === creatorId && "value" in creator) {
        const same = JSON.stringify(viewer) === JSON.stringify(creator);
        cards.push(card("You (viewer & creator)", viewer, [["role", "you created this project"]], same ? void 0 : { viewer: viewer.value, creator: creator.value }));
      } else {
        cards.push(card("You (viewer)", viewer, viewerId === "1" ? [["note", 'signed out (id "1")']] : []), card("Creator", creator));
      }
      identity.replaceChildren(...cards);
    }
    async function notifCall(kind2) {
      try {
        const fn = requireWebsim("notifications")[kind2];
        if (typeof fn !== "function") throw new Error(`websim.notifications.${kind2} is not available.`);
        const res = await fn.call(getWebsim().notifications);
        notif.textContent = res.state + ("error" in res && res.error ? ` (${String(res.error)})` : "");
        notif.className = "badge " + (res.state === "granted" ? "good" : res.state === "denied" ? "bad" : "");
        ctx.status(`notifications.${kind2} → ${res.state}`);
      } catch (error) {
        ctx.status(`notifications.${kind2} failed: ${errorMessage(error)}`, true);
      }
    }
    root.append(
      h(
        "div",
        { class: "scroll pad stack" },
        h("fieldset", {}, h("legend", { text: "Frame" }), env),
        h("fieldset", {}, h("legend", { text: "Hooks" }), hooks, h("div", { class: "row" }, h("button", { type: "button", text: "Refresh", onclick: renderEnv }))),
        h("fieldset", {}, h("legend", { text: "Identity" }), h("div", { class: "row" }, h("button", { type: "button", text: "Reload", onclick: () => void loadIdentity() })), identity),
        h(
          "fieldset",
          {},
          h("legend", { text: "Notifications permission" }),
          h(
            "div",
            { class: "row" },
            notif,
            h("button", { type: "button", text: "Check", onclick: () => void notifCall("getPermission") }),
            h("button", { type: "button", text: "Request", title: "Uses this click as the user gesture", onclick: () => void notifCall("requestPermission") }),
            h("button", { type: "button", class: "danger", text: "Revoke", onclick: () => void notifCall("revokePermission") })
          ),
          h("p", { class: "hint", text: "Sending happens only in server.js via env.NOTIFICATIONS.send(); there is no client-side send." })
        ),
        h(
          "fieldset",
          {},
          h("legend", { text: "Upload (websim.upload)" }),
          h(
            "div",
            { class: "row" },
            upload,
            h("label", { class: "check", title: "Transcode video for comments" }, transcode, "transcode"),
            h("button", {
              type: "button",
              text: "Upload",
              onclick: async () => {
                const file = upload.files?.[0];
                if (!file) return ctx.status("Pick a file first.", true);
                uploadResult.replaceChildren(h("span", { class: "muted", text: "Uploading…" }));
                try {
                  const res = await requireWebsim("upload")(file, transcode.checked ? { transcode: true } : void 0);
                  uploadResult.replaceChildren(jsonBlock(res));
                  ctx.status("Uploaded " + file.name);
                } catch (error) {
                  uploadResult.replaceChildren(h("div", { class: "error-text", text: errorMessage(error) }));
                  ctx.status("Upload failed: " + errorMessage(error), true);
                }
              }
            })
          ),
          uploadResult
        )
      )
    );
    renderEnv();
    void loadIdentity();
    void notifCall("getPermission");
  }
  var ENDPOINTS = [
    ["profile", ""],
    ["stats", "/stats"],
    ["followers", "/follower-users?first=50&include=" + encodeURIComponent('["follower"]')],
    ["following", "/following-users?first=50&include=" + encodeURIComponent('["following"]')],
    ["projects", "/projects"]
  ];
  function usersView(ctx, root) {
    const user = h("input", { placeholder: "username or id", class: "grow" });
    const endpoint = h("select", {}, ENDPOINTS.map(([label, path]) => h("option", { value: path, text: label })));
    const out = h("div", { class: "scroll pad" });
    const urlEl = h("span", { class: "muted" });
    async function go() {
      const u = user.value.trim();
      if (!u) return;
      const url = `https://websim.com/api/v1/users/${encodeURIComponent(u)}${endpoint.value}`;
      urlEl.textContent = url;
      out.replaceChildren(h("span", { class: "muted", text: "Loading…" }));
      try {
        const res = await ctx.wait(fetch(url, { signal: ctx.signal }));
        const data = await res.json();
        out.replaceChildren(h("div", { class: "row" }, avatar(u), h("span", { class: "badge " + (res.ok ? "good" : "bad"), text: String(res.status) })), jsonBlock(data));
      } catch (error) {
        out.replaceChildren(h("div", { class: "error-text", text: errorMessage(error) }));
      }
    }
    user.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void go();
    });
    root.append(
      h(
        "div",
        { class: "pad stack" },
        h(
          "div",
          { class: "row" },
          user,
          endpoint,
          h("button", { type: "button", class: "primary", text: "Fetch", onclick: () => void go() }),
          h("button", {
            type: "button",
            text: "Creator",
            onclick: async () => {
              const c = await getWebsim()?.getCreator?.().catch(() => null);
              if (c?.username) user.value = String(c.username);
              void go();
            }
          }),
          h("button", {
            type: "button",
            text: "Me",
            onclick: async () => {
              const me = await getWebsim()?.getCurrentUser?.().catch(() => null);
              if (!me || me.id === "1") return ctx.status('Signed out: the users API rejects id "1".', true);
              user.value = String(me.username ?? me.id);
              void go();
            }
          })
        ),
        urlEl
      ),
      out
    );
  }

  // src/tools/storage/index.ts
  var storageTool = {
    id: "storage",
    label: "Storage",
    css: `
.st-editor { width: 42%; flex: none; border-left: 1px solid #303841; }
.st-editor textarea { flex: 1; min-height: 120px; resize: none; }
.st-dbs { width: 180px; flex: none; border-right: 1px solid #303841; }
.st-dbs button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; }
.st-dbs button.active { background: #3c4c37; color: #d6e8cb; }
.st-dbs h4 { margin: 6px 8px 2px; font-size: 10px; color: #8c98a4; font-weight: 400; text-transform: uppercase; }
`,
    mount(ctx) {
      const local = h("div");
      const session = h("div");
      const idb = h("div");
      const cookies = h("div");
      subtabs(ctx.pane, [
        { id: "local", label: "localStorage", el: local, init: () => kvStorage(ctx, local, () => localStorage, "localStorage") },
        { id: "session", label: "sessionStorage", el: session, init: () => kvStorage(ctx, session, () => sessionStorage, "sessionStorage") },
        { id: "idb", label: "IndexedDB", el: idb, init: () => indexedDbView(ctx, idb) },
        { id: "cookies", label: "Cookies", el: cookies, init: () => cookieView(cookies) }
      ]);
    }
  };
  function kvStorage(ctx, root, get, label) {
    const tbody = h("tbody");
    const key = h("input", { class: "code", placeholder: "key" });
    const value = h("textarea", { class: "code", spellcheck: false });
    const filter = h("input", { placeholder: "Filter keys", class: "grow" });
    const info = h("span", { class: "muted" });
    let selected = null;
    function storage() {
      try {
        return get();
      } catch (error) {
        throw new Error(label + " is blocked here: " + errorMessage(error));
      }
    }
    function render() {
      let s;
      try {
        s = storage();
      } catch (error) {
        tbody.replaceChildren(h("tr", {}, h("td", { class: "error-text", text: errorMessage(error) })));
        return;
      }
      const term = filter.value.toLowerCase();
      const keys = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null && k.toLowerCase().includes(term)) keys.push(k);
      }
      keys.sort();
      let bytes = 0;
      tbody.replaceChildren(
        ...keys.map((k) => {
          const v = s.getItem(k) ?? "";
          bytes += (k.length + v.length) * 2;
          return h(
            "tr",
            { class: k === selected ? "selected" : "", tabIndex: 0, onclick: () => pick(k) },
            h("td", { text: k, title: k }),
            h("td", { text: v.slice(0, 200), title: v.slice(0, 1e3) }),
            h("td", { class: "muted", text: v.length.toLocaleString() })
          );
        })
      );
      info.textContent = `${keys.length} keys · ~${(bytes / 1024).toFixed(1)} KB`;
    }
    function pick(k) {
      selected = k;
      key.value = k;
      const v = storage().getItem(k) ?? "";
      const parsed = tryParse(v);
      value.value = typeof parsed === "object" && parsed !== null ? pretty(parsed) : v;
      render();
    }
    function save() {
      try {
        const k = key.value;
        if (!k) throw new Error("Enter a key.");
        const parsed = tryParse(value.value);
        const text = typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : value.value;
        storage().setItem(k, text);
        if (selected && selected !== k) ctx.status(`Saved as new key “${k}” (“${selected}” kept).`);
        else ctx.status(`Saved “${k}”.`);
        selected = k;
        render();
      } catch (error) {
        ctx.status("Save failed: " + errorMessage(error), true);
      }
    }
    filter.addEventListener("input", render);
    root.append(
      h("div", { class: "row pad" }, filter, h("button", { type: "button", text: "Refresh", onclick: render }), info),
      h(
        "div",
        { class: "split" },
        h(
          "div",
          { class: "scroll" },
          h("table", { class: "grid" }, h("thead", {}, h("tr", {}, h("th", { text: "Key" }), h("th", { text: "Value" }), h("th", { text: "Chars" }))), tbody)
        ),
        h(
          "div",
          { class: "st-editor pad stack" },
          key,
          value,
          h(
            "div",
            { class: "row" },
            h("button", { type: "button", class: "primary", text: "Save", onclick: save }),
            h("button", {
              type: "button",
              text: "New",
              onclick: () => {
                selected = null;
                key.value = "";
                value.value = "";
                key.focus();
                render();
              }
            }),
            h("button", {
              type: "button",
              class: "danger",
              text: "Delete",
              onclick: () => {
                if (!key.value) return;
                storage().removeItem(key.value);
                ctx.status(`Deleted “${key.value}”.`);
                selected = null;
                key.value = value.value = "";
                render();
              }
            }),
            h("button", {
              type: "button",
              class: "danger",
              text: "Clear all",
              onclick: () => {
                if (!confirm(`Remove every ${label} key for ${location.origin}?`)) return;
                storage().clear();
                render();
              }
            })
          )
        )
      )
    );
    render();
  }
  function req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function indexedDbView(ctx, root) {
    const side = h("div", { class: "st-dbs scroll" });
    const main = h("div", { class: "scroll pad stack" });
    async function listDbs() {
      side.replaceChildren(h("div", { class: "muted pad", text: "Loading…" }));
      try {
        if (typeof indexedDB.databases !== "function") throw new Error("indexedDB.databases() is not supported by this browser.");
        const dbs = await indexedDB.databases();
        side.replaceChildren(h("h4", { text: "Databases" }));
        if (!dbs.length) side.append(h("div", { class: "muted pad", text: "None" }));
        for (const info of dbs) {
          if (!info.name) continue;
          const name = info.name;
          side.append(h("button", { type: "button", text: `${name} (v${info.version ?? "?"})`, onclick: () => void openDb(name) }));
        }
      } catch (error) {
        side.replaceChildren(h("div", { class: "error-text pad", text: errorMessage(error) }));
      }
    }
    async function openDb(name) {
      main.replaceChildren(h("span", { class: "muted", text: "Opening…" }));
      let db = null;
      try {
        db = await ctx.wait(req(indexedDB.open(name)));
        const stores = [...db.objectStoreNames];
        const out = [h("strong", { text: name })];
        for (const store of stores) {
          const tx = db.transaction(store, "readonly");
          const os = tx.objectStore(store);
          const count = await req(os.count());
          const rows = [];
          await new Promise((resolve, reject) => {
            const cur = os.openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (!c || rows.length >= 100) return resolve();
              rows.push({ key: c.key, value: c.value });
              c.continue();
            };
            cur.onerror = () => reject(cur.error);
          });
          out.push(
            h(
              "details",
              { open: stores.length === 1 },
              h("summary", { text: `${store} · ${count} records${count > 100 ? " (first 100)" : ""} · key ${pretty(os.keyPath, 0)} · indexes: ${[...os.indexNames].join(", ") || "none"}` }),
              jsonBlock(rows)
            )
          );
        }
        if (!stores.length) out.push(h("span", { class: "muted", text: "No object stores." }));
        main.replaceChildren(...out, h("p", { class: "hint", text: "Read-only view." }));
      } catch (error) {
        main.replaceChildren(h("div", { class: "error-text", text: errorMessage(error) }));
      } finally {
        db?.close();
      }
    }
    root.append(h("div", { class: "row pad" }, h("button", { type: "button", text: "Refresh", onclick: () => void listDbs() })), h("div", { class: "split" }, side, main));
    void listDbs();
  }
  function cookieView(root) {
    const tbody = h("tbody");
    const render = () => {
      const pairs = document.cookie ? document.cookie.split("; ").map((c) => [c.slice(0, c.indexOf("=")), decodeURIComponent(c.slice(c.indexOf("=") + 1))]) : [];
      tbody.replaceChildren(
        ...pairs.length ? pairs.map(([k, v]) => h("tr", {}, h("td", { text: k ?? "" }), h("td", { text: v ?? "", title: v ?? "" }))) : [h("tr", {}, h("td", { class: "muted", text: "No script-readable cookies (HttpOnly cookies are hidden from pages)." }))]
      );
    };
    root.append(
      h("div", { class: "row pad" }, h("button", { type: "button", text: "Refresh", onclick: render })),
      h("div", { class: "scroll" }, h("table", { class: "grid" }, h("thead", {}, h("tr", {}, h("th", { text: "Name" }), h("th", { text: "Value" }))), tbody))
    );
    render();
  }

  // src/tools/index.ts
  var tools = [
    homeTool,
    databaseTool,
    apiTool,
    multiplayerTool,
    aiTool,
    commentsTool,
    projectTool,
    consoleTool,
    storageTool
  ];

  // src/main.ts
  var site = isSitePage();
  var notice = {
    id: "notice",
    label: "WbSmUtil",
    mount(ctx) {
      const hosts = iframeHosts();
      ctx.pane.append(
        h(
          "div",
          { class: "pad stack scroll" },
          h("strong", { text: "This is the websim site page, not the project." }),
          h("p", {
            class: "muted",
            text: "Websim runs each project inside an iframe on its own *.websim.com subdomain. WbSmUtil has to run inside that frame to reach the project’s websim, WebsimSocket and /api routes."
          }),
          h("p", { text: `Use “⧉ Move into project frame” above, or click inside the project and press ${HOTKEY.label}.` }),
          h("p", { class: "muted", text: hosts.length ? "Iframes on this page: " + hosts.join(", ") : "No iframes found on this page yet." })
        )
      );
      ctx.status("Not inside a project frame.", true);
    }
  };
  async function open() {
    if (site) {
      if (await sendToProjectFrame("open")) return;
      openShell([notice]);
      return;
    }
    openShell(tools);
  }
  async function toggle() {
    if (site) {
      if (isOpen()) return closeShell();
      if (await sendToProjectFrame("toggle")) return;
      openShell([notice]);
      return;
    }
    if (isOpen()) closeShell();
    else openShell(tools);
  }
  if (!site) {
    installHooks();
    listenForCommands({
      open: () => openShell(tools),
      close: closeShell,
      toggle: () => void toggle()
    });
  }
  window.WbSmUtil = { open: () => void open(), close: closeShell, toggle: () => void toggle() };
  console.info(`[WbSmUtil] loaded in ${location.host} (${site ? "websim page: forwards to project frame" : "project frame"}, page world). ${HOTKEY.label} toggles.`);
  window.addEventListener(
    "keydown",
    (e) => {
      if (!isHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      void toggle();
    },
    true
  );
})();
}
"use strict";
(() => {
  // src/loader.ts
  var FLAG = "data-wbsmutil";
  var TAG = "[WbSmUtil]";
  var running = () => !!document.documentElement?.hasAttribute(FLAG);
  var contentWorld = typeof window.wrappedJSObject === "object";
  function inject(nonce) {
    const parent = document.head ?? document.documentElement;
    if (!parent) return false;
    const script = document.createElement("script");
    if (nonce) {
      script.nonce = nonce;
      script.setAttribute("nonce", nonce);
    }
    script.textContent = `(${__wbsmutilMain.toString()})();`;
    parent.appendChild(script);
    script.remove();
    return running();
  }
  function pageNonce() {
    for (const s of document.querySelectorAll("script")) {
      const n = s.nonce || s.getAttribute("nonce");
      if (n) return n;
    }
    return "";
  }
  function load() {
    if (running()) return;
    if (!pageNonce() && inject()) return;
    const nonce = pageNonce();
    if (nonce && inject(nonce)) return;
    if (!contentWorld) {
      __wbsmutilMain();
      return;
    }
    const observer = new MutationObserver(() => {
      if (running()) return observer.disconnect();
      const n = pageNonce();
      if (n && inject(n)) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        observer.disconnect();
        if (!running()) {
          console.warn(
            `${TAG} could not run in ${location.host}: the page's Content-Security-Policy blocked injection and no script nonce was available.`
          );
        }
      },
      { once: true }
    );
  }
  try {
    load();
  } catch (error) {
    console.warn(`${TAG} loader error in ${location.host}:`, error);
  }
})();
})();
