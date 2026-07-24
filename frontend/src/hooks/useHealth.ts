import { useEffect, useState } from 'react';

import { fetchHealth } from '../api/health';
import type { HealthResponse } from '../types/health';

type Status = 'loading' | 'ok' | 'error';

interface UseHealthResult {
  status: Status;
  data: HealthResponse | null;
  error: string | null;
}

export function useHealth(): UseHealthResult {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  return { status, data, error };
}
