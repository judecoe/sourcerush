/**
 * Turns Firecrawl's Markdown into plain text before it reaches the prompt,
 * so the passages the model copies (and players later see on reveal) carry
 * no link, image or emphasis syntax. Paragraph breaks are kept.
 *
 * Pure function, no dependencies; unit tested in markdown.test.ts.
 */

// A link or image destination: `(url)` or `(url "title")`. The URL may hold
// one level of parentheses, as Wikipedia's do: `(/wiki/Tide_(disambiguation))`.
const DESTINATION = String.raw`\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)`

// Link text may hold one level of brackets, as footnotes do: `[[1]](#cite_note-1)`.
const LINK_TEXT = String.raw`\[((?:[^[\]]|\[[^[\]]*\])*)\]`

const IMAGE = new RegExp(String.raw`!\[[^\]]*\]` + DESTINATION, 'g')
const LINK = new RegExp(LINK_TEXT + DESTINATION, 'g')

export function markdownToPlainText(markdown: string): string {
  let text = markdown

  // 0. Backslash escapes: `\[1\]` becomes `[1]`. Firecrawl escapes brackets
  //    this way, e.g. on every Wikipedia footnote marker.
  text = text.replace(/\\([!-/:-@[-`{-~])/g, '$1')

  // 0b. Footnote markers: remove `[1]`, `[12]` and so on. A linked marker
  //     `[[1]](#cite_note-1)` becomes `[](#cite_note-1)`, which step 2 removes.
  text = text.replace(/\[\d+\]/g, '')

  // 1. Images: drop them entirely, alt text included. Runs before links, so a
  //    linked image `[![alt](img)](href)` becomes `[](href)` and then nothing.
  text = text.replace(IMAGE, '')

  // 2. Links: `[text](url)` and `[text](url "title")` become just `text`.
  text = text.replace(LINK, '$1')

  // 3. Headings and block quotes: remove the leading `#`s and `>`s on each line.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
  text = text.replace(/^[ \t]*(?:>[ \t]?)+/gm, '')

  // 4. Emphasis and code markers: remove `*` and backticks everywhere, and
  //    `_` only at a word's edge (so snake_case words survive).
  text = text.replace(/[*`]+/g, '')
  text = text.replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, '')

  // 5. Whitespace: collapse runs of spaces/tabs, trim each line, and keep at
  //    most one blank line between paragraphs.
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/ *\n */g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}
