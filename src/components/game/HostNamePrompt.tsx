/**
 * Shown to the host right after they create a room, before the lobby (and
 * its code) appears: "Your name in this game", prefilled with their current
 * name. Continue with it unchanged just closes the prompt. A changed name
 * goes to setDisplayName({ name, roomId }), which renames the host in this
 * room and saves the name for next time.
 *
 * The room page decides when to show it (see `askName` there).
 */

import { useState, type FormEvent } from 'react'
import { Button, Input, Label } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { DISPLAY_NAME_MAX, parseDisplayName } from '@/lib/display-name'
import { useMyDisplayName } from './hooks'

type Props = {
  roomId: string
  ready: boolean
  onDone: () => void
}

export function HostNamePrompt({ roomId, ready, onDone }: Props) {
  const { name: currentName, loading } = useMyDisplayName()
  // null = untouched, so the field shows the current name.
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = draft ?? currentName
  const parsed = parseDisplayName(value)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!parsed.ok) return
    if (parsed.name === currentName) {
      onDone()
      return
    }
    setBusy(true)
    setError(null)
    const result = await callAction('setDisplayName', { name: value, roomId })
    if (result.success) {
      onDone()
    } else {
      setError(result.error)
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      data-testid="host-name-prompt"
      className="animate-enter rounded-lg border border-border bg-card p-6 shadow-card"
    >
      <h1 className="mb-1 text-xl font-bold">Your name in this game</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Players will see it in the lobby and on the leaderboard. A new name is saved for next time.
      </p>
      <Label htmlFor="host-name">Your name</Label>
      <Input
        id="host-name"
        data-testid="host-name"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="nickname"
        className="mt-2"
      />
      <Button type="submit" disabled={!ready || busy || loading || !parsed.ok} className="mt-4 w-full">
        {busy ? 'Saving…' : 'Continue'}
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
