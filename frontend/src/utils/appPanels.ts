import type { AppPanel } from '../components/AppModals';

export const OPEN_APP_PANEL_EVENT = 'sermon-cut:open-panel';
export const EXPORT_PROFILES_CHANGED_EVENT = 'sermon-cut:export-profiles-changed';

export function openAppPanel(panel: AppPanel) {
  window.dispatchEvent(new CustomEvent(OPEN_APP_PANEL_EVENT, { detail: panel }));
}

export function notifyExportProfilesChanged() {
  window.dispatchEvent(new Event(EXPORT_PROFILES_CHANGED_EVENT));
}
