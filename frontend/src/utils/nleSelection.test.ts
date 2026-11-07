import { describe, expect, it } from 'vitest';

import {
  applyNleSelection,
  nleIdsOfKind,
  nleItemSelected,
  type NleItemRef,
} from './nleSelection';

const overlay = (id: string): NleItemRef => ({ kind: 'overlay', id });

describe('nleSelection', () => {
  it('replaces the selection on a plain click', () => {
    expect(applyNleSelection([overlay('a')], overlay('b'), false)).toEqual([overlay('b')]);
  });

  it('toggles items with an additive click', () => {
    const added = applyNleSelection([overlay('a')], overlay('b'), true);
    expect(nleIdsOfKind(added, 'overlay')).toEqual(['a', 'b']);
    const removed = applyNleSelection(added, overlay('a'), true);
    expect(nleIdsOfKind(removed, 'overlay')).toEqual(['b']);
  });

  it('reports membership', () => {
    expect(nleItemSelected([overlay('a')], overlay('a'))).toBe(true);
    expect(nleItemSelected([overlay('a')], overlay('b'))).toBe(false);
  });
});
