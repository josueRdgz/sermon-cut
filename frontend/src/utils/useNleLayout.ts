import { useCallback, useEffect, useState } from 'react';

import {
  clampNleLayout,
  DEFAULT_NLE_LAYOUT,
  loadNleLayout,
  saveNleLayout,
  type NleLayout,
} from './nleLayout';

export function useNleLayout() {
  const [layout, setLayout] = useState<NleLayout>(DEFAULT_NLE_LAYOUT);

  useEffect(() => {
    setLayout(loadNleLayout());
  }, []);

  const patchLayout = useCallback((partial: Partial<NleLayout>) => {
    setLayout((current) => {
      const next = clampNleLayout({ ...current, ...partial });
      saveNleLayout(next);
      return next;
    });
  }, []);

  return { layout, patchLayout };
}
