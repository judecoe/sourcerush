/**
 * Checks createRoom's params. Exactly one of:
 *   { url: 'https://…' }  generate questions from that article (background job)
 *   { topic: '…' }        find an article about it with Exa, then the same as url (background job)
 *   { sample: true }      "Try it yourself": the built-in Tide Clock article, no API calls
 * Pure, so it is unit tested; createRoom runs it before spending anything.
 */

export const MAX_URL_LENGTH = 2048
export const MIN_TOPIC_LENGTH = 3
export const MAX_TOPIC_LENGTH = 200

export type CreateRoomRequest =
  | { ok: true; kind: 'sample' }
  | { ok: true; kind: 'url'; url: string }
  | { ok: true; kind: 'topic'; topic: string }
  | { ok: false; error: string }

// Control characters (incl. newlines and tabs) and DEL.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function parseCreateRoomParams(params: Record<string, unknown>): CreateRoomRequest {
  const hasUrl = params.url !== undefined
  const hasTopic = params.topic !== undefined
  const isSample = params.sample === true
  if ([hasUrl, hasTopic, isSample].filter(Boolean).length !== 1) {
    return { ok: false, error: 'Paste an article link, enter a topic, or choose Try it yourself.' }
  }
  if (isSample) return { ok: true, kind: 'sample' }
  if (hasTopic) return parseTopic(params.topic)

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

function parseTopic(value: unknown): CreateRoomRequest {
  const topic = typeof value === 'string' ? value.trim() : ''
  if (topic.length < MIN_TOPIC_LENGTH) {
    return { ok: false, error: `Enter a topic of at least ${MIN_TOPIC_LENGTH} characters.` }
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return { ok: false, error: `Keep the topic under ${MAX_TOPIC_LENGTH} characters.` }
  }
  if (CONTROL_CHARS.test(topic)) {
    return { ok: false, error: 'Enter the topic on one line.' }
  }
  // A link typed into the topic box goes through the link path instead, so
  // the two never blur (a topic search for a URL would be a wasted call).
  if (/^https?:\/\//i.test(topic)) {
    return { ok: false, error: 'That looks like a link. Paste it in the article link box instead.' }
  }
  return { ok: true, kind: 'topic', topic }
}
