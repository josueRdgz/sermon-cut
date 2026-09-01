import type { ApiErrorBody } from '../types/project';

// Base URL for the backend API. In browser/Vite development the empty string
// uses the Vite proxy for "/api". In the Tauri desktop shell it is set to
// http://127.0.0.1:<port> via prepareApiBaseUrl() before React mounts.
export let API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** Default request timeout so hung backends never leave the UI waiting forever. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** AI / long background jobs (Highlights, análisis) exceed the default 30s easily. */
export const LONG_FETCH_TIMEOUT_MS = 180_000;

/** Resolve API origin when running inside the Tauri desktop shell. */
export async function prepareApiBaseUrl(): Promise<void> {
  if (API_BASE_URL) return;
  // Prefer the official runtime flag; fall back for older webviews.
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    API_BASE_URL = await invoke<string>('get_api_base_url');
  } catch (err) {
    console.error('Failed to resolve desktop API base URL', err);
    throw err;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(body.detail || response.statusText, response.status, body.code ?? null);
  } catch {
    return new ApiError(response.statusText || 'Request failed', response.status);
  }
}

function withTimeoutSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      window.clearTimeout(timer);
      if (external) external.removeEventListener('abort', onExternalAbort);
    },
    timedOut: () => timedOut,
  };
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const { signal, clear, timedOut } = withTimeoutSignal(timeoutMs, init.signal ?? undefined);
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (!timedOut() && init.signal?.aborted) {
        throw new ApiError('La solicitud se canceló.', 0, 'request_cancelled');
      }
      throw new ApiError(
        'La solicitud tardó demasiado o se canceló. Inténtalo de nuevo.',
        0,
        'request_timeout',
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === 'Load failed' ||
      message === 'Failed to fetch' ||
      message === 'NetworkError when attempting to fetch resource.'
    ) {
      throw new ApiError(
        'No se pudo conectar con el backend local. Cierra Sermon Cut y vuelve a abrirlo.',
        0,
        'network_error',
      );
    }
    throw err;
  } finally {
    clear();
  }
}

export async function apiGet<T>(path: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<T> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    { headers: { Accept: 'application/json' } },
    timeoutMs,
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiJson<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    },
    options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiDelete(path: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<void> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    { method: 'DELETE' },
    timeoutMs,
  );
  if (!response.ok) throw await parseError(response);
}

export async function apiDeleteJson<T>(
  path: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    },
    timeoutMs,
  );
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiForm<T>(
  path: string,
  form: FormData,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method: 'POST',
      body: form,
    },
    timeoutMs,
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export function uploadWithProgress<T>(
  path: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);

    xhr.open('POST', `${API_BASE_URL}${path}`);
    xhr.responseType = 'json';
    xhr.timeout = DEFAULT_FETCH_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as T);
        return;
      }
      const body = xhr.response as ApiErrorBody | null;
      reject(
        new ApiError(
          body?.detail || xhr.statusText || 'Upload failed',
          xhr.status,
          body?.code ?? null,
        ),
      );
    };

    xhr.ontimeout = () =>
      reject(new ApiError('La subida tardó demasiado. Inténtalo de nuevo.', 0, 'request_timeout'));
    xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
    xhr.send(form);
  });
}
