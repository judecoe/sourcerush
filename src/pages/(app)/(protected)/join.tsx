/**
 * /join: enter a room code, join as a player, and go to the room's lobby.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { callAction } from '@/lib/call-action'

export default function JoinRoomPage() {
  const navigate = useNavigate()
  // See create.tsx: `ready` means the record room has enrolled this user.
  const { ready } = useMutations('players')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleJoin(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await callAction<{ roomId: string }>('joinRoom', { code })
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
        <Button
          type="submit"
          disabled={!ready || busy || code.trim().length !== 6}
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
