/**
 * "Try it yourself": creates a room from the built-in sample article and goes
 * to it. This is the app's only createRoom({ sample: true }) call; /create and
 * /home both render this button.
 *
 * A room is only created when the button is pressed, never on page load.
 * The button stays disabled until useMutations('rooms').ready (the record room
 * has enrolled this user, so the server can read their profile) and while the
 * call is running. Errors show in the role="alert" line under the button.
 *
 * Must render inside the (app)/ provider boundary, for a signed-in user.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations } from 'deepspace'
import { Button } from '@/components/ui'
import { callAction } from '@/lib/call-action'

interface TryItYourselfButtonProps {
  /** Extra reason to disable it, e.g. /create's link form is submitting. */
  disabled?: boolean
  /** Called with true when the call starts and false if it fails, so a page can lock its other controls. */
  onBusyChange?: (busy: boolean) => void
}

export function TryItYourselfButton({ disabled = false, onBusyChange }: TryItYourselfButtonProps) {
  const navigate = useNavigate()
  const { ready } = useMutations('rooms')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    const result = await callAction<{ roomId: string; code: string }>('createRoom', { sample: true })
    if (result.success) {
      navigate(`/room/${result.data.roomId}`)
    } else {
      setError(result.error)
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void handleClick()}
        disabled={!ready || busy || disabled}
        className="w-full"
      >
        {busy ? 'Creating…' : 'Try it yourself'}
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
