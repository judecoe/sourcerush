/**
 * Call a server action from the browser. The SDK has no client helper for
 * actions, so this wraps the documented pattern: POST /api/actions/<name>
 * with the caller's JWT. The server takes the user's identity from that
 * token, never from `params`.
 */

import { getAuthToken } from 'deepspace'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

export async function callAction<T>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResponse<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, error: 'Please sign in first.' }

  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json()) as Partial<ActionResponse<T>> & { error?: string }
    if (body.success === true) return body as ActionResponse<T>
    return { success: false, error: body.error ?? `Request failed (${res.status}).` }
  } catch {
    return { success: false, error: 'Network error. Please try again.' }
  }
}
