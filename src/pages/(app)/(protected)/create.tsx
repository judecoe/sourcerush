/**
 * /create: start a new room and go to it. The caller becomes the host.
 *
 * Two ways in: paste an article link (questions are generated in the
 * background, so the room page shows "Generating questions…" first), or
 * "Try it yourself" (TryItYourselfButton, shared with /home), which uses a
 * built-in sample article and is ready at once.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { ReturnToRoomLink } from '@/components/game/ReturnToRoomLink'
import { TryItYourselfButton } from '@/components/game/TryItYourselfButton'

export default function CreateRoomPage() {
  const navigate = useNavigate()
  // We don't write records from the client, but `ready` tells us the record
  // room has enrolled this user, so the server can read their profile.
  const { ready } = useMutations('rooms')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'url' | 'sample' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy('url')
    setError(null)
    const result = await callAction<{ roomId: string; code: string }>('createRoom', { url: url.trim() })
    if (result.success) {
      navigate(`/room/${result.data.roomId}`)
    } else {
      setError(result.error)
      setBusy(null)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-md px-6 py-20">
        <ReturnToRoomLink />
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Host a game</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Paste a link to an article. We'll write questions from it, and you'll get a 6-character code to
          share with players.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <Label htmlFor="article-url" className="block">
            Article link
          </Label>
          <Input
            id="article-url"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy !== null}
          />
          <Button type="submit" disabled={!ready || busy !== null || !url.trim()} className="w-full">
            {busy === 'url' ? 'Creating…' : 'Create room'}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-8 border-t border-border pt-6">
          <p className="mb-3 text-sm text-muted-foreground">No article handy? Play a short sample one.</p>
          <TryItYourselfButton
            disabled={busy === 'url'}
            onBusyChange={(sampleBusy) => setBusy(sampleBusy ? 'sample' : null)}
          />
        </div>
      </div>
    </div>
  )
}
