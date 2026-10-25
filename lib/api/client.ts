import { getSupabaseBrowser } from "@/lib/supabase/browser";

export async function apiFetch<T = unknown>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const { data } = await getSupabaseBrowser().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Une erreur est survenue.");
  return payload as T;
}
