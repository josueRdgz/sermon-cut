import type { ApiErrorBody } from '../types/project';

// Base URL for the backend API. In development the Vite dev server proxies
// "/api" to the local FastAPI backend, so a relative base works out of the box.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

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

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiJson<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE' });
  if (!response.ok) throw await parseError(response);
}

export async function apiDeleteJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    body: form,
  });
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

    xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
    xhr.send(form);
  });
}
