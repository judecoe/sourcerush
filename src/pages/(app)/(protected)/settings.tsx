/**
 * /settings: your display name, account details and sign out. No auth logic
 * lives here because (protected)/_layout.tsx already wraps the subtree in
 * <AuthGate>.
 *
 * The display name is saved through the setDisplayName server action, which
 * validates it and renames you in any room still in its lobby. Your sign-in
 * name (from Google/GitHub/email) is shown below it and can't be changed.
 */

import { useState, type FormEvent } from 'react'
import { signOut, useMutations, useUser } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { DISPLAY_NAME_MAX, parseDisplayName } from '@/lib/display-name'
import { useMyDisplayName } from '@/components/game/hooks'

export default function SettingsPage() {
  const { user } = useUser()
  // We never write records from the client; `ready` means the record room
  // has enrolled this user, so Save stays disabled until then.
  const { ready } = useMutations('users')
  const { name: currentName, loading } = useMyDisplayName()

  // null = the field hasn't been touched, so it shows the current name.
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const value = draft ?? currentName
  const parsed = parseDisplayName(value)
  const unchanged = parsed.ok && parsed.name === currentName

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const result = await callAction<{ displayName: string }>('setDisplayName', { name: value })
    setBusy(false)
    if (result.success) {
      setDraft(null)
      setSaved(true)
    } else {
      setError(result.error)
    }
  }

  return (
    // No background on page wrappers — pages render into whatever the app's
    // (app)/_layout provides (a plain background, or a raised panel), so they
    // stay transparent and inherit it.
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-20">
        <h1 className="mb-6 text-4xl font-bold tracking-tight">Settings</h1>

        <form onSubmit={handleSave} className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-1 text-lg font-semibold">Display name</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            What other players see in the lobby and on the leaderboard. Games that have already started keep
            your old name.
          </p>
          <Label htmlFor="display-name">Name</Label>
          <Input
            id="display-name"
            data-testid="display-name-input"
            value={value}
            onChange={(e) => {
              setDraft(e.target.value)
              setSaved(false)
            }}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="nickname"
            className="mt-2"
          />
          <Button
            type="submit"
            disabled={!ready || busy || loading || !parsed.ok || unchanged}
            className="mt-4"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p data-testid="display-name-saved" role="status" className="mt-4 text-sm text-success">
              Saved.
            </p>
          )}
        </form>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Your account</h2>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Sign-in name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>
      </div>
    </div>
  )
}
