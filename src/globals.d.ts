declare global {
  /** Legacy collection socket a project may expose as a top-level binding. */
  var room: unknown;
  var websimDBRoom: unknown;
  /** Injected by websim on project pages. */
  var WebsimSocket: (new () => unknown) | undefined;
  var websim: unknown;
}

export {};
