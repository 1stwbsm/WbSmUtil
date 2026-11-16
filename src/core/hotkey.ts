// The toggle shortcut, in one place. `code` is the physical key
// (KeyboardEvent.code), so it works the same on any keyboard layout.
// Ctrl+` is free in Firefox and Chrome and isn't taken by common Linux
// desktops (Alt / Alt+Shift often are: menu bar, layout switching).

export const HOTKEY = {
  ctrl: true,
  alt: false,
  shift: false,
  code: 'Backquote',
  label: 'Ctrl+`',
} as const;

export function isHotkey(e: KeyboardEvent): boolean {
  return (
    e.code === HOTKEY.code &&
    e.ctrlKey === HOTKEY.ctrl &&
    e.altKey === HOTKEY.alt &&
    e.shiftKey === HOTKEY.shift &&
    !e.metaKey &&
    !e.repeat
  );
}
