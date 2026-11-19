/**
 * /join: enter a room code and your name, join as a player, and go to the
 * room's lobby. The name is prefilled with your current one; a changed name
 * is sent to joinRoom, which uses it in this room and saves it for next time.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { ReturnToRoomLink } from '@/components/game/ReturnToRoomLink'
import { useMyDisplayName } from '@/components/game/hooks'
import { DISPLAY_NAME_MAX, parseDisplayName } from '@/lib/display-name'

export default function JoinRoomPage() {
  const navigate = useNavigate()
  // See create.tsx: `ready` means the record room has enrolled this user.
  const { ready } = useMutations('players')
  const [code, setCode] = useState('')
  const { name: currentName, loading: nameLoading } = useMyDisplayName()
  // null = untouched, so the field shows the current name.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const name = nameDraft ?? currentName
  const parsedName = parseDisplayName(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleJoin(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    // Send the name only if it was changed, so an unchanged one isn't saved.
    const changed = parsedName.ok && parsedName.name !== currentName
    const params = changed ? { code, name } : { code }
    const result = await callAction<{ roomId: string }>('joinRoom', params)
    if (result.success) {
      navigate(`/room/${result.data.roomId}`)
    } else {
      setError(result.error)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <form onSubmit={handleJoin} className="mx-auto max-w-md px-6 py-20">
        <ReturnToRoomLink />
        <h1 className="mb-8 text-3xl font-bold tracking-tight">Join a game</h1>
        <Label htmlFor="room-code">Room code</Label>
        <Input
          id="room-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="ABC234"
          className="mt-2 font-mono text-lg tracking-widest"
        />
        <Label htmlFor="join-name" className="mt-6 block">
          Your name
        </Label>
        <Input
          id="join-name"
          data-testid="join-name"
          value={name}
          onChange={(e) => setNameDraft(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          className="mt-2"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Shown in the lobby and on the leaderboard. A new name is saved for next time.
        </p>
        <Button
          type="submit"
          disabled={!ready || busy || nameLoading || !parsedName.ok || code.trim().length !== 6}
          className="mt-4 w-full"
        >
          {busy ? 'Joining…' : 'Join'}
        </Button>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
