// Base URL for the backend API. In development the Vite dev server proxies
// "/api" to the local FastAPI backend, so a relative base works out of the box.
// It can be overridden with VITE_API_BASE_URL for other setups.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}
