@AGENTS.md

# SourceRush

Real-time multiplayer quiz built on DeepSpace. A host pastes an article URL, the server generates questions grounded in that article, players join by room code and answer against a shared timer, and each reveal shows the exact source passage behind the answer.

## How to work in this repo

This is an internship build exercise. I (the human) have to explain and modify every line in a live session, so:

- Prefer plain, readable code over clever abstractions. No new dependencies without asking.
- Keep changes small and scoped to the task I gave you. Don't refactor unrelated code.
- **Stop and ask before** changing the data model, permissions, the scoring rules, the state machine, or adding an integration.
- Never claim something works because it compiles. Say what you ran and what you did not verify.
- After each task, append an entry to `AGENT_LOG.md`:

```
## <date> — <task>
Did: <what you changed, files touched>
Verified: <commands run, results>
Not verified / risks: <anything I should check myself>
```

## DeepSpace: read before building

Use the official skill (github.com/deepdotspace/deepspace-skill) and docs.deep.space as the authority. Don't guess APIs from memory.

1. Fetch `https://docs.deep.space/llms.txt` for the page index, then open 1–2 relevant pages by appending `.md` to the URL.
2. Read `/concepts/*` before touching `worker.ts`, schemas, permissions, or sync behavior.
3. For exact signatures, read `node_modules/deepspace/dist/*.d.ts`. It wins over any doc.
4. Check catalogs before hand-building: `npx deepspace add --list`, `npx deepspace integrations list`, `npx deepspace integrations info <integration>/<endpoint>`.
   Platform rules that matter here:

- Records are envelopes: fields live under `record.data`; `put(id, patch)` merges server-side.
- Disable write controls until `useMutations().ready`.
- Data/auth hooks only inside the `(app)/` provider boundary.
- Keep the scaffold's `users` schema. Extend it, don't rename it.
- Caller identity comes only from the verified JWT. Never trust a userId sent by the client.
- Secrets only via `npx deepspace secrets`. Never in `.dev.vars`, code, logs, or commits.

## Source control: GitHub is the authority

The repo is submitted on GitHub. DeepSpace latches the source authority permanently on the first source-producing action.

- **Never run `npx deepspace push`.**
- Deploy only from a checkout with the GitHub remote set.
- Deploys ship the local working tree, so commit before deploying.
- This overrides AGENTS.md, which lists `npx deepspace push` and says not to set up GitHub unless asked. For this repo, GitHub is required.

## Commands

```bash
npx deepspace dev start     # local dev
npx deepspace test run      # quick tests
npx deepspace test run all  # all specs
npx deepspace deploy        # ship to <name>.app.space
npx deepspace logs --follow --json
```

## Architecture

The core rule: **anything synced to a client is readable by that client**, even if the UI hides it. Every write that affects game state or scoring goes through a server action.

| Collection    | Key fields                                                                   | Read                      | Write  |
| ------------- | ---------------------------------------------------------------------------- | ------------------------- | ------ |
| `rooms`       | roomId (= its own record id), code, hostId, status, sourceTitle, currentIndex, endsAt, answeredCount | room members | server |
| `players`     | roomId, userId, displayName, score; id = `${roomId}:${userId}`               | room members              | server |
| `team_members`| teamId (= roomId), userId, status; id = `${roomId}:${userId}`                | **server only**           | server |
| `questions`   | roomId, index, prompt, choices, reveal                                       | room members, once opened | server |
| `answerKeys`  | questionId, correctIndex, passage, explanation                               | **server only**           | server |
| `submissions` | questionId, userId, choiceIndex, submittedAt; id = `${questionId}:${userId}` | own row until reveal      | server |
| `sources`     | roomId, title, fullText                                                      | **server only**           | server |

"Room members" is enforced with the SDK's `'team'` read level: `teamField: 'roomId'` on each room-scoped collection, resolved against `team_members` (the SDK requires that exact name and the `teamId`/`userId`/`status` columns). The host and every player get a `team_members` row; the host has no `players` row. Don't use `teamField: '_rowId'`: the SDK honours it for queries but not for live updates, which is why `rooms` stores its own id in `roomId`.

Gotchas:

- **`tools.create` with an explicit id overwrites an existing row.** It doesn't fail: it merges the new data over the old row (`server.js` `putRecord`: `isUpdate = existing !== null`). `uniqueOn` does not stop this, because its conflict check excludes the row's own id. The only thing that rejects it is an `immutable` column whose value differs (`Cannot modify immutable field`), and that check runs for server actions too.
- A user who becomes a room member while a page is already subscribed won't receive pre-existing rows on that page until it resubscribes (SDK issue, see AGENT_LOG.md). Navigate to a fresh page after joining.

Room status: `generating → lobby → question → reveal → question → … → finished`. Server actions reject anything that doesn't match the current status.

Server actions:

- `createRoom(sourceUrl)`: create room as `generating`, run the question pipeline, return to `lobby`.
- `joinRoom(code)`: add a `players` row for the verified caller.
- `openQuestion(roomId)`: host only; create the `questions` record (no answer in it) and set `endsAt` from the server clock.
- `submitAnswer(questionId, choiceIndex)`: member check, status is `question`, server time < `endsAt`, no existing submission; increment `answeredCount`.
- `revealQuestion(roomId)`: allowed when server time ≥ `endsAt` or everyone answered; any member may call it. Score from server timestamps, update `players.score`, merge `reveal: { correctIndex, passage, explanation }` into the question.
  Rounds close by rejection, not by a server timer: late submissions fail in `submitAnswer`, and a client calls `revealQuestion` when its countdown ends. Clients only display the countdown; the server enforces it.

**Answered: DeepSpace can make a collection unreadable to clients.** Set `read: false` for `'*'`, `viewer`, `member` and `admin`. Tested on `team_members`: a raw `core.subscribe` sent on each signed-in user's own records socket returned no rows. Server actions can still read it. So `answerKeys` and `sources` stay as synced records with that permission. Caveats: tested on local dev with non-owner accounts only (the admin role is untested), and a hidden collection only helps if nothing copies its data into a readable one. Evidence: AGENT_LOG.md, entry "2026-11-17 — rooms + players, createRoom / joinRoom, create/join/lobby pages" (Verified (b) and the "Answer to the CLAUDE.md open question" paragraph).

Plan notes for `submitAnswer` (Thursday; not built yet):

- `submissions`: every field `immutable`, plus an immutable `attemptId = crypto.randomUUID()` set by the server on each call. Every second create for the same `${questionId}:${userId}` then carries a different `attemptId` and is rejected inside one `putRecord` call (`Cannot modify immutable field`), even if the other fields are identical.
- `answeredCount` is display-only. `revealQuestion`'s "everyone answered" check counts `submissions` server-side; it never trusts `answeredCount`.
- Required test: two concurrent `submitAnswer` calls for the same user and question. Exactly one succeeds, the other is rejected, and the stored `choiceIndex` is the first one's.

## Invariants (never break these)

1. A client can never read a correct answer before its reveal.
2. A client can never write a score, a reveal, or another player's submission.
3. One submission per player per question.
   The deterministic id `${questionId}:${userId}` alone does NOT guarantee this: a second `tools.create` with the same id silently overwrites the first, and `uniqueOn` won't object. A check-then-create in an action is also not atomic: the `tools.get` and `tools.create` are separate requests, so two concurrent calls can both pass the check. The design must make the second write fail inside a single `putRecord` call, or otherwise be harmless.
4. No submission is accepted after `endsAt` (server time).
5. Host-only actions check host identity on the server.
6. Refreshing the page mid-game restores the full state from records.

## Question pipeline

Pure, unit-tested modules in `src/lib/questions/`:

- `prompt.ts`: `buildQuestionPrompt()` returns `system`, `user`, and `sourceUsed` (the trimmed text the model saw).
- `validate.ts`: `parseModelOutput()`, `validateQuestions()`, `shuffleChoices()`.
  Flow: Firecrawl scrape → `buildQuestionPrompt` → Anthropic integration → `parseModelOutput` → `validateQuestions(candidates, sourceUsed)` → `shuffleChoices` each → store. Validate against `sourceUsed`, not the untrimmed text. If fewer than `QUESTIONS_MIN_USABLE` remain, regenerate once, then fail the room with a clear error. Log rejection reasons.

Don't put SDK or integration calls inside these modules. Keep them pure so the tests stay fast.

## Testing

- Unit: `src/lib/questions/validate.test.ts` (Vitest). Run after any pipeline change.
- Integrity checks, run with two different signed-in users:
  1. Query `answerKeys` and `sources` from a player client: nothing returned.
  2. Submit twice: counted once.
  3. Submit after the timer: rejected.
  4. Call `openQuestion` as a player: refused.
  5. Full game in two browsers, including a mid-round refresh.

## Out of scope unless I say otherwise

ElevenLabs voice, payments, custom domains, question editing, chat, persistent stats across games.
