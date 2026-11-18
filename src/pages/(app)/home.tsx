/**
 * /home: the signed-in hub. Create a room, join one, or try the sample.
 *
 * Every sign-in lands here: Google/GitHub sign-in always redirects to /home
 * (src/server/http-routes.ts, oauth-complete), and the landing page's
 * "Play a sample game →" links here so email sign-in ends up on the same page.
 *
 * The page is public (it sits under (app)/, not (protected)/), so it gates
 * itself with the same AuthGate + SignedOutPanel the protected pages use.
 * Signed-out visitors see only that panel, never the Try-it button.
 */

import { Link } from 'react-router-dom'
import { AuthGate } from 'deepspace'
import { buttonVariants } from '@/components/ui'
import { SignedOutPanel } from '@/components/SignedOutPanel'
import { ReturnToRoomLink } from '@/components/game/ReturnToRoomLink'
import { TryItYourselfButton } from '@/components/game/TryItYourselfButton'

export default function HomePage() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <div className="min-h-full text-foreground">
        <div className="mx-auto max-w-md px-4 py-12">
          <ReturnToRoomLink />
          <h1 className="mb-2 text-3xl font-bold tracking-tight">Start a game</h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Host one from an article, join with a code, or play a short sample on your own.
          </p>
          <div className="space-y-3">
            <Link to="/create" className={buttonVariants({ className: 'w-full' })}>
              Create a room
            </Link>
            <Link to="/join" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              Join a room
            </Link>
          </div>
          <div className="mt-8 border-t border-border pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Start a sample game: you host and play; share the code to add friends.
            </p>
            <TryItYourselfButton />
          </div>
        </div>
      </div>
    </AuthGate>
  )
}
