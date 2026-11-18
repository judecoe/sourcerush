/**
 * "Article: <title>", linked to the article when the room has a sourceUrl.
 * Shown only on the finished (Game over) screen: a link in the lobby would
 * invite opening the article during rounds, so the lobby shows the plain
 * title. The sample room has no link, so it shows the title only. Renders
 * nothing without a title.
 */

import type { Room } from './types'

export function SourceLink({ room }: { room: Room }) {
  if (!room.sourceTitle) return null
  // The server only stores http(s) links; check again so a bad value can
  // never become a javascript: link.
  const href = room.sourceUrl && /^https?:\/\//i.test(room.sourceUrl) ? room.sourceUrl : null
  return (
    <p data-testid="source" className="text-sm text-muted-foreground">
      Article:{' '}
      {href ? (
        <a
          data-testid="source-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {room.sourceTitle}
        </a>
      ) : (
        room.sourceTitle
      )}
    </p>
  )
}
