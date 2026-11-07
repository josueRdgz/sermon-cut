import { useCallback, useEffect, useState } from 'react';

import {
  clampNleLayout,
  loadNleLayout,
  saveNleLayout,
  type NleLayout,
} from './nleLayout';

export function useNleLayout() {
  const [layout, setLayout] = useState<NleLayout>(() => loadNleLayout());

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
