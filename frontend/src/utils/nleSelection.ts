export type NleItemKind = 'overlay' | 'caption' | 'segment' | 'music';

export interface NleItemRef {
  kind: NleItemKind;
  id: string;
}

export function sameNleItem(a: NleItemRef, b: NleItemRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function nleItemSelected(selection: NleItemRef[], item: NleItemRef): boolean {
  return selection.some((entry) => sameNleItem(entry, item));
}

/** Click replaces the selection; Shift/Meta/Ctrl toggles the item. */
export function applyNleSelection(
  current: NleItemRef[],
  item: NleItemRef,
  additive: boolean,
): NleItemRef[] {
  if (!additive) return [item];
  if (nleItemSelected(current, item)) {
    return current.filter((entry) => !sameNleItem(entry, item));
  }
  return [...current, item];
}

export function nleIdsOfKind(selection: NleItemRef[], kind: NleItemKind): string[] {
  return selection.filter((item) => item.kind === kind).map((item) => item.id);
}

export function modifierSelect(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}
