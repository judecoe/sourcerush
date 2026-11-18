/**
 * /create: start a new room and go to it. The caller becomes the host.
 *
 * Three ways in: paste an article link, or type a topic and let the server
 * find an article (both generate questions in the background, so the room
 * page shows "Generating questions…" first), or "Try it yourself"
 * (TryItYourselfButton, shared with /home), which uses a built-in sample
 * article and is ready at once.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { MAX_TOPIC_LENGTH } from '@/lib/create-room-params'
import { callAction } from '@/lib/call-action'
import { ReturnToRoomLink } from '@/components/game/ReturnToRoomLink'
import { TryItYourselfButton } from '@/components/game/TryItYourselfButton'

export default function CreateRoomPage() {
  const navigate = useNavigate()
  // We don't write records from the client, but `ready` tells us the record
  // room has enrolled this user, so the server can read their profile.
  const { ready } = useMutations('rooms')
  const [url, setUrl] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState<'url' | 'topic' | 'sample' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent, kind: 'url' | 'topic') {
    event.preventDefault()
    setBusy(kind)
    setError(null)
    const params = kind === 'url' ? { url: url.trim() } : { topic: topic.trim() }
    const result = await callAction<{ roomId: string; code: string }>('createRoom', params)
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
          Paste a link to an article, or type a topic and we'll find one. We'll write questions from it, and
          you'll get a 6-character code to share with players.
        </p>
        <form onSubmit={(e) => void create(e, 'url')} className="space-y-3">
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
        <form onSubmit={(e) => void create(e, 'topic')} className="mt-6 space-y-3">
          <Label htmlFor="topic" className="block">
            Or a topic
          </Label>
          <Input
            id="topic"
            type="text"
            placeholder="e.g. how lighthouses work"
            maxLength={MAX_TOPIC_LENGTH}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={busy !== null}
          />
          <Button type="submit" disabled={!ready || busy !== null || !topic.trim()} className="w-full">
            {busy === 'topic' ? 'Creating…' : 'Find an article'}
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
            disabled={busy === 'url' || busy === 'topic'}
            onBusyChange={(sampleBusy) => setBusy(sampleBusy ? 'sample' : null)}
          />
        </div>
      </div>
    </div>
  )
}
