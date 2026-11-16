import type { RequestSpec } from '../../core/hooks';
import { getWebsim } from '../../core/websim';

// Ready-made requests for the API tab. {placeholders} are filled from the
// current page (creator, viewer, project) when a preset is loaded; any left
// unresolved stay in the URL for you to replace. The websim endpoints are the
// documented public read API (CORS is open to project pages); don't add
// guessed ones.

export interface Preset {
  group: string;
  name: string;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  note?: string;
}

const API = 'https://websim.com/api/v1';
const enc = (json: string) => encodeURIComponent(json);

export const PRESETS: Preset[] = [
  // Project origin
  { group: 'This project', name: 'server.js source', method: 'GET', url: '/server.js', note: 'The backend source. It is public, like every project file.' },
  { group: 'This project', name: 'Page HTML', method: 'GET', url: '/' },
  { group: 'This project', name: 'GET /api route', method: 'GET', url: '/api/', note: 'Template: add your route name.' },
  {
    group: 'This project',
    name: 'POST JSON to /api route',
    method: 'POST',
    url: '/api/',
    headers: { 'Content-Type': 'application/json' },
    body: '{\n  \n}',
    note: 'Template. Your x-websim-* identity headers are added by the platform.',
  },

  // Creator
  { group: 'Creator', name: 'Profile', method: 'GET', url: `${API}/users/{creator}` },
  { group: 'Creator', name: 'Stats', method: 'GET', url: `${API}/users/{creator}/stats`, note: 'Followers, following, total likes and views.' },
  { group: 'Creator', name: 'Followers', method: 'GET', url: `${API}/users/{creator}/follower-users?first=50&include=${enc('["follower"]')}` },
  { group: 'Creator', name: 'Following', method: 'GET', url: `${API}/users/{creator}/following-users?first=50&include=${enc('["following"]')}` },
  { group: 'Creator', name: 'Projects (recently updated)', method: 'GET', url: `${API}/users/{creator}/projects` },
  { group: 'Creator', name: 'Projects (newest)', method: 'GET', url: `${API}/users/{creator}/projects?sort_by=created_at` },

  // Viewer
  { group: 'You', name: 'Profile', method: 'GET', url: `${API}/users/{me}`, note: 'Needs you signed in (signed-out id "1" is rejected).' },
  { group: 'You', name: 'Stats', method: 'GET', url: `${API}/users/{me}/stats` },
  { group: 'You', name: 'Projects', method: 'GET', url: `${API}/users/{me}/projects` },
  {
    group: 'You',
    name: 'Do you follow the creator?',
    method: 'GET',
    url: `${API}/users/{creator_id}/follower-users?ids=${enc('["{me_id}"]')}`,
    note: 'Yes when `data` has a row.',
  },

  // Comments
  { group: 'Comments', name: 'Newest 20', method: 'GET', url: `${API}/projects/{project_id}/comments?first=20` },
  { group: 'Comments', name: 'Best', method: 'GET', url: `${API}/projects/{project_id}/comments?first=20&sort_by=best` },
  { group: 'Comments', name: 'Tips only', method: 'GET', url: `${API}/projects/{project_id}/comments?first=20&only_tips=true` },
  { group: 'Comments', name: 'With video', method: 'GET', url: `${API}/projects/{project_id}/comments?first=20&only_video=true` },
  { group: 'Comments', name: 'By the creator', method: 'GET', url: `${API}/projects/{project_id}/comments?first=20&author_id={creator_id}` },
  { group: 'Comments', name: 'Search “bug” (with count)', method: 'GET', url: `${API}/projects/{project_id}/comments?q=bug&include_count=true` },
  { group: 'Comments', name: 'Replies to a comment', method: 'GET', url: `${API}/projects/{project_id}/comments/{comment_id}/replies`, note: 'Replace {comment_id}.' },
];

export type PresetVars = Record<string, string>;

/** Values for the placeholders, from the current page. Missing ones are omitted. */
export async function presetVars(): Promise<PresetVars> {
  const ws = getWebsim();
  const vars: PresetVars = {};
  const settle = async <T>(p: Promise<T> | undefined) => {
    try {
      return await p;
    } catch {
      return undefined;
    }
  };
  const [creator, me, project] = await Promise.all([
    settle(ws?.getCreator?.()),
    settle(ws?.getCurrentUser?.()),
    settle(ws?.getCurrentProject?.()),
  ]);
  if (creator?.username) vars.creator = String(creator.username);
  if (creator?.id) vars.creator_id = String(creator.id);
  // A signed-out viewer has id "1", which the users API rejects.
  if (me?.id && me.id !== '1') {
    vars.me_id = String(me.id);
    vars.me = String(me.username ?? me.id);
  }
  if (project?.id) vars.project_id = String(project.id);
  return vars;
}

/** Fill placeholders. Values are URL-encoded; unknown ones are left as {name}. */
export function fillPreset(p: Preset, vars: PresetVars): { spec: RequestSpec; missing: string[] } {
  const missing = new Set<string>();
  const url = p.url.replace(/\{(\w+)\}|%7B(\w+)%7D/g, (match, a?: string, b?: string) => {
    const key = (a ?? b)!;
    if (vars[key] !== undefined) return encodeURIComponent(vars[key]);
    missing.add(key);
    return match;
  });
  const spec: RequestSpec = { method: p.method, url, headers: { ...(p.headers ?? {}) } };
  if (p.body !== undefined) spec.body = p.body;
  return { spec, missing: [...missing] };
}
