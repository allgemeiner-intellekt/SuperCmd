/** Retired built-ins must not execute or reserve old user shortcuts. */
export function isRetiredSystemCommand(id: string): boolean {
  return id === 'system-add-to-memory' || id === 'system-whisper-onboarding' ||
    id === 'system-supercmd-speak' || /^system-supercmd-whisper(?:-|$)/.test(id);
}

export function removeRetiredCommandHotkeys(hotkeys: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(hotkeys).filter(([id]) => !isRetiredSystemCommand(id)));
}
