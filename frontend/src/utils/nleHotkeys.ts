/** True when the key event should drive NLE shortcuts (not a form field). */
export function isNleHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (
    target.isContentEditable ||
    target.closest('[contenteditable="true"], [contenteditable=""]')
  ) {
    return false;
  }
  if (target.closest('[role="dialog"]') || target.closest('.nle-menu')) return false;
  return true;
}

/**
 * ReelEditor stays mounted while other workspace tabs are shown (`hidden`).
 * Shortcuts must not split, join or delete clips from Predicación / Transcripción.
 */
export function isReelEditorHotkeysActive(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[role="dialog"]')) return false;
  if (document.querySelector('.nle-menu')) return false;
  const panel = document.getElementById('workspace-panel-editor');
  if (!panel) return true;
  return !panel.hidden;
}
