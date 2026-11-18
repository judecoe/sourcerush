/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * Keep it that way: no auth, record or mutation hooks here, and no action
 * calls. Every action on this page is a plain link.
 *
 * "Play a sample game →" links to /home, not /create: Google/GitHub sign-in always
 * lands on /home, so linking there means email and OAuth sign-in end up on
 * the same page, where the visitor presses the Try-it button. Loading a page
 * never creates a room.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { buttonVariants } from '@/components/ui'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const HOW_IT_WORKS = [
  'Paste a link to an article.',
  'We write questions grounded in that article.',
  'Everyone answers on their phone against the same timer.',
  'Every reveal shows the source passage behind the answer.',
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="mx-auto max-w-md px-4 py-12 text-foreground">
        <div className="animate-enter-hero">
          <p className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-primary">{APP_NAME}</p>
          <h1 className="mb-8 text-3xl font-bold tracking-tight">
            Turn any article into a live quiz, with the source passage behind every answer.
          </h1>
        </div>

        <div className="animate-enter-hero enter-delay-1 space-y-3">
          <Link to="/create" className={buttonVariants({ className: 'w-full' })}>
            Create a room
          </Link>
          <Link to="/join" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
            Join a room
          </Link>
        </div>

        <div className="animate-enter-hero enter-delay-1 mt-8 border-t border-border pt-6">
          <Link to="/home" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
            Play a sample game →
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">A short sample article. Play it on your own.</p>
        </div>

        <h2 className="animate-enter-hero enter-delay-2 mb-3 mt-10 text-lg font-semibold">How it works</h2>
        <ol className="animate-enter-hero enter-delay-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground marker:font-mono marker:text-primary">
          {HOW_IT_WORKS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="animate-enter-hero enter-delay-2 mt-4 text-sm text-muted-foreground">
          Play alone, or share the room code so friends can join.
        </p>
      </div>
    </>
  )
}
