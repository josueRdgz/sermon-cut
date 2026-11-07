import { useCallback, useEffect, useState } from 'react';

import { fetchHealth } from '../api/health';
import type { HealthResponse } from '../types/health';

type Status = 'loading' | 'ok' | 'error';

interface UseHealthResult {
  status: Status;
  data: HealthResponse | null;
  error: string | null;
  refresh: () => void;
}

export function useHealth(): UseHealthResult {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { status, data, error, refresh };
}
