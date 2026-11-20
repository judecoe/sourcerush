/**
 * /room/:roomId: the whole game, for host and players alike.
 *
 * Everything shown comes from live records (rooms, players, the current
 * question, and the caller's own submission), so a refresh rebuilds any
 * state. The server only sends these rows to members of this room; a
 * non-member gets nothing back and sees the "not in this room" card.
 *
 * All writes go through server actions (callAction). The host sees the same
 * view as everyone else, plus Start/Next and "answered X of N".
 */

import type { ReactNode } from 'react'
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth, useMutations, useQuery } from 'deepspace'
import { useAutoReveal, useGeneratingTooLong, useJustFinishedGenerating, useMsLeft } from '@/components/game/hooks'
import { DailyResult } from '@/components/game/DailyResult'
import { GameSummary } from '@/components/game/GameSummary'
import { OpenQuestionButton } from '@/components/game/OpenQuestionButton'
import { GeneratingStatus } from '@/components/game/GeneratingStatus'
import { HostNamePrompt } from '@/components/game/HostNamePrompt'
import { Leaderboard } from '@/components/game/Leaderboard'
import { Lobby } from '@/components/game/Lobby'
import { SourceLink } from '@/components/game/SourceLink'
import { QuestionView } from '@/components/game/QuestionView'
import { RevealView } from '@/components/game/RevealView'
import { buttonVariants } from '@/components/ui'
import type { Player, Question, Room, Submission } from '@/components/game/types'

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const { userId } = useAuth()
  // We never write records from the client; `ready` means the record room
  // has enrolled this user, so buttons stay disabled until then.
  const { ready } = useMutations('rooms')

  const rooms = useQuery<Room>('rooms', { where: { roomId }, limit: 1 })
  const players = useQuery<Player>('players', {
    where: { roomId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
  const room = rooms.records[0]?.data
  const generatingTooLong = useGeneratingTooLong(rooms.records[0]?.createdAt, room?.status === 'generating')
  const justFinishedGenerating = useJustFinishedGenerating(room?.status)

  // The current question (its id is `${roomId}:${index}`, same as the server).
  const index = room?.currentIndex ?? -1
  const questionId = index >= 0 ? `${roomId}:${index}` : null
  const questions = useQuery<Question>('questions', { where: { roomId, index }, limit: 1 })
  const question = questions.records[0]?.data
  // Only our own row ever comes back (submissions are owner-read only).
  const submissions = useQuery<Submission>('submissions', { where: { questionId: questionId ?? '' }, limit: 1 })
  const mySubmission = submissions.records[0]?.data

  const msLeft = useMsLeft(room?.status === 'question' ? room.endsAt : undefined)
  const secondsLeft = Math.ceil(msLeft / 1000)
  const playerCount = players.records.length
  const everyoneAnswered = playerCount > 0 && (room?.answeredCount ?? 0) >= playerCount
  // useMsLeft returns 0 when it has no endsAt, so only a question with a
  // known endsAt counts as "time's up".
  const timeUp = room?.status === 'question' && room.endsAt !== undefined && msLeft === 0
  useAutoReveal(roomId, room?.status, questionId, timeUp || everyoneAnswered)

  const isHost = !!room && !!userId && room.hostId === userId

  // Right after createRoom, the create page navigates here with
  // `state.askName`, so the host picks their name before the lobby shows.
  // It lives in browser history, so a refresh keeps the prompt; Continue
  // replaces the entry without it. Other ways in (join, Return to room)
  // never ask.
  const location = useLocation()
  const navigate = useNavigate()
  const askName = isHost && (location.state as { askName?: boolean } | null)?.askName === true
  const namePrompt = askName ? (
    <HostNamePrompt
      roomId={roomId}
      ready={ready}
      onDone={() => navigate(location.pathname, { replace: true, state: null })}
    />
  ) : null
  /** While generating, the prompt sits above the progress list. */
  const withNamePrompt = (node: ReactNode) =>
    namePrompt ? (
      <div className="space-y-6">
        {namePrompt}
        {node}
      </div>
    ) : (
      node
    )

  const hostNewGameLink = (
    <Link to="/create" className={buttonVariants({ className: 'mt-4' })}>
      Host a new game
    </Link>
  )

  let body: ReactNode
  if (rooms.status === 'loading' || players.status === 'loading') {
    body = <p className="text-muted-foreground">Loading room…</p>
  } else if (!room) {
    body = (
      <div data-testid="not-member" className="rounded-lg border border-border bg-card p-6 shadow-card">
        <p className="font-semibold">You're not in this room.</p>
        <Link to="/join" className="mt-2 inline-block text-sm text-primary underline underline-offset-4">
          Join with a code
        </Link>
      </div>
    )
  } else if (room.status === 'generating' && generatingTooLong) {
    // The job may still finish; if it does, this page moves to the lobby by itself.
    body = (
      <div data-testid="generating-too-long" className="rounded-lg border border-border bg-card p-6 shadow-card">
        <p className="font-semibold">This is taking longer than expected.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The questions may still arrive, and this page will update if they do. Or start again with another
          article.
        </p>
        {hostNewGameLink}
      </div>
    )
  } else if (room.status === 'generating') {
    body = withNamePrompt(
      <GeneratingStatus generationStep={room.generationStep} createdAt={rooms.records[0]?.createdAt} />,
    )
  } else if (room.status === 'failed') {
    body = (
      <div data-testid="failed" className="rounded-lg border-2 border-destructive bg-card p-6">
        <p className="font-semibold">This room couldn't be set up.</p>
        <p className="mt-2 text-sm">{room.errorMessage || 'Something went wrong.'}</p>
        {hostNewGameLink}
      </div>
    )
  } else if (room.status === 'lobby' && justFinishedGenerating) {
    // A moment with every step ticked before the lobby appears.
    body = withNamePrompt(
      <GeneratingStatus generationStep={room.generationStep} createdAt={rooms.records[0]?.createdAt} complete />,
    )
  } else if (room.status === 'lobby' && namePrompt) {
    // The lobby (and the code) waits until the host has chosen a name.
    body = namePrompt
  } else if (room.status === 'lobby' && room.dailyDay) {
    // Quiz of the Day: a solo room, so no code to share and no player list.
    body = (
      <div data-testid="daily-lobby" className="animate-enter space-y-6">
        <header>
          <p className="font-display text-xs font-bold uppercase tracking-widest text-primary">Quiz of the Day</p>
          {room.sourceTitle && <h1 className="mt-1 text-2xl font-bold">{room.sourceTitle}</h1>}
          <p className="mt-2 text-sm text-muted-foreground">60 seconds per question. Your first attempt is the one that counts.</p>
        </header>
        {isHost && <OpenQuestionButton roomId={room.roomId} ready={ready} label="Start" />}
      </div>
    )
  } else if (room.status === 'finished' && room.dailyDay) {
    body = (
      <div data-testid="finished" className="animate-enter space-y-6">
        <div className="space-y-2">
          <p className="font-display text-xs font-bold uppercase tracking-widest text-primary">Quiz of the Day</p>
          <h1 className="text-2xl font-bold">Game over</h1>
          <SourceLink room={room} />
        </div>
        <DailyResult day={room.dailyDay} />
        <GameSummary roomId={roomId} />
        <Link to="/home" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
          Back to home
        </Link>
      </div>
    )
  } else if (room.status === 'lobby') {
    body = <Lobby room={room} players={players.records} userId={userId} isHost={isHost} ready={ready} />
  } else if (room.status === 'finished') {
    body = (
      <div data-testid="finished" className="animate-enter space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Game over</h1>
          <SourceLink room={room} />
        </div>
        <Leaderboard players={players.records} userId={userId} />
        <GameSummary roomId={roomId} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link to="/create" className={buttonVariants({ className: 'flex-1' })}>
            Host a new game
          </Link>
          <Link to="/home" className={buttonVariants({ variant: 'outline', className: 'flex-1' })}>
            Back to home
          </Link>
        </div>
      </div>
    )
  } else if (!question || !questionId) {
    // 'question' or 'reveal', but the question row hasn't synced yet.
    body = <p className="text-muted-foreground">Loading question…</p>
  } else if (room.status === 'question') {
    body = (
      <QuestionView
        key={questionId}
        room={room}
        questionId={questionId}
        question={question}
        mySubmission={mySubmission}
        playerCount={playerCount}
        secondsLeft={secondsLeft}
        isHost={isHost}
        ready={ready}
      />
    )
  } else {
    body = (
      <RevealView
        room={room}
        question={question}
        mySubmission={mySubmission}
        players={players.records}
        userId={userId}
        isHost={isHost}
        ready={ready}
      />
    )
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-md px-4 py-8 sm:py-16">{body}</div>
    </div>
  )
}
