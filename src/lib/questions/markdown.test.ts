import { describe, expect, it } from 'vitest'
import { markdownToPlainText } from './markdown'

describe('markdownToPlainText', () => {
  it('turns links into their text', () => {
    expect(markdownToPlainText('See [the harbour](https://example.com/harbour) today.')).toBe(
      'See the harbour today.',
    )
  })

  it('handles parentheses in the URL and a link title (Wikipedia style)', () => {
    const md = 'For other uses, see [Tide (disambiguation)](/wiki/Tide_(disambiguation) "Tide (disambiguation)").'
    expect(markdownToPlainText(md)).toBe('For other uses, see Tide (disambiguation).')
  })

  it('removes footnote markers, escaped and linked (Wikipedia style)', () => {
    expect(markdownToPlainText('High water.[\\[1\\]](#cite_note-1) Low water.\\[2\\]')).toBe(
      'High water. Low water.',
    )
  })

  it('removes adjacent footnote markers', () => {
    expect(markdownToPlainText('Tides vary daily.[12][13] They also vary yearly.')).toBe(
      'Tides vary daily. They also vary yearly.',
    )
  })

  it('leaves bracketed text that is not a number alone', () => {
    expect(markdownToPlainText('The keeper [later the harbour master] wrote [a] note in [1871a].')).toBe(
      'The keeper [later the harbour master] wrote [a] note in [1871a].',
    )
  })

  it('drops images, including linked images', () => {
    const md = 'Before ![A tide chart](https://example.com/chart.png "Chart") and [![Logo](/logo.svg)](/home) after.'
    expect(markdownToPlainText(md)).toBe('Before and after.')
  })

  it('strips heading, quote and emphasis markers', () => {
    const md = '## The clock\n\n> **Bold** claim, _quietly_ made, with `code` and snake_case kept.'
    expect(markdownToPlainText(md)).toBe('The clock\n\nBold claim, quietly made, with code and snake_case kept.')
  })

  it('collapses whitespace but keeps one blank line between paragraphs', () => {
    const md = '  First   line\twith  gaps  \n\n\n\n  Second paragraph \n continues here.  '
    expect(markdownToPlainText(md)).toBe('First line with gaps\n\nSecond paragraph\ncontinues here.')
  })

  it('leaves plain text unchanged', () => {
    const text = 'The clock face was painted in three colours.\n\nA red band meant the channel was too shallow.'
    expect(markdownToPlainText(text)).toBe(text)
  })
})
