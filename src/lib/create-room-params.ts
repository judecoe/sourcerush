/**
 * Checks createRoom's params. Exactly one of:
 *   { url: 'https://…' }  generate questions from that article (background job)
 *   { sample: true }      "Try it yourself": the built-in Tide Clock article, no API calls
 * Pure, so it is unit tested; createRoom runs it before spending anything.
 */

export const MAX_URL_LENGTH = 2048

export type CreateRoomRequest =
  | { ok: true; kind: 'sample' }
  | { ok: true; kind: 'url'; url: string }
  | { ok: false; error: string }

export function parseCreateRoomParams(params: Record<string, unknown>): CreateRoomRequest {
  const hasUrl = params.url !== undefined
  const isSample = params.sample === true
  if (hasUrl === isSample) {
    return { ok: false, error: 'Paste an article link, or choose Try it yourself.' }
  }
  if (isSample) return { ok: true, kind: 'sample' }

  const raw = typeof params.url === 'string' ? params.url.trim() : ''
  if (!raw) return { ok: false, error: 'Paste an article link.' }
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'That link is too long.' }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: "That doesn't look like a web address." }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// links work.' }
  }
  return { ok: true, kind: 'url', url: parsed.href }
}
