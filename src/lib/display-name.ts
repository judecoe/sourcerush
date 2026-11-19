/**
 * Display names a player chooses for themselves (Settings → setDisplayName).
 * Pure, so it's unit-tested and shared by the server action and the page.
 */

export const DISPLAY_NAME_MAX = 24

export type DisplayNameResult = { ok: true; name: string } | { ok: false; error: string }

/**
 * Trim, collapse runs of spaces to one, and check the length. Line breaks,
 * tabs and other control characters are refused rather than cleaned up.
 */
export function parseDisplayName(input: unknown): DisplayNameResult {
  if (typeof input !== 'string') return { ok: false, error: 'Enter a name.' }
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    return { ok: false, error: 'Use one line, without tabs.' }
  }
  const name = input.trim().replace(/ {2,}/g, ' ')
  if (name.length === 0) return { ok: false, error: 'Enter a name.' }
  if (name.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.` }
  }
  return { ok: true, name }
}

/**
 * The name to show for a user: their chosen `displayName` if it's valid,
 * else their sign-in `name`, else "Player".
 *
 * The chosen name is checked again here because the users schema lets a
 * client update its own row directly, so a stored value may never have
 * gone through setDisplayName.
 */
export function pickDisplayName(displayName: unknown, signInName: unknown): string {
  const chosen = parseDisplayName(displayName)
  if (chosen.ok) return chosen.name
  return typeof signInName === 'string' && signInName.trim() ? signInName.trim() : 'Player'
}
