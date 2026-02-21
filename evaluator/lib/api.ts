import { getToken } from "@/app/AuthProviderWrapper";

type FetchOptions = RequestInit & { json?: unknown };

export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    return fetch(url, {
      ...options,
      headers,
      body: JSON.stringify(options.json),
    });
  }
  
  return fetch(url, { ...options, headers });
}
