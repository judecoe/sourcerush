/**
 * Host control: Start (in the lobby) and Next (after a reveal). Both call
 * openQuestion, which checks on the server that the caller is the host and
 * finishes the game when there are no questions left.
 */

import { useState } from 'react'
import { Button } from '@/components/ui'
import { callAction } from '@/lib/call-action'

type Props = {
  roomId: string
  ready: boolean
  label: string
}

export function OpenQuestionButton({ roomId, ready, label }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    const result = await callAction('openQuestion', { roomId })
    if (!result.success) setError(result.error)
    // On success the room record changes and this button unmounts.
    setBusy(false)
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={!ready || busy} size="lg" className="w-full">
        {busy ? 'Please wait…' : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
