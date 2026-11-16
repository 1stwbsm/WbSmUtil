// Shown on the Home tab, newest first. Add an entry with every version bump.

export interface Release {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.4.2',
    date: '2026-11-16',
    changes: [
      'API tab: new Presets list with 21 ready-made requests (this project, creator, you, comments). Creator, viewer and project IDs are filled in automatically.',
      'API tab: the websim API buttons moved from Routes into Presets.',
      'Project tab: when you’re viewing your own project, the viewer and creator cards merge into one.',
    ],
  },
  {
    version: '0.4.1',
    date: '2026-11-16',
    changes: ['New Home tab with this changelog. The window now opens here instead of on Database.'],
  },
  {
    version: '0.4.0',
    date: '2026-11-16',
    changes: [
      'Fixed WbSmUtil not running at all in Firefox/Violentmonkey: websim’s Content-Security-Policy blocked the injection.',
      'It now falls back to a content script and re-injects itself with the page’s script nonce.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-16',
    changes: [
      'Hotkey changed from Alt+Shift+D to Ctrl+Backtick (Alt combos clash with Firefox and Linux desktops).',
      'Each frame logs a “[WbSmUtil] loaded in …” console line.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-16',
    changes: [
      'Renamed from Pocket DB to WbSmUtil.',
      'Runs inside the project iframe; the websim.com page forwards the hotkey, and “Move into project frame” moves the window there.',
      'New tabs: API, Multiplayer, AI, Comments, Project, Console, Storage.',
      'Hooks start at page load, so logs include what the project did before you opened the panel.',
      'The Database tab only uses an existing room and never creates one.',
    ],
  },
  {
    version: 'Pocket DB',
    date: '2026-11-15',
    changes: ['The original websim database inspector, rewritten in TypeScript as a userscript.'],
  },
];
