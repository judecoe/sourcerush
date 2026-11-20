/**
 * /home: the signed-in hub. The Quiz of the Day card (today's numbers and a
 * link to /daily), then create a room, join one, or try the sample.
 *
 * Every sign-in lands here: Google/GitHub sign-in always redirects to /home
 * (src/server/http-routes.ts, oauth-complete), which is why the Quiz of the
 * Day card is here: the landing page links to /daily, but a Google/GitHub
 * sign-in from there lands on /home.
 *
 * The page is public (it sits under (app)/, not (protected)/), so it gates
 * itself with the same AuthGate + SignedOutPanel the protected pages use.
 * Signed-out visitors see only that panel, never the Try-it button.
 */

import { Link } from 'react-router-dom'
import { AuthGate } from 'deepspace'
import { buttonVariants } from '@/components/ui'
import { SignedOutPanel } from '@/components/SignedOutPanel'
import { DailyCard } from '@/components/game/DailyCard'
import { ReturnToRoomLink } from '@/components/game/ReturnToRoomLink'
import { TryItYourselfButton } from '@/components/game/TryItYourselfButton'

export default function HomePage() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <div className="min-h-full text-foreground">
        <div className="mx-auto max-w-md px-4 py-12">
          <ReturnToRoomLink />
          <DailyCard />
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
