/**
 * Theme catalog.
 *
 * `sourcerush` is the app's theme (dark, defined in the @theme block in
 * styles.css). It replaced the scaffold's `slate` placeholder on 2026-11-18;
 * nothing stores a theme choice, and an unknown data-theme value simply gets
 * the @theme defaults, i.e. sourcerush. `paper` is the scaffold's light
 * example (themes.css), unused. To add a theme:
 *   1. Add a `[data-theme="my-id"] { ... }` block in src/themes.css with
 *      the shadcn token overrides (include `color-scheme: light;` for
 *      light themes).
 *   2. Add an entry here for type safety, autocomplete, and UI display.
 *   3. Add the theme's background to the first-paint <style> block in
 *      index.html so the pre-CSS frame matches (no white flash).
 *   4. Switch via `data-theme` on <html> in index.html.
 *
 * Color values live in styles.css / themes.css — this file is metadata only.
 */

export const THEMES = [
  {
    id: 'sourcerush',
    label: 'SourceRush',
    description: 'Deep navy base, signal-cyan and coral accents, Space Grotesk + Space Mono.',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Light example theme showing the token contract. Replace or delete.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Read the currently active theme id from <html data-theme>. */
export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'sourcerush'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id ?? 'sourcerush'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
