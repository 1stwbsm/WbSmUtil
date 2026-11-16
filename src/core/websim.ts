import { hub } from './hub';

// Types for the legacy websim collection socket (room.collection(...)).
// Only the surface WbSmUtil touches is described; every member besides
// collection() is optional because older and newer sockets differ.

export interface WebsimRecord {
  id?: string;
  $type?: string;
  type?: string;
  [key: string]: unknown;
}

export interface CollectionQuery {
  limit?(size: number): CollectionQuery;
  offset?(skip: number): CollectionQuery;
  getList(): Promise<WebsimRecord[]> | WebsimRecord[];
  create(value: Record<string, unknown>): Promise<WebsimRecord | undefined>;
}

export interface LegacySocket {
  collection(name: string): CollectionQuery;
  getDatabaseRecords?(
    filter: { $type?: string },
    options: { limit: number; offset: number },
  ): Promise<unknown>;
  schema?: Record<string, unknown>;
  initialize?(): Promise<void>;
}

export function isLegacySocket(value: unknown): value is LegacySocket {
  return !!value && typeof (value as LegacySocket).collection === 'function';
}

/** Loose view of window.websim; every member may be missing. */
export type WebsimApi = Record<string, unknown> & {
  chat?: { completions?: { create?(opts: Record<string, unknown>): Promise<unknown> } };
  imageGen?(opts: Record<string, unknown>): Promise<{ url?: string } & Record<string, unknown>>;
  textToSpeech?(opts: Record<string, unknown>): Promise<{ url?: string } & Record<string, unknown>>;
  upload?(file: File, opts?: Record<string, unknown>): Promise<unknown>;
  getCurrentProject?(): Promise<Record<string, unknown>>;
  getCurrentUser?(): Promise<Record<string, unknown>>;
  getCreator?(): Promise<Record<string, unknown>>;
  getComments?(params?: Record<string, unknown>): Promise<CommentPage>;
  postComment?(opts: Record<string, unknown>): Promise<Record<string, unknown>>;
  reactToComment?(opts: Record<string, unknown>): Promise<Record<string, unknown>>;
  notifications?: {
    getPermission?(): Promise<{ state: string }>;
    requestPermission?(): Promise<{ state: string }>;
    revokePermission?(): Promise<{ state: string; error?: string }>;
  };
};

export interface CommentPage {
  comments: Array<Record<string, unknown>>;
  count?: number | null;
  hasNextPage?: boolean;
  next?: (() => Promise<CommentPage>) | null;
}

export function getWebsim(): WebsimApi | null {
  const ws = (window as unknown as { websim?: unknown }).websim;
  return ws && typeof ws === 'object' ? (ws as WebsimApi) : null;
}

/** websim.<path> as a function, or a readable error. */
export function requireWebsim<K extends keyof WebsimApi>(key: K): NonNullable<WebsimApi[K]> {
  const ws = getWebsim();
  if (!ws) throw new Error('window.websim is not available in this frame.');
  const value = ws[key];
  if (value === undefined || value === null) throw new Error(`websim.${String(key)} is not available on this page.`);
  return value as NonNullable<WebsimApi[K]>;
}

function pageRoom(): unknown {
  // `typeof` also sees top-level `const room` in classic scripts, which is
  // not a property of window.
  return typeof room !== 'undefined' ? room : undefined;
}

/**
 * Find the collection socket the project already has: a well-known global,
 * or any room the hooks saw the page create. Never creates one, since a new
 * socket would be a new connection the project didn't ask for; returns null
 * when the page has no room. The socket is shared with the project, so it is
 * never closed either.
 */
export function findSocket(): LegacySocket | null {
  for (const candidate of [pageRoom(), window.websimDBRoom, window.room, ...hub.rooms.list.map((r) => r.room)]) {
    if (isLegacySocket(candidate)) return candidate;
  }
  return null;
}
