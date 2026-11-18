/**
 * /create: start a new room and go to its lobby. The caller becomes the host.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations } from 'deepspace'
import { Button } from '@/components/ui'
import { callAction } from '@/lib/call-action'

export default function CreateRoomPage() {
  const navigate = useNavigate()
  // We don't write records from the client, but `ready` tells us the record
  // room has enrolled this user, so the server can read their profile.
  const { ready } = useMutations('rooms')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setBusy(true)
    setError(null)
    const result = await callAction<{ roomId: string; code: string }>('createRoom')
    if (result.success) {
      navigate(`/room/${result.data.roomId}`)
    } else {
      setError(result.error)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Host a game</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          You'll get a 6-character code to share with players.
        </p>
        <Button onClick={handleCreate} disabled={!ready || busy} className="w-full">
          {busy ? 'Creating…' : 'Create room'}
        </Button>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
