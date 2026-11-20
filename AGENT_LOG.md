# Agent log

## 2026-11-17 — rooms + players, createRoom / joinRoom, create/join/lobby pages

Did:
- Schemas, all writes server-only (no client role can create/update/delete):
  - `src/schemas/rooms-schema.ts`: all columns from the CLAUDE.md table, plus `roomId` (the record's own id). `uniqueOn: ['code']`, `teamField: 'roomId'`, read `'team'`.
  - `src/schemas/players-schema.ts`: record id `${roomId}:${userId}`, `uniqueOn: ['roomId','userId']`, `teamField: 'roomId'`, read `'team'`.
  - `src/schemas/team-members-schema.ts`: **new collection (approved, option A)**. The SDK's `'team'` level reads this exact name and these columns (`teamId`, `userId`, `status`). Record id `${roomId}:${userId}`. Every role is `false` for everything.
  - Registered in `src/schemas.ts`. Admin (app owner) gets `'team'`, not `true`.
- **Deviation from the approved plan:** the plan said `teamField: '_rowId'` on rooms. The SDK honours `'_rowId'` only in the query path; the per-record check used for live broadcasts reads `record.data._rowId`, which doesn't exist (`node_modules/deepspace/dist/server.js` ~L5281 vs `checkPermissionLevel`). So members other than the host would get no live room updates. Added a `rooms.roomId` column instead. Same semantics, one extra column.
- `src/actions/index.ts`:
  - `createRoom()`: random UUID room id; 6-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Creates the room in `lobby`, `currentIndex -1`, `answeredCount 0`. On a `Duplicate:` refusal from `uniqueOn` it retries with a new code (5 attempts). Then adds a `team_members` row for the host. The host is a member, not a player.
  - `joinRoom({code})`: normalises the code. Checks for an existing membership FIRST and returns the room whatever its status. Only new joins require `lobby`. Creates `players` (displayName from the caller's `users` row, server-side), then `team_members`, both with deterministic ids. The existence check matters: `tools.create` with an explicit id upserts, so without it a rejoin would reset `score`.
- `src/lib/call-action.ts`: client helper (POST `/api/actions/<name>` + `getAuthToken()`). Checked `index.d.ts` first: the SDK has no client-side action helper.
- Pages (sign-in required): `/create`, `/join`, `/room/:roomId` (code, status, live player list via `useQuery`). Buttons are disabled until `useMutations().ready`. Nav: Host, Join.
- Tests: `tests/api.spec.ts` (401 for both actions), `tests/lobby.spec.ts`, `tests/membership-resubscribe.spec.ts`.
- Test accounts created via `npx deepspace test accounts create --password-stdin` (passwords from `openssl rand`, never printed): `sourcerush-host@`, `sourcerush-player@`, `sourcerush-outsider@deepspace.test`, label `sourcerush`. Credentials live in `~/.deepspace/test-accounts.json` (mode 0600, outside the repo).

Verified:
- `npx tsc --noEmit`: clean. `npx eslint .`: clean. `npx vitest run`: 14/14.
- `npx deepspace test run all`, twice: 15 passed, plus 1 expected failure (below). Local dev (miniflare), not deployed.
- `lobby.spec.ts` with 3 signed-in users (host / player / outsider):
  - Host creates; player joins with a lowercase code; host's list updates live. A wrong code gives "No room with that code."
  - Player refresh restores code + list. A second join returns the same room, and the count stays 1.
  - **(a)** The outsider has `/room/<id>` open (subscribed to rooms + players for that room) while the player joins. Nothing appears on screen, and no WebSocket frame contains `${roomId}:`. Control: the host's frames do contain it.
  - **(b)** A raw `core.subscribe {collection:'team_members'}` injected on each user's own authenticated records socket (Playwright `routeWebSocket`) returns `records: []` for host, player and outsider. Positive control: the same probe on `players` returns the player's own rows and nothing from this room for the outsider.

**Answer to the CLAUDE.md open question ("can a collection be unreadable to clients?"): yes.** A collection whose permissions are `read: false` for `'*'`, `viewer`, `member` and `admin` returned zero rows to three signed-in non-owner test accounts. The admin role (app owner) was NOT exercised; it is `false` in the schema but untested. Server actions still read it (RBAC off). Tested on `team_members`; `answerKeys` and `sources` can use the same pattern as synced records. Caveat: tested on local dev only. A client query is not the only leak path; `questions`/`players` must never copy answer data in.

Not verified / risks:
- **SDK issue (deepspace 0.44.2), confirmed real, not worked around:** `notifyTeamMembershipChange()` (`server.js` ~L4430) reads `record.data.UserId`; rows carry `userId`. The behaviour fits this: a page *already subscribed* before its user joins (e.g. room page left open in tab A, join done in tab B) never receives rows that existed before the join (room row, earlier players). It only gets rows written afterwards. A refresh fixes it. Normal app flow is unaffected because `/join` navigates to a fresh subscription. `tests/membership-resubscribe.spec.ts` reproduces it and is marked `test.fail()`, so it turns red once an SDK upgrade fixes it. I did not patch the SDK to prove the typo is the only cause.
- "Joining only in lobby" is untested against a non-lobby room: nothing can change status yet.
- Concurrent duplicate joins (same user, two simultaneous requests) are not tested. Worst case is a harmless upsert of the same row with `score 0` while in lobby.
- `createRoom` code-collision retry is untested (a collision is ~1 in a billion per room). The `Duplicate:` prefix it matches is the SDK's error text, not a stable code.
- If `players` is written but `team_members` then fails, the user has a player row but no membership. A retry of `joinRoom` repairs it (upsert + membership).
- Not deployed; not tested in production auth or with real (non-test) accounts.
- CLAUDE.md's architecture table doesn't yet list `team_members` or `rooms.roomId`. I left CLAUDE.md unchanged. (Done in the next entry.)

## 2026-11-17 — confirm createRoom is one write; CLAUDE.md docs; research: uniqueOn vs explicit-id create

Did:
- Confirmed (no change needed): `createRoom` generates `roomId = crypto.randomUUID()` first and passes it both in the data and as the record id in ONE `tools.create('rooms', {...roomId...}, roomId)` per attempt. No follow-up update.
- CLAUDE.md: added `team_members` and `rooms.roomId` (plus record-id formats) to the architecture table. Added a note on how "room members" is enforced (`'team'` + `team_members`, why not `'_rowId'`), a gotcha section (explicit-id create overwrites; the resubscribe issue), and a note under invariant 3.
- No code changes.

Research: does `uniqueOn` reject `tools.create` with an explicit id that matches an existing row?
**No. The overwrite wins (as a merge).** Code path, `node_modules/deepspace/dist/server.js` (deepspace 0.44.2):
1. `records.create` (L5813–5820): `recordId = params.recordId || generateId()`, then `putRecord(...)` with `updateOnly = false`. Unlike `records.update` (L5821–5829), it passes no update-only flag.
2. `putRecord` (L4547): `existing = getRecord(...)` (L4563); `isUpdate = existing !== null` (L4564). With a matching id, the create becomes an update.
3. `mergedData = isUpdate ? { ...existing.data, ...data } : { ...data }`. Fields not sent are kept; fields sent replace the old values.
4. In the column loop, on the update branch: **`immutable` columns whose incoming value differs are rejected**, `Cannot modify immutable field '<name>'` (L4585–4586). This loop runs before the `if (!skipUserRbac)` block, so it **applies to server actions too**. `userBound` columns keep their old value (L4588–4589).
5. `uniqueOn` check (L4670–4688): when `isUpdate`, the query adds `AND _row_id <> ?` with the row's own id. A row never conflicts with itself, so `uniqueOn` only rejects when a *different* row holds the same unique values.
6. Then a plain `UPDATE ... WHERE _row_id = ?`, and the change is broadcast.

Consequences for `submitAnswer` (input for Thursday's plan, not a design):
- `${questionId}:${userId}` + `tools.create` alone: a second submission silently replaces `choiceIndex` and returns success.
- Marking columns `immutable` makes a second create with a *different* value fail inside the single `putRecord` call (the room processes one request at a time), so it can't race. But a create with *identical* values for every immutable column still succeeds as a no-op update. So "the create succeeded" can't by itself mean "this was the first submission" (e.g. for incrementing `answeredCount`), unless some immutable field is guaranteed to differ on every call, such as a server-set `submittedAt`.
- `tools.get` then `tools.create` in an action is not atomic: they are two separate requests to the room, and two concurrent calls can both see "not found".

Verified:
- Read the code path above in the installed SDK. Only CLAUDE.md and AGENT_LOG.md changed.

Not verified / risks:
- **Not tested empirically.** I chose the code-path option over a throwaway collection to keep this task free of code changes. Steps 2, 4 and 5 are read from bundled JS, not observed at runtime. The lobby spec's rejoin test is consistent (a second join didn't add a row) but doesn't exercise this, because `joinRoom` checks membership before creating.
- Only checked the `tools.*` (server action) path. Client `useMutations().create` goes through a different handler (`core.put`); not traced.
- Behaviour may change in a future SDK version; re-check after any `deepspace` upgrade.

## 2026-11-17 — CLAUDE.md: answer the open question; submitAnswer plan notes

Did:
- CLAUDE.md: replaced the "Open question" paragraph with the answer (yes, `read: false` for every role hides a collection from clients), its caveats, and a pointer to the AGENT_LOG entry holding the evidence.
- CLAUDE.md: added "Plan notes for `submitAnswer`": every `submissions` field immutable, plus a server-set immutable `attemptId` (random UUID per call); `answeredCount` display-only, with `revealQuestion` counting `submissions` server-side; a required concurrency test (two simultaneous calls → exactly one succeeds, the first `choiceIndex` is kept).
- No code changes. No other edits.

Verified:
- Docs only; nothing to run.

Not verified / risks:
- The `attemptId` approach rests on the code-path reading in the previous entry (immutable check at `server.js` L4585, applied to server actions), not a runtime test. The required concurrency test is what will prove it.
- The existing `submitAnswer` bullet in CLAUDE.md still says "increment `answeredCount`". That's consistent with display-only, but `revealQuestion` must not use it. Left as is, since no other changes were requested.

## 2026-11-17 — playable backend with hardcoded questions (openQuestion / submitAnswer / revealQuestion)

Did:
- `src/lib/questions/fixtures.ts`: original fictional article ("The Tide Clock of Wenmouth Harbour") + 8 candidates with verbatim passages, plus `BROKEN_FIXTURE_CANDIDATES` (invented passages) for the failure test.
- `src/lib/questions/prepare.ts` (new, pure): `prepareQuestions(source, candidates)` = `buildQuestionPrompt` → `validateQuestions(…, sourceUsed)` → `shuffleChoices`, or an error if fewer than `QUESTIONS_MIN_USABLE`.
- `src/lib/scoring.ts` (new, pure): `QUESTION_DURATION_MS = 20000`, `scoreFor(correct, submittedAt, endsAt)`.
- Schemas (all writes server-only), registered in `src/schemas.ts`:
  - `answerKeys` (id `${roomId}:${index}`), `sources` (id roomId, `fullText`), `reveal_locks` (id questionId; immutable `questionId`, `attemptId`): `read: false` for every role.
  - `questions` (id `${roomId}:${index}`): `'team'` via `teamField: 'roomId'`; `choices`/`reveal` are json columns; `reveal` empty until reveal.
  - `submissions` (id `${questionId}:${userId}`): all columns immutable incl. server-set `attemptId`; read `'own'` with `ownerField: 'userId'`.
  - `rooms`: added `'failed'` status and `errorMessage` column. **Data-model change, approved.**
- `src/actions/index.ts`:
  - `createRoom`: `generating` → fixtures through `prepareQuestions` → store `sources` + `answerKeys` → `lobby`. Rejections logged per question. Any failure (too few valid, or a throw) → `failed` + `errorMessage`; returns success with `status: 'failed'` (ActionResult can't carry data on failure, worker.d.ts L3446). `params.fixture === 'broken'` forces it.
  - `openQuestion`, `submitAnswer`, `revealQuestion` as in CLAUDE.md. Additions agreed in the plan: `submitAnswer` also requires `room.currentIndex === question.index`; `answeredCount` is a recount; a losing reveal returns `{ alreadyRevealed: true, by: 'status' | 'lock' }` (the `by` field is a diagnostic for tests).
- Tests: `src/lib/questions/fixtures.test.ts`, `src/lib/scoring.test.ts`, `tests/game.spec.ts`, `tests/helpers/game.ts` (`act()` via the app's `callAction`; raw-probe tap copied from lobby.spec.ts, plus clearing the socket on close so probes wait for the new socket after navigation).
- CLAUDE.md: table (new collections, id formats, errorMessage, submissions read rule), state machine incl. `failed`, server action descriptions, pipeline/testing sections; replaced the submitAnswer "plan notes" with "how it works".

Verified (local dev / miniflare, not deployed):
- `npx tsc --noEmit`, `npx eslint .`: clean. `npx vitest run`: 22/22 (incl. all 8 fixtures validate; shuffle keeps the correct text; broken set rejected with "passage not found in source").
- `tests/game.spec.ts`, 4 standalone runs + 3 inside `test run all`, all passing:
  - Failure: `createRoom({fixture:'broken'})` → stored room `status: 'failed'`, `errorMessage: "Couldn't make enough questions from this article."`; server log lists all 8 rejection reasons; `openQuestion` on it is refused.
  - Non-host `openQuestion` → "Only the host can open the next question." Host `submitAnswer` → "Only players in this room can answer."
  - Before reveal: `answerKeys`, `sources`, `reveal_locks` raw probes return 0 rows for host, p1, p2 (unfiltered, so from any room), and explicitly 0 `answerKeys` rows for the host's own room (host is `createdBy` of those rows → `false` beats ownership). The question row's data keys are exactly `choices, index, prompt, roomId`. No frame received by any of the three contained any fixture passage or explanation.
  - Two concurrent `submitAnswer` (choice 0, choice 1) from p1 in one page: exactly one success; the loser got "You already answered this question."; the stored row's `choiceIndex` equals the winner's. p2 and the host read 0 of p1's submissions.
  - Refresh: p1 reloads `/room/:id`; UI shows code, "Status: question", 2 players; probes return room (`question`, `currentIndex 0`, same `endsAt`, `answeredCount 1`), the question, and p1's own submission.
  - Six concurrent `revealQuestion` calls (3 each from p1/p2) after both answered: exactly one `alreadyRevealed: false`; all 5 others were stopped by the **lock** (`by: 'lock'`), not the status check, in every run. p2 (correct) score = `scoreFor` from the stored timestamps (e.g. 932, 934), not double; p1 (wrong) = 0. Question's `reveal` matches the fixture's passage and the shuffled correct index.
  - Late: next question opened, waited until `endsAt` + 0.5 s → "Time's up."; no row stored; time-up reveal with zero answers succeeds and changes no scores.
- `npx deepspace test run all`: see the regression note below.

Known edges (accepted, not handled):
- If the winning `revealQuestion` fails after creating its `reveal_locks` row, the room stays in `question` and no later call can reveal it (the lock is taken). Needs a manual fix today.
- Two concurrent `openQuestion` calls (host double-click) both open the same next index: an upsert of the same question row, and `endsAt` moves by a few ms. Harmless but not prevented.
- An in-flight submission (passed the `endsAt` check just before the deadline) that is written after a time-up reveal has re-read submissions is stored but scores 0.
- Submission (and player) counts read one query page of at most 500 rows (`ROOM_QUERY_LIMIT`); larger rooms would undercount.

Not verified / risks:
- **Full-suite interaction (not caused by game logic, but new with this change):** in `npx deepspace test run all` (parallel workers), `membership-resubscribe.spec.ts` (marked `test.fail()` for the SDK `UserId` typo) *passed* in 3 of 3 runs, so the suite reports 1 failed. Alone it still fails as expected (2 of 2), and on the commit before this change the full suite was green. Diagnosed with temporary (reverted) listeners: no page reload, no new socket, and no server `records.resubscribe` frame; the watching page's own client re-sent its existing subscriptions (same subscriptionIds) and got the pre-existing rows. It coincides with game.spec using the same test account (the latecomer is p2 there) at the same time. I did NOT find what makes the client re-query. The SDK typo is still there (`server.js` L4431). Options for you: run e2e with 1 worker, give game.spec its own accounts, or drop `test.fail()` and assert nothing for that spec. I changed none of these.
- `collab.spec.ts:65` (scaffold API-status test) failed in 1 of 3 parallel full runs and passed alone and in the other runs. Looks like load flakiness; not investigated.
- A submission that passes the `endsAt` check a few ms before the deadline can be written after a time-up reveal has re-read submissions; it is then stored but unscored (0 points). The window is tiny; not tested.
- Counting uses one query page of 500 rows; a room with >500 players would undercount.
- `fixture: 'broken'` is reachable in production; it can only create a failed room for the caller. Remove it once the real pipeline has its own failure tests.
- Admin (app owner) role reading `answerKeys`/`sources` is still untested (test accounts are non-owners).
- `game.spec` relies on the test runner's Vite dev server to `import('/src/lib/call-action.ts')`; it won't run against a deployed build as is.
- Clock: the late-submit test assumes the test and worker clocks agree (same machine). The rejection itself uses only the server clock.

## 2026-11-17 — game.spec gets its own test accounts; dev-only check for `fixture: 'broken'`

Did:
- Created 3 test accounts, label `sourcerush-game`: `sourcerush-game-host@`, `sourcerush-game-p1@`, `sourcerush-game-p2@deepspace.test`, via `npx deepspace test accounts create --password-stdin` (passwords from `openssl rand`, never printed; stored in `~/.deepspace/test-accounts.json`, outside the repo). Account total is now 6/10.
- `tests/game.spec.ts`: `users(n, { label: 'sourcerush-game' })`; the skip condition counts only accounts with that label. Other specs call `users(3)` with no label, which picks the 3 oldest accounts (`pickTestAccounts`, testing.d.ts), so they keep the original `sourcerush` accounts.
- `fixture: 'broken'`: **no documented way for the worker to tell local dev from production**, so it stays as is with a TODO in `createRoom`. **It is removed when the real pipeline lands on Friday.** Looked at:
  - docs: `llms.txt` index and `/guides/dev-workflow.md`, which mention nothing of the kind (`.dev.vars` is described only as local secret storage).
  - `worker.ts` `Env` and `wrangler.toml` `[vars]`: no environment flag.
  - `ALLOW_DEBUG_ROUTES` (closest candidate): `worker.d.ts` L1294–1300 says `deepspace dev start`/`test run` set it automatically, but also "Off unless a deployment opts in with `ALLOW_DEBUG_ROUTES=true`"; `cli.js` L13418–13420 warns when a deployed app enables it. So it means "debug API on", not "local dev". Not used.
- AGENT_LOG: added two known edges to the previous entry (late in-flight submission scores 0; 500-row query limit).
- `collab.spec.ts`: untouched (passed in both runs below).

Verified (local dev):
- `npx deepspace test run all`, twice: 17 passed both times. `membership-resubscribe.spec.ts` failed as expected (its `test.fail()` holds) in both runs, so the SDK issue still reproduces when no other spec shares its accounts. `game.spec` ran as the new host account (`hostId nHHK7…` in the failed-room log line). Unit tests 22/22 in both runs.
- `npx tsc --noEmit`, `npx eslint .`: clean.

Not verified / risks:
- Two runs is a small sample for a flake that showed up in 3 of 3 runs before; the account split is the explanation that fits, but I did not re-instrument to prove the client re-query is gone.
- The earlier root cause (why a concurrent session of the same account makes the client re-query) is still not found.

## 2026-11-17 — The host is also a player

Did:
- `src/actions/index.ts`:
  - `createRoom` now also creates the host's `players` row (`${roomId}:${hostId}`, score 0, `displayName` from the server-side `users` row), using the same call as `joinRoom`. It is written after the host's `team_members` row and before the question pipeline.
  - New `failRoom(tools, roomId, errorMessage)`. If the host's `team_members` or `players` write fails, it sets `status: 'failed'` + `errorMessage: 'Could not set up this room. Please try again.'`, and `createRoom` returns `{ success: false, error: 'Could not create a room. Please try again.' }`. Before this change a failed membership write returned the same error but left the room in `generating`.
  - `failRoom` uses `tools.update('rooms', …)`, the same call the pipeline failure path uses. The pipeline path was **not** switched to `failRoom`: its single `tools.update` sets either `lobby` or `failed` and returns an error if it fails, so switching would mean splitting that write. That was more than a few lines, so I left it.
  - `submitAnswer`: no code change. There was never a host-specific rejection; the host was refused only because they had no `players` row.
  - `revealQuestion` and scoring: no code change. Both already loop over all `players` rows, so the host is now scored, and the "everyone answered" early close now waits for the host (intended). `openQuestion` stays host-only.
  - Only doc comments changed beyond that.
- `tests/game.spec.ts`:
  - Removed the "host can't answer" assertion. Instead it checks that the host's `players` row exists with score 0 and that there are 3 players.
  - `player-count` is now 3.
  - In step 5, before the host answers, an early `revealQuestion` is refused with "The round is still open."
  - The host then submits the correct answer. p1 and p2 read 0 of the host's submissions, and the host's score equals `scoreFor(true, hostSubmittedAt, endsAt)` (> 500, so a double score would show).
- `tests/lobby.spec.ts`, `tests/membership-resubscribe.spec.ts`: host/player `player-count` expectations +1 (outsider/watching-before-join stay 0); lobby header comment.
- `CLAUDE.md`: host is a player (architecture paragraph, `createRoom` incl. `failRoom`, status line, `revealQuestion` count includes host, testing line).

Verified (local dev):
- `npx tsc --noEmit`: clean. `npx vitest run`: 22/22.
- `npx deepspace test run all` (the two requested runs, plus a third):
  - Run 1: 17 passed. In `game.spec` the host scored 919 (p1 956, p2 921). 6 concurrent reveals → 1 scorer, 5 `alreadyRevealed` by lock.
  - Run 2: 16 passed, 1 failed: `collab.spec.ts:65` (scaffold API-status test, "Loading integration catalog..." not visible within 5s). This is the same flake recorded in an earlier entry. The page doesn't touch rooms or players.
  - Run 3: 17 passed.
- `membership-resubscribe.spec.ts` failed as expected (`test.fail()`) in all 3 runs. In runs 2 and 3 I read `error-context.md`: it failed at line 54, where the already-subscribed tab showed "1" and "3" was expected, i.e. only its own row (the SDK bug). Line 50 (fresh join tab = "3") passed first, so this is not a count mismatch. Run 1's context file was overwritten before I read it.
- `git grep --untracked -n -i "password" -- src tests`: 5 hits, all `--password-stdin` instructions or a comment about where passwords live; no secrets.

Not verified / risks:
- **The setup-failure path (`failRoom` after a failed `team_members` or `players` write) is verified by reading the code only.** No test forces those writes to fail; that would need another test hook like `fixture: 'broken'`.
- If the `failRoom` write itself fails, or `createRoom`'s final status write fails, the room still stays in `generating`, recorded only in the log. Nothing cleans it up.
- `failed` rooms now also have a host `players` row. That's harmless because `failed` is terminal.
- The room page shows no UI difference yet: the host appears in the player list with "(you)" next to their name, and nothing more.
- `collab.spec.ts:65` is still flaky under parallel load (1 of 3 runs here, and 1 of 3 in an earlier entry); not investigated.

## 2026-11-17 — Game UI on the room page

Did:
- `src/pages/(app)/(protected)/room/[roomId].tsx`: rewritten. Reads `rooms`, `players`, the current `questions` row (`where { roomId, index: currentIndex }`) and the caller's own `submissions` row (`where { questionId }`; owner-read only), then picks a view by `room.status`. Non-members see only the "not in this room" card (no player list anymore). `generating`, `failed` (shows `errorMessage`) and `finished` (final leaderboard) are inline.
- New `src/components/game/`:
  - `types.ts`: client shapes of the records.
  - `hooks.ts`: `useMsLeft(endsAt)` (display countdown, ticks every 250 ms) and `useAutoReveal(roomId, status, questionId, shouldReveal)`. The page passes `timeUp || answeredCount >= players.length`. The effect returns early unless `status === 'question'`; its cleanup sets `cancelled` and clears the pending retry timer, and it re-runs (so cleans up) whenever status or questionId changes, or on unmount. Any failed call is retried every 1 s, 5 calls max, never shown to the user; `alreadyRevealed` is a success.
  - `Lobby.tsx` (code, article title, live players, host Start), `QuestionView.tsx` (prompt, countdown, 4 large buttons; "Answer locked in" when the own submission row exists or the submit just succeeded; host "Answered X of N"), `RevealView.tsx` (correct choice highlighted, passage in a prominent quote block, explanation, own result with points from `scoreFor(...)` for display, leaderboard, host Next), `Leaderboard.tsx` (sorted by `players.score`), `OpenQuestionButton.tsx` (Start/Next → `openQuestion`).
  - Every button: disabled until `useMutations('rooms').ready` and while its call is in flight; choices also at 0 s. All writes via `callAction`; no direct client writes. Answer data comes only from `questions.reveal`.
- `tests/game-ui.spec.ts` (new, label `sourcerush-ui`): create/join via the pages; Start; p1 answers wrong → locked in; host sees "Answered 1 of 3"; p1 reloads → same locked choice, no buttons; p2 + host answer right → auto reveal on all three shows the fixture passage, explanation, correct choice, 3-row leaderboard; result text per player; displayed points equal the player's leaderboard score; p1 last with 0; only host has Start/Next. Next → question 2; nobody answers; all three show the reveal ("No answer") once time runs out.
- Test accounts: created `sourcerush-ui-host@`, `-p1@`, `-p2@deepspace.test` (label `sourcerush-ui`, passwords from `openssl rand` via `--password-stdin`, never printed). Pool is now 9/10.
- Existing specs (approved deviations):
  - `lobby.spec.ts` L95/L123, `membership-resubscribe.spec.ts` L42: outsider/watching tab now asserts `player-count` is not rendered (`toHaveCount(0)`) instead of "0". Leak detection in lobby.spec stays on the raw frames + probe.
  - `game.spec.ts` step 4: waits for `answer-locked` and the prompt instead of `room-code` / "Status: question" / `player-count` (those are lobby-only now), then `openApp(p1.page)` so p1's room page doesn't auto-reveal and race the "exactly one scorer" and late-reveal assertions.
- `CLAUDE.md` Testing: added the UI spec and the account-pool rule (reuse existing labels).

Verified (local dev):
- `npx tsc --noEmit`, `npx eslint .`: clean. `npx vitest run`: 22/22.
- `npx deepspace test run tests/game-ui.spec.ts` alone: passed (24.6 s). Worker log: 3 `revealQuestion` calls per round (one per client), no retries.
- `npx deepspace test run all`:
  - First attempt: game.spec failed at L161 (waited for `room-code` mid-question; my miss in the step 4 edit). Fixed as above.
  - Run 1 after fix: 18 passed, 0 failed (membership-resubscribe ✘ is its expected `test.fail()`).
  - Run 2 after fix: 17 passed, 1 failed: `collab.spec.ts:65` ("Loading integration catalog..." not visible), the same scaffold flake as in earlier entries. membership-resubscribe again failed as expected at L54.
- `git grep --untracked -n -i "password" -- src tests`: 6 hits, all `--password-stdin` instructions or comments; no secrets.

Not verified / risks:
- Phone layout checked only by reading the classes (`max-w-md px-4`, full-width wrapping buttons); I did not view it on a narrow viewport or a real phone.
- The `finished` screen and the `generating`/`failed` views are not exercised by the UI spec (finished needs all 8 questions). The failed view is reachable via `fixture: 'broken'` but no test looks at it.
- Clock skew retries untested: on the local machine client and server clocks agree. A client clock running >5 s ahead would give up early; the room then stays in `question` at 0 s until another client reveals or someone refreshes (the retries restart on mount).
- membership-resubscribe: since non-members no longer see the player list, its L54 now fails because the room row (pre-existing) never arrives, not only the player rows. Same SDK bug, slightly different symptom.
- The countdown uses the device clock; a skewed phone shows a wrong countdown (the server still enforces endsAt).
- `answeredCount` is display-only; the "everyone answered" early reveal trigger uses it, but the server recounts submissions before allowing it.

## 2026-11-18 — "Return to your room" link + finished-screen buttons

Did:
- Checked before coding (approved): a `'team'` query on `rooms` is filtered in SQL by `executeTableQuery` (`server.js` L5280–5296) to `roomId IN (caller's active team_members.teamId) OR _created_by = caller`. Live updates go through `checkPermissionLevel` (L4092) with the same rule. `where` is equality only, so the status filter runs on the client. "Most recent" = envelope `createdAt` (server-set `_created_at`).
- New `src/components/game/ReturnToRoomLink.tsx`: `useQuery('rooms', { orderBy: 'createdAt', orderDir: 'desc', limit: 20 })`, sorted again by `createdAt` on the client, picks the first room whose status is not `finished`/`failed` (so `generating` counts), and links to `/room/<roomId>` with its code. Renders nothing otherwise.
- Used on `/create` (`create.tsx`), `/join` (`join.tsx`), and `/home` (`home.tsx`, signed-in only). `/` (`src/pages/index.tsx`) stays static and untouched, as agreed.
- `room/[roomId].tsx` finished view: "Host a new game" (→ `/create`) and "Back to home" (→ `/home`) as plain `<Link>`s styled with `buttonVariants`. No server calls.
- `tests/game-ui.spec.ts`: the single test now plays the whole game (renamed "a full game through the UI", timeout 150 s → 240 s). After Q2: Next → Q3; host goes to `/create`, sees the link with this room's code, clicks it, and lands back on Q3 (same prompt, choices enabled). Then Q3 through the last question: all three answer, so each round closes early. Then all three see the finished screen with both links (hrefs checked); host clicks "Host a new game" → `/create`, waits for Create room to be enabled, and checks no link shows this room's code.
- No schema, action, permission, scoring or state-machine changes. No new accounts (reuses `sourcerush-ui`).

Verified (local dev):
- `npx tsc --noEmit`, `npx eslint .`: clean. `npx vitest run`: 22/22.
- game-ui.spec alone: before the change 25.3 s (whole command 33.2 s). After: 28.9 s and 28.1 s (36.6 s / 36.0 s whole command). In the full suite: 30.0 s and 30.6 s. **≈ +3–4 s.** Rounds close early, so 6 extra rounds cost little.
- The worker log shows 9 `openQuestion` calls from the UI host per run (8 questions + the one that sets `finished`).
- `npx deepspace test run all`, twice:
  - Run 1: 17 passed, 1 failed: `collab.spec.ts:65` (the known scaffold flake). membership-resubscribe ✘ is its expected `test.fail()`.
  - Run 2: 18 passed, 0 failed.
- `git grep --untracked -n -i "password" -- src tests`: 6 hits, all `--password-stdin` instructions or comments; no secrets.

Not verified / risks:
- **The finished check is weaker than specified.** The first run with a strict `toHaveCount(0)` failed: the host still belongs to room `4GRFN5` (`c2c7a215…`), left in `reveal` by an earlier game-ui run. Local dev state persists in `.wrangler/state`, and every run before this change ended mid-game. The link correctly pointed there. The test now asserts that no link shows *this* room's code. This room is the host's newest, so if finished rooms weren't skipped, the link would show it. A strict check would need old rooms cleared (e.g. a local state wipe), and any future failed run would leave another active room.
- ~~That absence check can pass too early if the rooms query hasn't loaded yet.~~ Fixed in the next entry: the test now waits for a `return-link-ready` marker.
- Known edge (accepted): only the 20 newest rooms are fetched (the default query limit is 50, so "no limit" wouldn't be exact either). A user with ≥20 newer ended rooms won't see an older active room's link; its URL and join code still work.
- The link on `/join` and `/home` was checked by reading the code and by tsc only; the spec exercises only `/create`. Not checked on a phone-width viewport.
- Abandoned rooms: as of the next entry, rooms whose `createdAt` is more than 2 hours old no longer show the link (`ROOM_LINK_MAX_AGE_MS`, display only). The room itself still stays in its status; nothing ends abandoned rooms server-side.

## 2026-11-18 — Return link: loaded marker + 2-hour cutoff

Did:
- `src/components/game/ReturnToRoomLink.tsx`: renders a hidden `<span data-testid="return-link-ready" hidden />` once the rooms query's status is `'ready'` (with or without a link). New constant `ROOM_LINK_MAX_AGE_MS = 2 h`: rooms whose envelope `createdAt` is older are skipped. Display only; no record changes.
- `tests/game-ui.spec.ts`: before the negative check on `/create`, waits for `return-link-ready` (`toBeAttached`) instead of the Create room button being enabled.
- Updated the known-edges bullets in the previous entry.
- (I briefly ran `npx prettier --write` on the component; with no repo config it switched it to double quotes + semicolons. I rewrote it in the repo style by hand; tsc/eslint below are on the final file.)

Verified (local dev):
- `npx tsc --noEmit`, `npx eslint .`: clean. `npx vitest run`: 22/22.
- `npx deepspace test run tests/game-ui.spec.ts` twice: passed both (test 28.2 s / 27.9 s; command 36.1 s / 34.2 s).
- `npx deepspace test run all` once: 17 passed, 1 failed: `collab.spec.ts:65`, the known scaffold flake. membership-resubscribe ✘ is its expected `test.fail()`. game-ui passed (30.6 s).

Known edges (current):
- Only the 20 newest rooms are fetched (the server default limit is 50 anyway). If a user has ≥20 newer rooms that have all ended, an older active room doesn't show; its URL and join code still work.
- Abandoned rooms drop off the link after 2 hours (by `createdAt`, so a game that legitimately runs past 2 h would also lose its link). The room itself still stays in its status.
- The cutoff uses the device clock: a skewed clock shifts it.

Not verified / risks:
- No test covers the 2-hour cutoff (it would need a room more than 2 h old or a controllable clock). Checked by reading the code only.
- The 2-hour cutoff can also hide the old rooms that made the strict "no link" check fail last time, so a strict check might now pass. I didn't switch back to it; the spec still checks only this game's code.
- `/join` and `/home` still aren't covered by the spec.

## 2026-11-18 — Research: wiring Firecrawl + Anthropic into createRoom (no code changed)

Did: research only. No source files changed; only this log entry. Full answers and the proposed plan are in the session reply; the key findings with sources are below.

Findings:
1. Calling. Server actions call `tools.integration(endpoint, body)` (`node_modules/deepspace/dist/worker.d.ts:3508-3516`; implemented in `src/server/action-routes.ts:95-136`). The result is `{ success: true, data }` (the integration's body, no wrapper) or `{ success: false, error, code?, status?, details?, issues? }`.
   - `firecrawl/scrape` (`npx deepspace integrations info firecrawl/scrape`): input `url` (required), `formats` (default `["markdown"]`), `onlyMainContent` (default true), `includeTags`, `excludeTags`, `waitFor`, `timeout`. Output `{ data, creditsUsed, costUsd }`. `data` is untyped in the schema, so the location of the markdown and title is not documented.
   - `anthropic/chat-completion`: input `model` (string, default `claude-opus-5-5`), `max_tokens` (default 4096, minimum 1, no maximum stated), `messages` (user/assistant, content is a string or an array of blocks), `system`, `temperature` (0–1). The output schema is `null`: the response shape is undocumented. The input schema has no tools, response-format or JSON-mode field. Models: the integration lists none. Its billing note names `claude-haiku-5-5` and `claude-haiku-4-5`. The SDK agent catalog (`worker.d.ts:2360`) has opus-5-5, fable-5-1, sonnet-5-5 and haiku-5-5, but that catalog is for `createDeepSpaceAI`, not this integration.
2. Secrets/billing. The proxy uses the platform's keys, so no secrets are needed (docs `/guides/external-apis` line 5). Billing is `'developer'` by default, which bills the owner via `APP_OWNER_JWT` (`src/integrations.ts`; `action-routes.ts:107-111`). Both endpoints are `per_actual_cost`, provider cost plus markup (`integrations list`). 100 credits = $1 (`/agents/web-search-image-generation-no-api-keys` line 15). The platform rate-limits only `google/*`, so the app must cap spend itself (`/guides/external-apis` line 121).
3. Time limits. DeepSpace documents no maximum run time for a server action. The action route awaits the handler inline and gets no `executionCtx` or `waitUntil` (`action-routes.ts:67`). `waitUntil` is killed 30 s after the response (`/guides/background-jobs` line 7). The documented long-work pattern is JobRoom plus `enqueueJob` (same page), and `enqueueJob` takes a roomId to shard the queue (`worker.d.ts:1730-1746`). Jobs run serially per JobRoom (background-jobs line 103). The alarm limit is 15 min; orphaned rows are rescued after about 16 min, then retried or failed (lines 208-217). `apiWorkerFetch` sets no timeout (`worker.js:8065`). In `buildCronContext`, `records.create` takes no recordId (`worker.js`, `buildCronContext`), so job code cannot use it for our deterministic ids.
4. Failure modes. Not documented per endpoint. The documented envelope: `status: 0` on transport failure, timeout or abort; `code` slugs such as `insufficient_credits` and `validation_failed` (`/guides/external-apis` lines 24-45). "Empty results are not errors" (line 143). `callIntegration` calls `res.json()`, which throws on a non-JSON error body (`action-routes.ts:131`).
5. Testing. Mock only the external boundary (`/guides/testing` line 7). `page.route` cannot intercept server-side `tools.integration` calls. Test accounts have no credits (`/guides/external-apis` line 247), but developer-billed calls bill the owner, including in local dev (APP_OWNER_JWT, `buildCronContext` error text).

Verified: `npx deepspace integrations list | info` (free, no login); read the docs pages above via curl, the .d.ts files and worker.js. No paid calls made.

Not verified / risks:
- The Anthropic and Firecrawl response shapes need one real `integrations invoke` each, which is paid and needs your OK.
- Whether the action keeps running when the host closes or refreshes the tab mid-request is undocumented by DeepSpace (Cloudflare behavior, untested here).
- Whether unknown body fields (e.g. JSON-mode options) are stripped or rejected by the proxy's validator is untested.

## 2026-11-18 — Research round 2: job path checks, paid response-shape calls (no code changed)

Did: research only. No source files changed; only this log entry. The revised plan is in the session reply.

Findings:
- (1a) `tools.integration` from a job. AppJobRoom gets the worker env (`worker.ts:69-81`, `runJob(job, context, this.env)`; `BaseRoom` stores it, `worker.js:256-258`). `createActionTools(env, …)` bills developer integrations with `env.APP_OWNER_JWT` and reaches the api-worker via `env.API_WORKER`/`API_WORKER_URL` (`action-routes.ts:107-130`). So a job's calls bill the app owner, the same as from an action. The docs agree: "Handlers run as the app owner … falls back to APP_OWNER_JWT and bills the developer" (`/guides/background-jobs` line 223), and the cron pattern makes the same call from inside a DO (`/guides/external-apis` lines 160-162). `.dev.vars` has APP_OWNER_JWT, API_WORKER_URL and OWNER_USER_ID (names checked, values not printed). Not yet run from a job.
- (1c) Write identity. `tools.*` sends `X-User-Id: <userId>`, and an insert sets `_created_by` to it (`server.js` INSERT in `putRecord`, ~4700-4708). An update leaves `_created_by` unchanged (`server.js` UPDATE branch ~4690-4697 sets only `_updated_at` + columns). `'team'` read = creator OR team member (`server.js:4092-4097` `checkPermissionLevel`; the query form is `teamField IN (…) OR _created_by = ?`, `server.js:5288`). `false` returns before any owner check (`server.js:4080`). The job only creates `sources` and `answerKeys` (read: false) and updates `rooms`. Acting as `room.hostId` gives the same `_created_by` values as today.
- Security finding: JobRoom sockets. `/ws/jobs/:roomId` takes any room id from the client (`src/server/realtime-routes.ts:169-171`). The scaffold's `authorizeWrite` allows role member/admin (`worker.ts:72-76`), and `ROLE_DEFAULT = "member"` (`worker.js:71`). So any signed-in user can enqueue, cancel or read jobs on any queue over the socket (`worker.js:4861-4890`). The server-side `/enqueue` (POST, from `enqueueJob`) runs no authorize check (`worker.js:4936-4961`), and the public route is GET only. Nothing in `src/` uses `useJobs` today.
- Paid calls (approved; one each). Firecrawl: 1 credit, `costUsd: 0.0038`. Anthropic haiku-5-5: `costUsd: 0.0000078`.
  - `firecrawl/scrape` on https://en.wikipedia.org/wiki/Tide (formats markdown, onlyMainContent). CLI output `{ ok, success, data }`, where `data` = the integration body `{ data: { markdown, metadata }, creditsUsed: 1, costUsd }`. Title: `data.data.metadata.title` ("Tide - Wikipedia"), also `ogTitle`. Status: `data.data.metadata.statusCode` (200). No plain-text field in the response. Markdown: 377,648 chars, starting "[Jump to content](https://en.wikipedia.org/wiki/Tide#bodyContent)\n\n[![Page semi-…" (truncated). A rough links/images/markers strip leaves ~154,535 chars. Wikipedia links carry parentheses in URLs plus titles: `[Tide (disambiguation)](/wiki/Tide_(disambiguation) "Tide (disambiguation)")`, which a `\([^)]*\)` regex leaves half-stripped.
  - `anthropic/chat-completion`, model claude-haiku-5-5, max_tokens 40. `data` = Messages API shape: `content[0].type "text"`, `content[0].text` ("{\"ok\":true}"), `stop_reason "end_turn"`, `stop_sequence`, `usage.input_tokens 33`, `usage.output_tokens 9` (plus cache, thinking and totalTokens counts), `costUsd`. No `creditsUsed`.
- Fixture: `FIXTURE_SOURCE.text` is 2,095 chars with no markdown characters (checked with a one-off `npx tsx`, run from the npx cache, not added to package.json).

Verified: two `integrations invoke --yes --json` calls (outputs saved only in the session scratchpad); reads of worker.js/server.js/worker.ts/realtime-routes.ts/schemas cited above.

Not verified / risks:
- Inside an action, `tools.integration` returns the api-worker payload as-is (`action-routes.ts:131-135`). I'm inferring that the CLI's `success`/`data` are that same payload, so the paths would be `r.data.data.markdown` and `r.data.content[0].text`. First runtime check should confirm.
- Real generation latency for 12 questions on haiku-5-5 was not measured; timeout values are estimates.

## 2026-11-18 — Wire Firecrawl + Anthropic into createRoom (background job, quota, Try it yourself)

Did:
- New pure modules (no SDK imports):
  - `src/lib/questions/markdown.ts`: `markdownToPlainText`.
  - `src/lib/questions/responses.ts`: guarded readers for the two integration responses.
  - `src/lib/questions/pipeline.ts`: `runQuestionPipeline(url, { scrape, generate })`, `MIN_ARTICLE_CHARS` = 2000, `GENERATE_ATTEMPTS` = 2, `USER_MESSAGES`.
  - `src/lib/create-room-params.ts`: exactly one of `{ url }` (http/https, ≤ 2048 chars) or `{ sample: true }`.
  - `src/lib/generation-timing.ts`: `SCRAPE_TIMEOUT_MS` 30 s, `GENERATE_TIMEOUT_MS` 60 s, `STALE_GENERATING_MS` 180 s.
- `src/server/generation.ts` (new):
  - `QUESTION_MODEL` = `claude-haiku-5-5`, `GENERATE_MAX_TOKENS` = 8000.
  - `scrapeArticle` / `generateText`, real `tools.integration` calls with timeouts. They log duration, plus cost (scrape) or stop_reason, output_tokens and costUsd (generate). No content.
  - `finishGeneration`, `storeQuestions`, `failRoom` and `questionRecordId` (moved here from actions), job type, queue id.
- `src/jobs.ts`: the `generate-questions` handler. Acts as the host; exits without writing unless the room is still `generating`, checked before and after the pipeline; never rethrows.
- `src/actions/index.ts`:
  - `createRoom` validates params, then (url only) claims a `room_quota` slot (`ROOM_DAILY_LIMIT` = 10), sets up the room, then either enqueues the job (`room:${roomId}`, maxAttempts 1) or runs the sample pipeline inline.
  - `fixture: 'broken'` and the old `generateQuestions` are removed.
- `src/schemas/room-quota-schema.ts` (new) + `src/schemas.ts`.
- `src/server/action-routes.ts`: `export` on `createActionTools`, plus a comment (the planned diff).
- `worker.ts`: `AppJobRoom` uses `authorizeWrite`/`authorizeRead: async () => false`; the unused `resolveAppRole` import is removed.
- `src/lib/questions/fixtures.ts`: `SAMPLE_PIPELINE_DEPS`; comments updated.
- Pages:
  - `create.tsx`: URL field + "Create room", plus "Try it yourself".
  - `room/[roomId].tsx`: "taking longer than expected" after 180 s (`useGeneratingTooLong` in `src/components/game/hooks.ts`); the failed screen gets the same "Host a new game" button.
- Tests:
  - New `markdown.test.ts`, `pipeline.test.ts` (incl. readers, the res.json() throw, malformed responses, timing inequality), `create-room-params.test.ts`.
  - `fixtures.test.ts`: sample text is ≥ MIN and unchanged by cleanup.
  - `game.spec.ts`: the broken-fixture test is replaced by a refusal test and a job-socket test; the sample path is used; `room_quota` is added to the probes.
  - `game-ui` / `lobby` / `membership-resubscribe` specs click "Try it yourself".
- `CLAUDE.md`: collections table, status note, createRoom, pipeline and testing sections.

Verified (local dev):
- `npx tsc --noEmit -p .` (covers src + worker.ts): clean. `npx eslint .`: clean. `npx vitest run`: 51/51.
- `npx deepspace test run all`: exit 0, 19 passed. membership-resubscribe ✘ is its expected `test.fail()`; collab.spec.ts:65 passed this run. An earlier full run failed only on the new job-socket test, fixed below.
- No spec reached an integration or a job: the suite log has 0 lines for `[generate] room`, firecrawl, chat-completion and generate-questions.
- Job-socket test (`game.spec.ts` "no client can read or write a job queue"):
  - A signed-in user's raw socket to `/ws/jobs/room:probe` gets `auth canWrite:false`, an empty snapshot, and `core.error "Write access denied…"` on `job.enqueue`.
  - Proved non-vacuous: with the scaffold-style `authorizeWrite` temporarily restored, the same test failed (`canWrite:true`, job enqueued, then "Unknown job type"). The lockdown was put back; `worker.ts:80-81` checked afterwards.
  - The test uses a made-up job type, so it can never spend credits. The experiment left one terminal job row in local dev's `room:probe` queue (pruned after 24 h).
- `markdownToPlainText` run once over the saved real Wikipedia scrape (143k chars of text): 0 leftover `](`, `![`, `**` or backslash escapes.
- Amendment 2: `normalize()` collapses all whitespace incl. newlines (`src/lib/questions/validate.ts:51`), applied to the source (l. 77) and to each passage (l. 131). So kept paragraph breaks don't block a match.

Recorded per your notes:
- `room_quota` read: false is verified from the schema (`src/schemas/room-quota-schema.ts`), not by tests. The `room_quota` probe in game.spec passes vacuously, because no spec creates quota rows.
- The quota loop treats any failed slot create as taken, not only the immutable rejection. It fails closed: an outage can show "limit reached" early but can never let anyone exceed the limit.
- Job-queue read lockdown: the empty snapshot in the test is vacuous (that queue held no jobs). The read denial is verified by code reading (`authorizeRead: false` → `jobSnapshot([])`, worker.js:4855). The write denial has real test evidence.

Differed from the plan:
- `markdownToPlainText` got one extra rule, dropping backslash escapes. The real Wikipedia scrape has `\[1\]` on every footnote (266 of them). Footnote markers are kept as `[1]` text, not removed.
- The job-socket test is 34 lines, not ~20. The token in the records-socket URL is rejected by `/ws/jobs` (close 1006), so the test takes the JWT from a refused `createRoom({})` request's Authorization header, and handles open/close.
- Helpers moved to `src/server/generation.ts` instead of being exported from `actions/index.ts`. The response readers and timing constants got their own small files.
- Firecrawl is also sent `timeout: 25000`. The room title falls back to the URL if the page has none. `sources.fullText` now stores the whole cleaned article (can be ~140k chars), not the trimmed `sourceUsed`.

Not verified / risks (manual checks):
- The real URL path end to end: never run. The response paths inside an action (`r.data.data.markdown`, `r.data.content[0].text`) are inferred from CLI output; if wrong, the room fails with serviceUnavailable and the log names the path.
- Haiku latency and token use for 12 questions (60 s / 8000 are estimates). Question yield on real articles (footnote markers in passages).
- Quota at the limit (11th link room in a UTC day), the day rollover, and the limit message.
- The 180 s stale message and a late flip to lobby. The failed screen with real errors: 404 page, short/paywalled page, out of credits.
- The enqueue-failure path, a worker dying mid-job, the `withTimeout` behaviour (not unit tested), and the job's log lines in a real run.
- The create page's URL form (specs use only Try it yourself); phone-width layout.
- Nothing committed or deployed.

## 2026-11-18 — Footnote markers removed; sources.fullText = sourceUsed

Did:
- `src/lib/questions/markdown.ts`: new step 0b, right after the backslash-unescape. Removes `[digits]` footnote markers (`/\[\d+\]/g`). A linked marker `[[1]](#cite_note-1)` becomes `[](#…)`, which the link step then removes.
- `markdown.test.ts`: the escaped/linked marker test now expects removal; new tests for adjacent `[12][13]` and for non-numeric brackets (`[later …]`, `[a]`, `[1871a]`) left alone.
- `src/lib/questions/pipeline.ts`: the ok result returns `sourceUsed` (from `buildQuestionPrompt`) instead of the whole cleaned `text`.
- `src/server/generation.ts`: `storeQuestions` writes `fullText: result.sourceUsed`, with a comment saying why.
- `pipeline.test.ts`:
  - The sample path's `sourceUsed` equals the whole fixture text (2,095 chars < `MAX_SOURCE_CHARS`), so the sample behaves as before.
  - New test: an over-long article returns exactly `MAX_SOURCE_CHARS` chars, a prefix of the cleaned text.
- `CLAUDE.md`: the `sources` row says `fullText` holds `sourceUsed`, and why (stored passages are always findable in it).

Verified (local dev):
- tsc clean, eslint clean, vitest 54/54.
- The real Wikipedia scrape after cleanup: 0 `[digits]` left, and no leftover link, image or escape syntax.
- `npx deepspace test run all`: 18 passed, 1 failed, `collab.spec.ts:65` (the known scaffold flake). membership-resubscribe ✘ is its expected `test.fail()`. Re-ran `tests/collab.spec.ts` alone: 3/3 passed.
- The suite log has 0 integration or job lines.

Not verified / risks:
- `[digits]` removal also drops a genuine bracketed number in article text (e.g. a quoted "[3]" that isn't a footnote). It's rare, and removing it can't break validation, because passages are matched against the same cleaned text.
- The real URL path is still unrun (see the previous entry's manual list). Nothing committed or deployed; `.DS_Store` left untouched.

## 2026-11-18 — Anthropic reader: collect every text block (first real run failed)

Real-run evidence (your first real run, Wikipedia article; reported by you, from the job's log lines):
- Scrape OK in 1739 ms.
- Generate attempt 1: 28089 ms, `stop_reason end_turn`, `output_tokens 7677`, then failed with "response has no string at data.content[0].text".
- So `stop_reason`/`usage` sit where expected, but `content[0]` was not a text block. The reader failed closed as designed: the room went to failed with serviceUnavailable instead of throwing.

Did:
- `src/lib/questions/responses.ts`, `readGenerateResponse`:
  - Collects every block with `type === 'text'` (and a string `text`) and joins them in order with no separator.
  - Non-text blocks are skipped. No text block → `response has no text block in data.content (types: …)`; content missing or not an array → `response has no array at data.content`.
  - The metrics line, logged once per attempt by `generateText`, now ends with `content types: <comma-separated types>, text chars <length of extracted text>`. Types and length only, never contents.
  - Header shape note updated.
- `pipeline.test.ts`:
  - New tests: text in the first block; a `thinking` block before the text block; two text blocks joined (with a thinking block between); no text block (fails, log names the types, contents absent from log and metrics); content missing / a string / an object / null body.
  - Updated: the existing metrics and empty-content assertions, and the malformed-response pipeline test.
- `CLAUDE.md`: the `responses.ts` line describes the new rule.
- `GENERATE_MAX_TOKENS` unchanged (8000), as asked.

Verified: `npx tsc --noEmit -p .` clean, `npx eslint .` clean, `npx vitest run` 58/58. The Playwright suite was not run (the change is in a pure module that no spec reaches).

Not verified / risks:
- What the non-text block at content[0] actually was. The next real run's "content types" line will show it.
- Whether 7677 output tokens include thinking: if they do, the 8000 limit leaves little room for the JSON. That's for the next run to decide.
- Joining text blocks with '' assumes they are one continuous answer. If the model splits its JSON around a non-text block in some other way, parsing could fail; the pipeline then regenerates once.

## 2026-11-18 — Real runs after the reader fix; GENERATE_MAX_TOKENS 8000 → 12000

Real-run evidence (local dev, Wikipedia articles; log lines pasted by you):
- Room eb026041…: job done in 24068 ms -> lobby. Attempt 1 rejected 1 question ("passage not found in source"), so 11 of 12 were usable. The game played 11 rounds (11 submit/reveal pairs; the 12th openQuestion finished it). The scrape/generate metrics lines for this run weren't in the paste.
- Room e39bffce…:
  - Scrape 1057 ms, creditsUsed 1, costUsd 0.0038.
  - Generate attempt 1: 19637 ms, stop_reason end_turn, output_tokens 5003, costUsd 0.0035865, content types: thinking,text, text chars 8420.
  - Job done in 20777 ms -> lobby. No rejections; 12 rounds played.
- Together with the first run (7677 output_tokens, 28089 ms; that run failed on the old reader):
  - `output_tokens` includes thinking. The 8420 chars of JSON are ~2.1–2.4k tokens, so ~2.6–2.9k of the 5003 were thinking.
  - The first run reached 96% of the 8000 cap. Thinking varies run to run, so 8000 risked truncated JSON (stop_reason max_tokens → parse failure → regenerate, or a failed room).
  - Throughput observed: ~250–270 output tokens/s.
- Cost per room ≈ $0.0074 (scrape $0.0038 + generate $0.0036). At ROOM_DAILY_LIMIT 10, ≈ $0.07 per user per day, about double if every room regenerates.

Did:
- `src/server/generation.ts`: `GENERATE_MAX_TOKENS` 8000 → 12_000; the comment now records why (thinking counts, the real token counts, and the ~48 s worst case at the observed rate, inside `GENERATE_TIMEOUT_MS` 60 s).
- No change to question count, timeouts or STALE_GENERATING_MS. The integration's input schema has no thinking control (model, max_tokens, messages, system, temperature only).

Verified: tsc clean, eslint clean, vitest 58/58. Playwright not run (no spec reaches this constant).

Not verified / risks:
- No real run yet at 12000. A run whose thinking pushes output near 12000 would take ~45–48 s at the observed rate. A slower day could exceed the 60 s timeout; that fails the room with serviceUnavailable rather than hanging.
- Whether a higher max_tokens reserves more credits up front on this integration is undocumented. Billing is by actual usage.

## 2026-11-18 — Landing page at /: research + plan (no code yet)

Did: research and a plan only, waiting for approval. Nothing changed except this entry.

Findings (signed-out user opening a protected page):
- No redirect happens. `src/pages/(app)/(protected)/_layout.tsx:23` wraps pages in `<AuthGate fallback={<SignedOutPanel />}>`. SDK `AuthGate` (`node_modules/deepspace/dist/index.js:1230-1244`) renders the fallback in place, so the URL (path + query) stays the same. Its "Sign in" button opens `<AuthOverlay>` (`_layout.tsx:50`).
- Email sign-in: `AuthOverlay` calls `signIn.email({ email, password })` with no `callbackURL` and has no navigation code (`index.js:1021-1034`). The page stays put and the gate opens once the session is set. The original URL is kept, including the query string. (The session refresh itself is better-auth's `useSession`, `index.js:892-901, 972`. I read it but didn't run it.)
- OAuth (GitHub/Google): `window.location.href = /api/auth/social-redirect?provider=…` (`index.js:1020`). The app's route sends only the origin as `returnTo` (`src/server/http-routes.ts:94`). `/api/auth/oauth-complete` always redirects to `${origin}/home` (`http-routes.ts:107, 109, 117, 119, 125`). So the original path and query are lost and the user lands on /home. What the auth worker does between those two routes is external and not documented.
- Docs (`docs.deep.space/guides/authentication.md`): describe the overlay fallback and `redirectOnSignOut` (default '/'). They say nothing about a return URL, `returnTo`/`callbackURL`, the post-OAuth landing path, or query strings.
- Public email signup is closed platform-wide (same page), so real visitors will use OAuth and land on /home.

Verified: read the files cited above, plus `tests/smoke.spec.ts`, which already covers signed-out `/` via `data-testid="static-landing"` and the "no /api/auth, no /ws" static contract.

Not verified / risks: no flow was run in a browser. The OAuth landing is inferred from app code, not observed.

## 2026-11-18 — Landing page, /home hub, shared Try-it button

Did:
- `src/pages/index.tsx`: static landing (still no hooks, no action calls, `data-testid="static-landing"` kept). It has a pitch, three links ("Create a room" → /create, "Join a room" → /join, "Try it yourself" → /home) and a 4-step how-it-works plus "play alone or share the code". Single column, `mx-auto max-w-md px-4 py-12`.
- `src/components/SignedOutPanel.tsx`: the existing panel, moved unchanged out of `(protected)/_layout.tsx` so /home can use it. `(protected)/_layout.tsx` now imports it. Same AuthGate + AuthOverlay, nothing new built.
- `src/components/game/TryItYourselfButton.tsx`: the app's only `createRoom({ sample: true })` call.
  - Same label, outline variant and full width as before. It's disabled until `useMutations('rooms').ready` and while running, shows errors in a `role="alert"` line under the button, and navigates to `/room/:id` on success.
  - The old button had no testid, so there's none to keep and none was added. Specs find it by role and name, unchanged.
  - Optional `disabled` / `onBusyChange` props let /create lock its link form while the sample call runs, and the reverse.
- `src/pages/(app)/(protected)/create.tsx`: uses the shared button. Its `createRoom({ url })` call is now inline in `handleSubmit`. The link form's error line now sits directly under the form, not under the sample section (each control has its own alert line now).
- `src/pages/(app)/home.tsx`: the signed-in hub. It has ReturnToRoomLink, "Create a room" → /create, "Join a room" → /join and TryItYourselfButton, wrapped in `<AuthGate fallback={<SignedOutPanel />}>`. Signed out, it shows the panel only; the nav still renders above it. The placeholder text and the "Signed in as" line are gone (the nav shows the name).
- `src/seo.ts`: description now matches the pitch.
- `tests/landing.spec.ts` (new, signed out, no accounts, no writes): checks the three hrefs on /, clicks through to /create, /join and /home, sees the sign-in panel on each, and checks there's no Try-it button on /home.
- `CLAUDE.md`: Testing line for landing.spec, plus a gotcha about where sign-in lands.
- The sign-in flow (`social-redirect`, `oauth-complete`), createRoom, schemas and integrations are untouched. No query-string behaviour added.

Verified (local dev):
- `npx tsc --noEmit -p .` clean, `npx eslint .` clean, `npx vitest run` 58/58.
- `npx deepspace test run all`, run twice: 23 passed both times, including the 4 new landing tests. `membership-resubscribe` ✘ is its expected `test.fail()`. No existing spec changed. `smoke.spec.ts`'s static contract (no /api/auth, no /ws on /) still passes.

Check (not fixed), URLs with a room id or code that a signed-out person might open:
- The only such URL is `/room/:roomId`, the room page's own address. ReturnToRoomLink links to it, but only for signed-in members.
- Nothing builds a join link. The lobby shows the code as text only. /join reads no query string. The "not in this room" card links to plain `/join`.
- So the risk is someone copying the room page's address bar and sending it to a signed-out person. With email sign-in they stay on that URL. **With Google/GitHub sign-in the room id is dropped and they land on /home** (oauth-complete always redirects there). Even with the URL kept, a non-member sees the "not in this room" card; they need the code from /join.

Not verified / risks:
- No browser run of an actual sign-in (email or OAuth) followed by pressing Try-it on /home. game-ui/lobby specs cover the button on /create only.
- Signing out while on /home now redirects to `/` (AuthGate's `redirectOnSignOut` default). Before, /home just showed signed-out content.
- Phone layout was checked by reading the classes only. Nothing was viewed at phone width.

## 2026-11-18 — Landing/home copy tweaks

Did:
- `src/pages/index.tsx`: the sample link's text is now "Play a sample game →" (still → /home). The line under it is unchanged: "A short sample article. Play it on your own." (That's the existing wording, not the "Sample article, play alone." you quoted; I kept what was there.) Header comment updated.
- `src/pages/(app)/home.tsx`: the line above the button is now "Start a sample game: you host and play; share the code to add friends." It replaces "No article handy? Play a short sample one." so there's one line, not two. Button label unchanged ("Try it yourself"). Header comment updated.
- `tests/landing.spec.ts`: the link locator and the 4th test's title use the new text. No other spec touched.
- `CLAUDE.md`: the sign-in gotcha line names the new link text.

Verified: tsc clean, eslint clean, vitest 58/58. `npx deepspace test run all`: 23 passed (4/4 landing). `membership-resubscribe` ✘ is its expected `test.fail()`.

Not verified / risks: the "→" is in the link's accessible name, so screen readers read it out ("right arrow"). Nothing was viewed in a browser.

## 2026-11-18 — Research: Exa topic search, guest joining (no code)
Did: Research only. No source files changed; only this entry added. Read `npx deepspace integrations list` / `integrations info exa/search` (catalog and schema only, nothing invoked), docs `/agents/web-search-image-generation-no-api-keys.md`, `/guides/authentication.md`, `/sdk-reference/client/auth.md`, `/concepts/permissions.md`, `node_modules/deepspace/dist` (v0.44.2), our `src/server/action-routes.ts`, `realtime-routes.ts`, `http-routes.ts`, `src/integrations.ts`, schemas. Shallow-cloned github.com/deepdotspace/doodlechain into the session scratchpad to read it (nothing copied into this repo).
Findings:
- A. Exa is in the catalog: `exa/search` (also `contents`, `findSimilar`, `news-search`, `answer`), billed "at the provider's actual cost plus platform markup", no per-call figure published. The output schema requires only `title`, `url`, `publishedDate`, `author`, `id`; `text` comes back only if you ask for `contents.text`, and its shape isn't documented. The response carries `costDollars.total` / `costUsd`. Exa → URL → the unchanged Firecrawl → `runQuestionPipeline` path is possible. Sketch given in chat; nothing built.
- B. No guest sessions with a verified userId. The only sign-in methods are Google, GitHub and email/password. A signed-out socket gets a random `anon-<uuid>` per connection (`worker.js:245`) with role `viewer`, and isn't registered as a user (`worker.js:3380`). Server actions return 401 without a verified bearer JWT (`src/server/action-routes.ts:46-56`). Doodlechain gets around this with its own Durable Object (a vendored `GameRoom`) plus a client-chosen localStorage `cid`, which is not SDK auth. Stopped there as instructed.
Verified: catalog and schema output read directly from the CLI; SDK and repo lines read directly.
Not verified / risks: Exa per-call cost (not documented; would only show up in a real call's `costUsd`); that `tools.integration('exa/search')` works from the job with an empty caller JWT (inferred: firecrawl/scrape works through the same path today); the format of the `text` field.

## 2026-11-18 — Topic rooms via Exa, rooms.sourceUrl (+ plan for /join/<code>)
Did:
- `createRoom` takes exactly one of `{ url }` | `{ topic }` | `{ sample: true }`. Topic rules: trimmed, 3–200 chars, no control characters, must not start with http(s)://. Topic rooms use the same `room_quota` slot as links. The quota message now says "links or topics". Files: `src/lib/create-room-params.ts`, `src/actions/index.ts`.
- Job (`src/jobs.ts`): when the payload has a `topic`, it first calls `searchArticle` (`src/server/generation.ts`): `exa/search` with `numResults` 5, `type` 'auto', `excludeDomains` = `SEARCH_EXCLUDED_DOMAINS` (youtube, x, twitter, tiktok, instagram, facebook, reddit), timeout `SEARCH_TIMEOUT_MS` = 10 s. Then the unchanged `runQuestionPipeline(url)`. No usable result → `USER_MESSAGES.noArticleFound`. A failed or malformed call → `serviceUnavailable`.
- `readSearchResponse` (pure, `src/lib/questions/responses.ts`) picks the first http(s) result not on an excluded site or its subdomains, and returns `noneFound` plus a metrics line (result count, costUsd).
- Logs never contain the topic, the chosen URL, or the provider's error text on a failed search.
- `rooms.sourceUrl` column (`src/schemas/rooms-schema.ts`, optional, no migration needed per docs `/agents/add-field-existing-app-without-losing-data.md`). Set by `finishGeneration` together with `lobby` for url and topic rooms. Empty for the sample.
- UI: new `src/components/game/SourceLink.tsx` (links only http(s) values, `rel="noopener noreferrer"`), used in `Lobby.tsx` and the finished screen in `room/[roomId].tsx`. `/create` has a second form, "Or a topic" → "Find an article".
- `SEARCH_TIMEOUT_MS` added to `src/lib/generation-timing.ts`. Worst case is now 10 + 30 + 2 × 60 = 160 s < `STALE_GENERATING_MS` (180 s, unchanged).
- Tests: `create-room-params.test.ts` (topic cases, exactly-one-of), `pipeline.test.ts` (5 `readSearchResponse` cases, timing inequality including search). `CLAUDE.md` updated (rooms row, createRoom `{ topic }`, timing, responses.ts, the no-url/topic-in-specs rule).
Verified:
- `npx vitest run src/lib`: 62 passed (55 before this change).
- `npx tsc --noEmit -p .`: no errors.
- `npx deepspace test run all`: 23 passed. These cover sample rooms only, so they check that nothing regressed. They don't exercise topics or the link.
Not verified / risks:
- No real `exa/search` call made. Not yet confirmed against a live response: the response shape (taken from the `integrations info` output schema), that the call works from the job with an empty caller JWT, that `excludeDomains` is honoured, and the per-call cost.
- The `SourceLink` link and the topic form haven't been looked at in a browser.
- Thrown errors (e.g. a network failure inside `tools.integration`) are still logged with their message by the job's catch block. I don't expect it to contain the query, but haven't seen one.
- Rooms created before this change have no `sourceUrl`, so they show the title without a link.

## 2026-11-18 — Plan: /join/<code> link that survives sign-in (deferred; revisit only if playtesting shows typing the code is a problem)
Status: plan only, nothing built. No invite-link button.
Problem: Google/GitHub sign-in always lands on /home. The SDK starts OAuth with a fixed `window.location.href = /api/auth/social-redirect?provider=X` (`node_modules/deepspace/dist/index.js:1020`). Our `social-redirect` sends only the app origin as `returnTo` (`src/server/http-routes.ts:93`), and `oauth-complete` always redirects to `/home` (`http-routes.ts:107`). Email sign-in happens in place and keeps the URL.
Plan (client only; no data-model, permission, scoring or state-machine change; `joinRoom` still does every real check):
1. Route `/join/:code`: move `(protected)/join.tsx` to `join/index.tsx` and add `join/[code].tsx`. Confirm Generouted accepts that layout. When signed in, the page checks the code (6 characters from `CODE_ALPHABET`), clears any saved code, and once `useMutations().ready` calls `joinRoom(code)` once, then goes to `/room/<roomId>`. If joining fails, it shows the join form filled in with the code, plus the error.
2. The SignedOutPanel's Sign in button saves `{ code, savedAt }` to sessionStorage, only when the path is `/join/<valid code>`. sessionStorage is per tab and survives the round trip to the OAuth provider. Only a validated code is stored, never a path, so there's no open redirect.
3. `/home`, when signed in: if a saved code is under 10 minutes old, remove it and `navigate('/join/<code>', { replace: true })`. An older one is just removed.
4. Email sign-in is in place, so step 1 handles it and clears the saved code.
Tests if built:
- Unit tests for the save/read/expiry helper.
- `landing.spec.ts`: signed out, `/join/ABC234` shows the sign-in panel.
- `game-ui.spec.ts` (label `sourcerush-ui`): a signed-in player opening `/join/<code>` lands in the lobby.
- The OAuth round trip can only be checked by hand on a deploy (the test accounts use email).

## 2026-11-18 — SourceLink only on Game over; topic refusal specs; lint + full test runs
Did:
- `src/components/game/Lobby.tsx`: back to the plain "Article: <title>" text (no link), with a comment saying why. `SourceLink` is now used only on the finished screen (`room/[roomId].tsx`); its header comment updated. The `sourceUrl` column is unchanged.
- `tests/game.spec.ts`, "createRoom refuses bad input before creating anything": added `{ url, topic }`, `{ topic: 'ab' }` and `{ topic: 'https://example.com/tides' }` to the existing refusal list. The test now also counts the rooms the host can read before and after (raw `core.subscribe` probe) and expects no change. All three are refused by `parseCreateRoomParams` before any quota slot, room or job, so no paid call is possible.
- The /join/<code> plan is recorded above, marked deferred.
Verified:
- `npx eslint .`: exit 0, no output.
- `npx vitest run` (whole repo): 8 files, 65 tests passed (incl. `prerender.test.ts` and `src/prerender-entry.test.tsx`, outside src/lib).
- `npx deepspace test run all`: exit 0, 23 passed. The `[refuse]` lines show each new case refused with its own message: "Paste an article link, enter a topic, or choose Try it yourself." / "Enter a topic of at least 3 characters." / "That looks like a link. Paste it in the article link box instead." `membership-resubscribe.spec.ts` shows ✘ by design (`test.fail()`, the known SDK issue), the same as before.
- No real topic rooms were created.
Not verified / risks:
- The room count relies on the tests in `game.spec.ts` running one at a time (Playwright's default without `fullyParallel`, which the config doesn't set).
- `sourceUrl` is still synced to room members during rounds, so a modified client can read it. The plain title already allows a web search, so this only removes the easy click.
- The Game over link and the /create topic form still haven't been looked at in a browser.

## 2026-11-18 — Room-count check in game.spec.ts: explicit limit, fail loudly near it
Question: what limit did the before/after `rooms` count use? Answer:
- None. A socket `core.subscribe` with no `limit` is uncapped. `handleSubscribe` → `executeQuery` → `executeTableQuery`, and for a permission-filtered collection with no limit it reads the whole table (`node_modules/deepspace/dist/worker.js:2172-2175`, `2321`).
- So the old check couldn't pass vacuously today. `DEFAULT_QUERY_LIMIT = 50` (`worker.js:1135-1140`) applies to the server-side `tools.query`, not to the socket.
- Passing a limit adds a different cap: the filtered scan stops after `MAX_FILTERED_SCAN_ROWS` = 5000 rows of the whole table (`worker.js:2179`, `2337`).
Did: `tests/game.spec.ts`, refusal test.
- Both probes pass `limit: ROOMS_PROBE_LIMIT` (500, the same as `ROOM_QUERY_LIMIT` in `src/actions/index.ts`).
- The before count is logged, and asserted `< 500` with the message "too many local rooms for this check; clear local dev data".
Verified:
- `npx deepspace test run all`: exit 0, 23 passed (resubscribe spec ✘ by design, `test.fail()`). Log line: `[refuse] host can read 34 rooms before (limit 500)`.
- `npx eslint tests/game.spec.ts`: exit 0.
- The whole local `rooms` table has 133 rows (read-only `sqlite3` count on `.wrangler/state/v3/do/sourcerush-AppRecordRoom/*.sqlite`), well under the 5000-row scan cap.
Not verified / risks:
- The host gains about 1 readable room per full run (the full-round test's sample room), so the `< 500` assertion trips after roughly 466 more runs.
- The 5000-row scan cap counts all rooms from every account, not just this host's, so local data should be cleared long before either limit. Nothing asserts the table size.

## 2026-11-18 — First real topic room (run by hand), result
Log (pasted by the human; room ed6aa8d4-…):
- `search 1682 ms, results 5, costUsd 0.007`
- `scrape 16055 ms, creditsUsed 1, costUsd 0.0038`
- `only 1817 chars of text after cleanup (need 2000)`
- `done in 17769 ms -> failed`
What it shows:
- exa/search works from the job with an empty caller JWT.
- The response has `results` and a numeric `costUsd`, as `readSearchResponse` expects.
- The chosen URL was http(s) and scrapeable.
- The log lines contain no topic and no URL.
- The first usable result was too short, so the room failed with `USER_MESSAGES.tooLittleText` ("There isn't enough article text on that page to make a quiz."). That message is worded for a pasted link; the topic host never chose a page.
- Total cost of the failed room ≈ $0.011 (search + one scrape). No generation was spent.
Did: `src/lib/questions/responses.ts` header comment now records the confirmed exa/search shape. Comment only.
Verified: `npx vitest run src/lib`: 62 passed.
Not verified / risks: whether `excludeDomains` is honoured (the picked site is unknown, since URLs aren't logged). The `costDollars.total` fallback hasn't been seen in a real response. Options for short articles were proposed in chat; nothing built.

## 2026-11-18 — Topic rooms: reworded "that page" failures (option 1)
Did:
- `src/lib/questions/pipeline.ts`: new `USER_MESSAGES.topicArticleUnusable` = "The article we found didn't have enough usable text. Try a different topic."
- New pure `topicRoomResult(result)` in the same file: maps `tooLittleText` and `pageUnreachable` to `topicArticleUnusable` and returns every other result (success included) unchanged.
- `src/jobs.ts`: applies `topicRoomResult` to the pipeline result only when the payload has a `topic`. Link rooms keep their current messages. `runQuestionPipeline` is unchanged. `errorMessage` is still always a `USER_MESSAGES` entry.
- `src/lib/questions/pipeline.test.ts`: new `topicRoomResult` block with three tests (rewords both cases and keeps the log; leaves the other failures and success unchanged; always yields a `USER_MESSAGES` entry). The existing raw-error test uses `Object.values(USER_MESSAGES)`, so it already includes the new constant.
- `CLAUDE.md`: topic-room bullet notes the rewording.
Verified:
- `npx tsc --noEmit -p .`: exit 0. The first run failed on readonly `as const` test data; I retyped it as `PipelineResult`.
- `npx eslint .`: exit 0.
- `npx vitest run`: 8 files, 68 passed (65 before).
- `npx deepspace test run all`: exit 0, 23 passed (resubscribe spec ✘ by design, `test.fail()`). Refusal check log: 35 rooms before (limit 500).
- No real topic rooms were created.
Not verified / risks:
- The new message hasn't been seen in a real room. The job wiring (`payload.topic !== undefined ? topicRoomResult(...) : ...`) has no test: the job calls real integrations, so specs can't run it.
- `pageUnreachable` only fires on an HTTP error status from the scrape. A scrape that fails or times out still gives `serviceUnavailable`, for both room kinds.
Deferred (option 2, not built; design fixed by the human): `readSearchResponse` returns up to 2 usable URLs. The job tries the second only when the first fails with `tooLittleText` or `pageUnreachable`, never after generation has run. `runQuestionPipeline` stays unchanged. `STALE_GENERATING_MS` goes to 210_000 and the timing test is updated.

## 2026-11-18 — Round length 20 s → 60 s
Did: `QUESTION_DURATION_MS` 20_000 → 60_000 in `src/lib/scoring.ts` (kept the existing name; it is already the single source for `openQuestion`'s `endsAt`, `scoreFor`'s clamp and divisor, and the display-only `scoreFor` in `RevealView`, so no other code changed). `src/lib/scoring.test.ts`: the rounding test's exact value depended on the divisor (500×1234/20000 = 30.85 → 531); changed to 1300 ms (500×1300/60000 = 10.83 → 511) so it still checks rounding up. Other score tests are written in terms of the constant. `tests/game.spec.ts`: constant assertion → 60_000, test timeout 120 s → 180 s (check 6 waits out a full round). `tests/game-ui.spec.ts`: Q2 (closes on time) wait 35 s → 75 s, comment updated; overall 240 s timeout unchanged. `CLAUDE.md`: `openQuestion` and `revealQuestion` lines. No test-only timer switch.
Grep (`20000|20_000|20 s|20s|QUESTION_DURATION_MS` over src, tests, CLAUDE.md): the hits above, plus `src/lib/generation-timing.ts:9` ("20 s margin", 180 − 160 s for generation), which is unrelated and unchanged. `STALE_GENERATING_MS` and the generation timing test don't use the round length.
Verified: `tsc --noEmit` exit 0; `eslint src tests` exit 0; `npx vitest run`: 8 files, 68 passed. `npx deepspace test run all`: exit 0, 23 passed (membership-resubscribe ✘ is its expected `test.fail()`), 1.3 min Playwright / 1:26 wall. game-ui 1.1 min (30.6 s last logged), game.spec full round 1.1 min. Check 6 late submit still rejected (`Time's up.`); check 5 scores matched `scoreFor` (973–986 for quick answers).
Not verified / risks: not played by hand in two browsers at 60 s. A round with a player who never answers now takes up to 60 s before the auto reveal.

## 2026-11-18 — Topic-room question prompt + difficulty ramp
Did: `src/lib/questions/prompt.ts`: `SourceKind = 'link' | 'topic'`; `buildQuestionPrompt(input, kind)` (kind required); `SYSTEM_PROMPT` replaced by `systemPrompt(kind)`, built from shared rules plus per-kind opening rules and wrong-choices rule; new `DIFFICULTY_RAMP` line for both kinds; `trimSource()` extracted. Topic prompt: questions a reasonably informed person could answer without this article; no author/publication, the article's own examples/anecdotes or figures specific to it, no "according to the article/the author says"; every answer still supported by the source; wrong choices aimed at partial understanding of the topic; it drops the link rule "answerable from the source text alone. Do not use outside knowledge." Topic user line: "…questions about the topic of the following source." `prepare.ts` uses `trimSource` (it called `buildQuestionPrompt` only for `sourceUsed`, which doesn't depend on kind). `pipeline.ts`: `runQuestionPipeline(url, deps, kind)` passes kind to the prompt; control flow unchanged. `src/jobs.ts`: `'topic'` when the payload has a topic, else `'link'`. `src/actions/index.ts`: sample passes `'link'` (`SAMPLE_PIPELINE_DEPS.generate` takes no arguments, so the prompt is ignored). Tests: new `prompt.test.ts` (5), 2 new in `pipeline.test.ts` (prompt follows kind; question order kept), existing calls get `'link'`, `fixtures.test.ts` uses `trimSource`. CLAUDE.md: `{ topic }` paragraph, `prompt.ts`/`prepare.ts`/`pipeline.ts` bullets, unit test list.
Unchanged: validator, `parseModelOutput`, 12 requested / 8 needed, `MIN_ARTICLE_CHARS`, model, schema, scoring. The host's topic text is not passed to the model (second injection surface, and it must stay out of logs); revisit only if real runs drift onto neighbouring subjects.
Order: `validateQuestions` keeps input order (`forEach` → `push`), `prepareQuestions` maps `shuffleChoices` (choices + `correctIndex` only), `storeQuestions` writes `index` from `.entries()`, `openQuestion` takes `currentIndex + 1`. Validation can drop questions, so some of the harder ones may be the ones dropped.
Verified: new link system prompt vs the old `SYSTEM_PROMPT` (from `git show HEAD`, dumped with Node): the only diff is the added ramp line. Link vs topic diff is exactly the planned lines. `tsc --noEmit` exit 0, `eslint src tests` exit 0, `npx vitest run` 9 files, 75 passed (68 before). Mutation checks, each reverted: removing the ramp line → 1 failure; ignoring kind → 2 failures; reversing question order in `prepareQuestions` → 2 failures. `npx deepspace test run all`: 22 passed, 1 failed (`collab.spec.ts:65`, the known scaffold flake: "Loading integration catalog..." not seen), plus the expected `test.fail()` in membership-resubscribe; 1:26 wall. That spec then passed 3/3 on its own (`--grep`). game-ui 1.1 min and game.spec full round 1.1 min (sample path, `'link'`).
Not verified / risks: no real model call was made. Whether the model follows the topic rules and the ramp is only checked by your real runs (two topic rooms incl. "stack data structure", one link room). The job's kind selection (`payload.topic !== undefined`) has no automated test, since specs may not create url/topic rooms. The topic prompt allows questions on what an informed person knows, but the validator still requires a verbatim passage, so expect some rejections if the model leans on general knowledge.

## 2026-11-18 — Deferred: difficulty labels with weighted points, host difficulty selector
Did: nothing (recorded as deferred).
Reason: (1) Per-question difficulty labels with weighted points: the label would be unverifiable model output, and it would feed straight into scoring, so the model could change a player's score. (2) A host difficulty selector: needs new `createRoom` params, validation and UI, which is out of scope this close to the deadline. The prompt's easiest-first ramp is the only difficulty change made.

## 2026-11-18 — Visual restyle (client only): SourceRush theme, self-hosted fonts
Did: replaced the scaffold's `slate` placeholder with SourceRush tokens in the `@theme static` block of `src/styles.css` (the single place for colour, font, radius, shadow and motion; `static` so var()-only tokens such as durations are emitted). Palette: navy `#0b1426` base, card `#14223d`, cyan primary `#5cd6ea`, coral `highlight` `#ff8aa1` (room code, scores, countdown ≤ 10 s), success `#5ee59a`, destructive `#ff7b7b`, control border `input` `#5874ab`, `overlay`. Radius 0.25rem. Shadows: Tailwind's xs/sm/md/lg overridden, plus `press`, `press-active`, `card`, `overlay`. Motion: `--ease-out`, `--duration-fast/base/enter/hero/pulse`, `--stagger`; `animate-enter`, `animate-enter-hero`, `animate-correct`; utilities `bg-page`, `transition-press`, `transition-tone`, `enter-delay-1/2`. Base layer: body `--font-sans`, h1/h2 `--font-display`, a `prefers-reduced-motion` block (animation/transition ≈ 0, no press drop).
Fonts: Space Grotesk (variable 400–700) + Space Mono 400/700, latin woff2 subsets from Google Fonts saved unmodified to `public/fonts/` with `public/fonts/OFL.txt` (both copyright lines + OFL 1.1 text). `@font-face` in styles.css (`font-display: swap`), two `<link rel="preload">` in index.html. No Google requests at runtime.
Theme rename: `index.html` `data-theme="sourcerush"` + first-paint `#0b1426`; `src/themes.ts` entry/fallback; themes.css header comment. No theme picker exists (Settings shows name/email/sign-out only) and nothing stores a theme (no localStorage/records). The tokens are the `@theme` defaults, so any `data-theme` value without its own block, including an old `slate`, renders the new theme.
Primitives: `Button` (mono display font, 2px borders, single press effect = `shadow-press` → `shadow-press-active` + 2px drop via `transition-press`; h-10→h-11), `Input`/`Textarea` (2px `input` border, cyan focus ring), `Label` (mono, letter-spaced, muted), `Badge` (square), `Dialog` (`bg-black/60` → `bg-overlay`, literal shadow → `shadow-overlay`).
Class-only edits (no text, testid, role or structure changes): `QuestionView` (enter animation, countdown `text-highlight` when `secondsLeft <= 10`, prompt + choices `font-sans`, locked-in card), `RevealView` (`green-600` → `success`, `animate-correct` once, enter), `Lobby` (enter, room code coral, card list), `Leaderboard` (card, score coral), `ReturnToRoomLink`, `SourceLink`, room page (Game over enter, card shadows, failed card), `SignedOutPanel`, `Navigation` (app name mono/cyan, sign-in button press), `_app.tsx` (`bg-page`), `(app)/_layout.tsx` (dropped opaque bg so the gradient shows), landing `index.tsx` (CSS-keyframe stagger; one wrapper div around the eyebrow + h1).
Hardcoded colour grep (`(bg|text|border|ring|…)-(red|green|slate|gray|…|black|white)` + literal hex/rgba in tsx): only `RevealView` `green-600` and `Dialog` `bg-black/60` + `rgba` shadow; all moved to tokens. None left.
Entry animations: CSS animations run only when the element is inserted. They sit on each screen's root (Lobby, QuestionView, RevealView, finished), which React keeps as the same DOM node across live re-renders; QuestionView is rendered with `key={questionId}`, so it remounts only per question. No text-transform on anything specs match (Playwright reads innerText).
Game-flow task (locked-in state, red/green reveal, leaderboard count-up): not built. Only the existing locked-in card and green correct choice were restyled; there is no wrong-answer red state or count-up yet. They should use `destructive`/`success`/`highlight` and must not add a second press effect.
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx vitest run` 9 files, 75 passed; `vite build` exit 0 (fonts in `dist/client/fonts/`, @font-face + tokens in the built CSS, no googleapis/gstatic anywhere). `npx deepspace test run all`: exit 0, 23 passed + the expected `test.fail()` in membership-resubscribe, 1.4 min. A one-off spec (scratchpad, copied into tests/ for one `--grep` run, then deleted; account label `sourcerush-ui`, 1 user, Try-it room) at 390 px: screenshots of /, /home, lobby, question, question ≤10 s, reveal, Game over; dev server `GET /fonts/*.woff2` → 200 `font/woff2`, `OFL.txt` → 200 `text/plain`; `document.fonts` loaded Space Grotesk 400–700, Space Mono 400 and 700; choices + prompt computed `Space Grotesk`, countdown `Space Mono`; countdown `rgb(232,238,248)` above 10 s, `rgb(255,138,161)` at ≤10 s; question root stayed the same DOM node across ~50 one-second re-renders with its entry animation `finished` (not replayed); reveal root was a new node; reduced motion → animation-duration and button transition `1e-05s`, opacity 1; no requests to any non-local host. (First run of that spec failed: my play-out loop was too short for 8 questions; fixed the loop, reran, passed.)
Contrast (computed from hex, WCAG formula): foreground ≥ 10.9:1 and muted-foreground ≥ 6.0:1 on background/card/accent; primary 10.7, highlight 7.1–8.2, success 9.9+, destructive 6.3+ as text; each *-foreground on its fill ≥ 7.5:1; `input` border 3.9:1 on background, 3.4:1 on card.
Not verified / risks: NOT deployed, so the deployed app serving `/fonts/*` with `font/woff2` is unchecked (dev server only; Cloudflare's asset layer infers type from the extension, but that's an expectation). Fonts are latin-only: `→` (U+2192) and non-latin names fall back to system fonts. Reveal/Game-over screenshots cut at the viewport because the room page scrolls inside `<main>`, so the leaderboard/Next under the reveal passage weren't captured. Not checked in Safari/Firefox, on a real phone, or with Windows high-contrast mode. Paper (light) theme untouched and doesn't define `highlight`/`overlay`, so it would show the dark values if switched on.

## 2026-11-18 — Choices stay on screen through the reveal; wrong pick red, pop + fade on reveal
Did: new `src/components/game/ChoiceList.tsx`, used by both QuestionView and RevealView: answer buttons `choice-0..3` while open; once picked, a static `<ul>` with the pick outlined in primary (same box: border-2, padding, min height, so nothing moves); on reveal the pick gets `animate-reveal-pick` (scale 1 → 1.03 → 1 while its border/tint fade from primary to `success` or `destructive`) and the correct answer, if not picked, `animate-reveal-answer` (fade from the plain border to green). `locked-choice` testid moved onto the pick's text span (locked state only); `answer-locked` is now an "Answer locked in" line under the list; `correct-choice` unchanged. QuestionView: the pick is shown as locked as soon as it's clicked (set before the `submitAnswer` call, cleared with the error if the server rejects it); the `busy` flag is gone. RevealView: header row + prompt size match the question screen; root has no entry animation; while `question.reveal` hasn't synced it renders the same top (choices as locked) + "Revealing…" instead of only "Revealing…"; `my-result` text is green/red/muted. `src/styles.css`: `--duration-pulse`/`--animate-correct`/`correct-pulse` replaced by `--duration-reveal` (520ms), `--animate-reveal-pick`, `--animate-reveal-answer` + keyframes (start keyframe only, so the end state comes from the classes and reduced motion lands on the final colours).
Cause of the blink (all three removed): (1) QuestionView replaced the buttons with a locked-in card; (2) RevealView showed only "Revealing…" until the reveal synced; (3) RevealView's root replayed the 280ms screen entry from opacity 0. A one-off frame check also caught (4): all four buttons dimmed to 50% opacity (`disabled` while `busy`) during the submit round-trip.
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx vitest run` 9 files, 75 passed. One-off spec (scratchpad, copied into tests/ for one `--grep` run and deleted; `sourcerush-ui`, 1 user, Try-it room, 390px): answered wrong, a requestAnimationFrame loop checked every frame from click to 800ms after the reveal that all 4 choice texts were in `<main>` and fully opaque. First run: 1/72 frames bad (the busy dimming), fixed as above; second run 0/66 bad. After the reveal: pick border `rgb(255,123,123)` with `reveal-pick`, correct `rgb(94,229,154)` with `reveal-answer`, result text red, no `choice-N` buttons left. Screenshots mid-animation and settled. `npx deepspace test run all`: exit 0, 23 passed + the expected `test.fail()` in membership-resubscribe, 1.3 min. No spec edits needed (game-ui:88 "no `choice-0` after refresh" still holds: locked choices aren't buttons).
Not verified / risks: the rejected-submit path (pick clears, buttons return with the error) has no automated UI test; specs reject late submits via `callAction` only. "Answer locked in" now shows for the ~100ms before the server confirms. If the submissions row arrives after the room switches to `reveal`, the pick would first render without "(your answer)" and then pop when it syncs (not seen; the row is written before `answeredCount`). Not played in two real browsers.

## 2026-11-18 — "too many SQL variables" on the room page: retire old memberships
Cause: the SDK's `'team'` read (`node_modules/deepspace/dist/worker.js` `executeTableQuery`, ~2246) loads every active `team_members` row of the caller and binds each team id as its own `?` in `"roomId" IN (…)`; DO SQLite allows 100 bound parameters. The `sourcerush-ui` host (`JiD2TL40…`) had 97 memberships in local dev (copy of the record-room DB, read with sqlite3): `questions` (97 + userId + roomId + index + limit = 101) failed, `rooms` was at exactly 100. Real users would hit it after ~96 games, since nothing retired memberships.
Decision (human, option 1 of 3): retire old memberships. Refined while building: by membership age only, not room status, so no per-room read (subrequests) and finished games stay readable for 2 h.
Did: `src/lib/room-age.ts` (`ACTIVE_ROOM_MAX_AGE_MS` = 2 h, moved from ReturnToRoomLink; `RETIRE_BATCH` = 40; pure `membershipsToRetire(rows, now)`: older than the cutoff, oldest first, capped, unreadable dates kept) + `room-age.test.ts` (3). `src/actions/index.ts`: `retireOldMemberships(tools, userId)` (query own active memberships, update the picked ones to `status: 'left'`, log count) called at the start of `createRoom` and `joinRoom`; `joinRoom` sets a retired membership back to `active` on rejoin. `ReturnToRoomLink` imports the shared constant. CLAUDE.md: `team_members` status values, joinRoom rejoin, retirement bullet. No schema change (`status` already existed; the SDK counts only `active`/empty).
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx vitest run` 10 files, 78 passed. `npx deepspace test run all`: exit 0, 23 passed + the expected `test.fail()` (membership-resubscribe), 1.3 min. Server log: 12 retirement lines, incl. "retired 40 of 40 (active before: 97)". One "too many SQL variables" line, at the start of the run: same subscriptionId as the human's paste, i.e. their old tab reconnecting before any retirement; none after. DB copy afterwards: `JiD2TL40…` 99 rows, 19 active, 80 left; other test accounts 3–7 active.
Not verified / risks: the rejoin reactivation path has no automated test (specs can't make a membership 2 h old). A user who joins 97+ rooms within 2 h would still hit the SDK limit (no hard cap). A player opening an old room URL after 2 h sees "You're not in this room"; joining again by code restores it. Retirement adds one query + up to 40 updates to the first createRoom/joinRoom of a user with a backlog. Upstream: the SDK should use a subquery (`IN (SELECT col_teamid FROM c_team_members WHERE …)`) instead of one parameter per team; not reported yet.

## 2026-11-18 — Live progress while a room is generating
Decision (human): real steps via a new `rooms.generationStep` field (not client timers); no early article title.
Did: `src/lib/generation-steps.ts` (pure): values `${kind}:${step}` (`topic:searching|reading|writing|rewriting`, `link:reading|writing|rewriting`), `stepValue(kind, step)` (never `link:searching`), `stepRows(value)` → rows `{label, state: done|current|todo}` or null for missing/unknown; `rewriting` keeps the writing row current with label "Writing questions again (a second try)". `generation-steps.test.ts` (7). `src/schemas/rooms-schema.ts`: optional select column `generationStep` (options = `GENERATION_STEP_VALUES`; optional, so no migration, as with `sourceUrl`). `createRoom`: url/topic rooms are created with the first step (`link:reading` / `topic:searching`); sample has none. `src/server/generation.ts`: `setGenerationStep` (update, try/catch, warn on failure, never throws). `src/jobs.ts`: the pipeline's `scrape` dep records `reading` before scraping; `generate` records `writing` (attempt 1) / `rewriting` (attempt 2) before each call. Pipeline modules unchanged. `src/components/game/GeneratingStatus.tsx`: heading, "up to about two minutes" note (worst case 160 s), step list (✓ done in success, spinner ring current with `aria-current="step"`, hollow todo; sr-only state text), `aria-live="polite"` line announcing the current step, m:ss elapsed from the room's createdAt (`useElapsedSeconds` in hooks.ts). Root keeps `data-testid="generating"`, `animate-enter` once on mount. Room page uses it; the 180 s "taking longer than expected" card is unchanged. `types.ts`: `Room.generationStep`. CLAUDE.md: rooms row, Progress bullet, modules, unit test list.
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx vitest run` 11 files, 85 passed. `npx deepspace test run all`: exit 0, 23 passed + the expected `test.fail()` (membership-resubscribe), 1.3 min; no "could not record step" lines. Visual: the real component rendered to static HTML (esbuild bundle in scratchpad + `renderToStaticMarkup`) with the built CSS and self-hosted fonts, screenshot at 390 px for topic:searching, topic:reading, topic:rewriting, link:writing and no step: as intended.
Not verified / risks: no url/topic room was created (specs may not; it's a paid job), so the job's step writes and the live update on a real room are unchecked. Please run one topic room and one link room by hand and watch the list advance. The step is written just before each step starts, so a fast step may flash by. The elapsed time uses this device's clock against the server's createdAt (clock skew shifts it). If the worker dies mid-job, the list stays on its last step until the 180 s card.

## 2026-11-18 — Generating progress: more steps after the model call, final tick
Problem (human): the last row ("Writing and checking questions") never ticked, and it took ~90% of the time while the first two flew by.
Facts: the model call is one integration request (no streaming), so it has no measurable sub-steps. Real runs: generate 19.6 s and 28.1 s, scrape 1.1–16 s, search 1.7 s (AGENT_LOG "Real runs after the reader fix" + topic-room entries). The last row never ticked because the lobby replaced the page the moment the job finished.
Did: `generation-steps.ts`: steps `checking` and `saving` (values `topic:checking|saving`, `link:checking|saving`; schema options follow `GENERATION_STEP_VALUES`, still optional, no migration); rows now Finding (topic only) → Reading → Writing questions → Checking answers against the article → Saving the quiz; `StepRow.slow` marks the writing row; `stepRows(value, complete)` ticks every row when complete. Tests updated/added (9 in the file). `jobs.ts`: records `checking` when a generate call returns ok (the pipeline then parses + validates; a too-few result regenerates and records `rewriting`), and `saving` before `finishGeneration` when the result is ok. `GeneratingStatus`: on the current writing row a "The longest part, usually 20–30 seconds." hint (from the two real runs) and an indeterminate activity bar (`animate-activity`, new `--duration-activity` 1400 ms + `activity` keyframes in styles.css; no percentage); `complete` prop → heading "Quiz ready", "Opening the lobby…", all ticks, elapsed stops. `hooks.ts`: `useJustFinishedGenerating(status, 900)` (previous status in state; true for 900 ms after generating → lobby seen live; never on a page that first sees lobby). Room page renders `GeneratingStatus complete` in that window (same component in the same slot, so no remount or entry replay). CLAUDE.md Progress bullet.
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx vitest run` 11 files, 87 passed. Static render of the real component + built CSS at 390 px for topic:writing (hint + bar), topic:checking, link:saving and topic:saving + complete: as intended. `npx deepspace test run all --port 5199` (5173 was busy with the human's dev server): 22 passed, 1 failed = `collab.spec.ts:65` "Loading integration catalog..." not visible (the known scaffold flake, same as the 2026-11-18 difficulty-ramp entry), + the expected `test.fail()`; that spec then passed 3/3 alone (`--grep`).
Not verified / risks: no real url/topic room run (paid; specs may not). `checking` and `saving` are fast, so they'll likely flash by; most of the wait is still the writing row. "20–30 seconds" rests on two runs. The 900 ms "Quiz ready" moment delays the lobby by that much for a host watching live. A host who refreshes during generation still gets the moment; one who opens the room after it reached the lobby does not.

## 2026-11-18 — Change display name; "Your answers" summary on Game over
Decision (human): a new optional `users.displayName` column (not `users.name`: the SDK's `SYSTEM_ASSIGNED_COLUMNS` refuses writes to it and `upsertUser` resets it from the identity provider on every sign-in, `node_modules/deepspace/dist/worker.js` ~706 and ~2516); a rename propagates to rooms still in `lobby` only.
Did: `src/lib/display-name.ts` (pure: `DISPLAY_NAME_MAX` 24, `parseDisplayName`, `pickDisplayName`) + `display-name.test.ts` (6). `src/schemas/users-schema.ts`: `displayName` column added after `...USERS_COLUMNS` (optional, no migration; permissions unchanged). `src/actions/index.ts`: `displayNameFor` uses `pickDisplayName`; new `setDisplayName` action (validate → update own users row → for each active membership, if the room is `lobby`, update the caller's players row; per-room failures logged only). `settings.tsx`: Display name form (prefilled with the current name, Save disabled until `useMutations().ready`, valid and changed; "Saved." on success; sign-in name shown under "Your account"). New `src/components/game/GameSummary.tsx` on the Game over screen under the leaderboard: one row per question (✓/✗/– , prompt, your wrong pick, the correct answer); each row queries its own submission by `questionId` (the SDK `where` is equality-only). No per-question points: a question's `endsAt` isn't stored. Specs: `game.spec.ts` new test "setDisplayName: …" (bad names refused, saved name used by createRoom, lobby rename updates players, rename after start doesn't, saved on users row); `game-ui.spec.ts` checks every player's summary rows at Game over (Q1 right/wrong as played, Q2 "none", Q3+ right or wrong, p1's wrong-pick text). CLAUDE.md: users row, setDisplayName bullet, unit test list.
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx vitest run` 12 files, 93 passed. `npx deepspace test run all`: 24 passed incl. the expected `test.fail()` (membership-resubscribe), 1.4 min; `[name]` lines show each refusal message and `renamedRooms: 1`; `[summary]` lines e.g. `["correct","none","wrong",…]` (8 rows). One-off spec (copied into tests/ for one `--grep` run, then deleted; `sourcerush-ui`, 1 user, 390 px): Save disabled when unchanged/empty, input capped at 24, Save → "Saved.", value survives reload, new name shown in a Try-it lobby as "(you)"; screenshot checked.
Not verified / risks: the scaffold users permission (`update: 'own'`) lets a hand-modified client write any `displayName` on its own row, bypassing `setDisplayName`. `pickDisplayName` re-validates it on read, so a bad value never reaches a players row, but the row itself can hold junk; tightening the users permission would be a permissions change, so not done. The nav avatar still shows the sign-in name. A rename doesn't reach a lobby whose membership was retired (> 2 h old). GameSummary was not screenshotted; only its rows/text were asserted. Not deployed, so the new column on the deployed DB is unchecked.

## 2026-11-18 — "Your answers": answers in bordered boxes, no coloured text
Did: `src/components/game/GameSummary.tsx`: dropped the coloured ✓/✗ column and the green/red text lines. Each row now shows boxes (`AnswerBox`: rounded, border-2, normal `text-foreground`, a small muted caption): your pick, with a `border-success` box if right ("Your answer · correct") or `border-destructive` if wrong ("Your answer · wrong"); a plain `border-border` "No answer" box if you didn't answer; and, unless your pick was right, the correct answer in a `border-success` box ("Correct answer"). No fill, only the border is coloured. testids `summary-pick` / `summary-correct`; `summary-row` + `data-result` unchanged. `tests/game-ui.spec.ts`: the Q1 check now reads the boxes and their computed colours (p1 pick border red, correct box green, same text colour in both; the host's right pick green with no separate correct box).
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0. `npx deepspace test run all --grep "a full game through the UI"`: passed (1.2 m); log: pick `{"border":"rgb(255, 123, 123)","text":"rgb(232, 238, 248)"}`, correct `{"border":"rgb(94, 229, 154)","text":"rgb(232, 238, 248)"}`. Screenshot of the summary at 390 px (temporary line in the spec, removed after) shows the wrong / no answer / right layouts as intended.
Not verified / risks: the screenshot stops at question 4 (the room page scrolls inside `<main>`), so the lower rows were checked by the spec only. The full suite wasn't rerun for this change (only this spec touches the summary).

## 2026-11-18 — Name on the join screen, host name prompt after creating
Did: `/join` (`join.tsx`): "Your name" field under the room code, prefilled from new `useMyDisplayName()` (`src/components/game/hooks.ts`, own users row → `pickDisplayName`; Settings now uses it too); sends `name` to `joinRoom` only if changed; Join disabled while the name is loading or invalid. `joinRoom` (`src/actions/index.ts`): optional `name`, validated before any write; new player → used for the players row; existing member → renames only while the room is `lobby`; either way saved via new `saveDefaultName` (best effort, logged). `setDisplayName`: optional `roomId` → renames the caller in that room only (room must be `generating`/`lobby`, caller must have a players row), then `saveDefaultName`. New `src/components/game/HostNamePrompt.tsx` ("Your name in this game", Continue). `create.tsx` and `TryItYourselfButton` navigate with `state: { askName: true }`; the room page shows the prompt to the host above `GeneratingStatus` (also during the 900 ms "Quiz ready" moment) and in place of the lobby; Continue → `navigate(pathname, { replace: true, state: null })`. No schema, permission or status changes. Specs: `lobby.spec.ts` and `membership-resubscribe.spec.ts` click Continue; `game-ui.spec.ts` checks the prompt (prefilled, no room code, survives reload), host's new name in the lobby, p1's join-screen name seen by host and p1, p2 default; `game.spec.ts` name test now also covers joinRoom bad/good name (saved on users row), the host's per-room rename, and refusal after start. CLAUDE.md: joinRoom, setDisplayName, host prompt gotcha.
Verified: `tsc --noEmit` exit 0; `eslint .` exit 0; `npx deepspace test run all --port 5199` (5173 busy, likely the human's dev server): exit 0, 24 passed incl. the expected `test.fail()`. Ran membership-resubscribe once with `test.fail()` commented out (restored after): it fails at line 56 (`watching` player-count "3"), the known SDK issue, not at the new Continue step. One-off spec (created, run with `--grep`, deleted; `sourcerush-ui`): 390 px screenshots of /join and the prompt, both prefilled with the name saved by the earlier game-ui run.
Not verified / risks: no url/topic room was created (paid), so the prompt during real generation is unchecked by hand; the same branch renders for the sample's lobby, but please create one topic room and rename during generation. The prompt only appears when arriving from /create or Try it in the same tab (history state); opening the room in a new tab, or via Return to room, doesn't ask, and the host keeps their default name. A name changed on /join for a room that has already started is saved as the default but doesn't rename the player in that room. Players with a name prompt don't exist: only the host is asked (players choose on /join).

## 2026-11-19 — Quiz of the Day (replaces the discarded Recent games work)
Did: (design approved first: cron + topic list, New York midnight incl. DST, solo one attempt, public aggregates + top player only, smoothed bell curve, "no quiz today" on failure, dev-only seed for specs.) The uncommitted Recent games work from 2026-11-18 was discarded entirely (git checkout + deleted files) before starting.
- Pure: `src/lib/daily.ts` (+ `daily.test.ts`): `dailyDay`, `DAILY_TOPICS`/`topicForDay`, `nextDailyStep`, `computeDailyStats`, `bellCurvePoints`, `percentileOnCurve`.
- Schemas: `daily_quizzes` (server only), `daily_stats` (signed-in read), `daily_plays` (own read, immutable roomId); `rooms.dailyDay`; registered in `src/schemas.ts`; client types in `src/components/game/types.ts`.
- Server: `src/server/daily.ts` (source room, start/give up, `recordDailyGeneration`, `recordDailyFinish`); `GenerateJobPayload.dailyDay` (`src/server/generation.ts`); `src/jobs.ts` reports daily outcomes; `src/cron.ts` `daily-quiz` every 15 min NY time, skipped when `ALLOW_DEBUG_ROUTES === 'true'`.
- Actions (`src/actions/index.ts`): room/host setup moved out of `createRoom` into `createHostedRoom` (same behaviour); `loadDailyQuiz`; new `playDailyQuiz`, `devSeedDailyQuiz`; `joinRoom` refuses daily rooms; `openQuestion` records a daily finish before `finished`.
- UI: `/daily` page, `DailyCard` on `/home`, `BellCurve`, `DailyResult`, `DailyStatsSummary`; daily lobby (no code) and daily Game over in the room page; landing link "Play the quiz of the day →" → `/daily` (`src/pages/index.tsx`, `tests/landing.spec.ts`).
- Spec: `tests/game.spec.ts` "quiz of the day: …". CLAUDE.md architecture updated.
Verified:
- `npx tsc --noEmit` clean; `npx vitest run`: 106 passed (13 new daily tests, incl. EST and EDT midnight rollover).
- `npx deepspace test run e2e --grep "quiz of the day"` twice. Run 1 (first play today): seed → `daily_stats` ready with 8 questions; two concurrent `playDailyQuiz` → same room; outsider's `joinRoom` with the daily code → "No room with that code."; full game → `daily_plays` finished with score 7992 = players score; outsider reads 0 `daily_plays`/`daily_quizzes`/`answerKeys`/`sources`; stats playerCount 1, top 7992 + name; /daily shows the result, curve and You marker; outsider's /home card shows the top score and name. Run 2 (already played): same room returned, stored result checked.
- Looked at a screenshot of /daily: the "You" and "Avg" labels overlapped when equal, so the Avg text is now hidden within 30 px of You (not re-screenshotted after that fix).
- `npx deepspace test run all`: 25 passed, 1 failed: `membership-resubscribe.spec.ts`, the known SDK issue (also fails on unchanged main, checked 2026-11-18).
Not verified / risks:
- The real cron path was never run: no deployed run, no real Exa/Firecrawl/Anthropic daily generation, no retry or give-up in practice. I didn't see the "local dev: skipping" log line either. Check after deploy with `npx deepspace logs --follow --json` around a quarter hour (`[daily]` lines) and on the cron monitor.
- Cron cost: up to 3 paid generations per day, billed to the owner.
- Between midnight and the first finished generation (~1–3 min), and for up to 15 min after a failed attempt, the day shows "being prepared".
- If `recordDailyFinish` keeps failing, a daily game can't reach `finished`. Stats recount caps at 500 finished plays per day. Two finishes at the same moment can leave the stats one play behind until the next finish (last-writer-wins recompute).
- The bell curve is fitted to average + spread, not real scores; with 1 player or equal scores it is a narrow default curve. The percentile is an estimate.
- Client computes "today" from its own clock; a wrong device clock can show yesterday's or tomorrow's stats (playDailyQuiz uses server time).
- The source room is hosted by the owner and visible to them while generating (Return-to-room link for ~1 min).
- `devSeedDailyQuiz` is a backdoor if `ALLOW_DEBUG_ROUTES` is ever set as a production secret.
- Local dev DB still has `quizzes`/`quiz_results` rows from the discarded work (no longer registered, nothing reads them).

## 2026-11-19 — Quiz of the Day: average-only results, weighted baseline, everyday topics, 180-topic rotation
Did:
- Removed the top score, top player name and player count everywhere: `daily_stats` columns (`daily-stats-schema.ts`), `daily_plays.displayName`, the UI (`DailyStatsSummary` now shows only today's average) and the "about X% scored lower" line (`percentileOnCurve` removed).
- Average: `baselineAverage(day)` (2000–3000, FNV-1a hash of the date, fixed per day), weighted as `BASELINE_WEIGHT` = 5 scores; `dailyAverage(baseline, scores)` in `src/lib/daily.ts`. Set on `daily_stats` when the day becomes ready.
- `recordDailyFinish` (`src/server/daily.ts`): saves the average + spread of the baseline and every *other* finished play on the player's row (`daily_plays.averageAtFinish` / `stdDevAtFinish`), then adds their score to `daily_stats`. `DailyResult` reads the own play row: score vs that average, "N points above/below the average", curve from those numbers.
- Topics: 180 everyday topics in `src/lib/daily-topics.ts`; `topicForDay` rotates in order from `DAILY_ROTATION_START` = 2026-11-19 (topic 1) and wraps around. Questions: optional `everyday` flag on `buildQuestionPrompt` / `runQuestionPipeline` adds `EVERYDAY_RULE`; only the daily job sets it (`src/jobs.ts`). Link/topic rooms unchanged.
- `devSeedDailyQuiz({ reset: true })` clears today's daily rows (dev only), so the spec plays fresh every run. Spec rewritten; CLAUDE.md updated.
Verified:
- `npx tsc --noEmit` clean; `npx vitest run`: 112 passed. New tests: baseline range, fixed per day, varies across days; 2000 + one 4000 → 2333 (weight 5); 180 distinct topics; rotation starts at topic 1, goes 180 → 1, a retry takes the next topic, and it works across DST and before the start; the everyday rule appears only when asked for.
- `npx deepspace test run e2e --grep "quiz of the day"`: baseline 2641 shown before anyone played (stdDev 0); player 1 scored 7992 → their row `averageAtFinish` 2641, public average 3533 = (5×2641+7992)/6; player 2 scored 4995 → compared with 3533 (stdDev 1994), public average 3742; player 1's saved result unchanged. UI: /daily shows the score, "points above the average", the earlier average and the curve; /home shows the new average and no "top score". Dev server log showed "[daily] local dev: skipping generation" (the cron makes no paid calls locally).
- `npx deepspace test run all`: 26 passed, 1 failed (`membership-resubscribe.spec.ts`, the known SDK issue).
Not verified / risks:
- The real daily generation (cron → Exa → Firecrawl → Anthropic with the everyday rule) has still never run; whether the questions actually come out "everyday" is untested. Check the first deployed day by hand.
- The 180 topics were written by me (not supplied); review or replace the list in `src/lib/daily-topics.ts`. The rotation starts at topic 1 on 2026-11-19; if you deploy later, today's topic is further along (change `DAILY_ROTATION_START` to the launch date).
- The baseline is presented on the page as "Today's average", with no note that it's a starting value.
- A retry uses the next day's topic, so a failed day's topic repeats the following day.
- Local dev DB still has the old `daily_stats`/`daily_plays` columns' data for days before today (no reset was run for them); harmless.

## 2026-11-20 — Topic rooms try the next search result when a page is too short or unreachable
Context: first deployed Quiz of the Day (release #10, 2026-11-20 00:00 ET). Logs: cron fired on time, attempt 1 ("how to brew tea") searched (5 results, $0.007), scraped the first result, got only 1433 chars of text (< MIN_ARTICLE_CHARS 2000) → failed in 4 s, no model call. The design retries at 00:15 with the next topic.
Did:
- `readSearchResponse` returns every usable link in order, deduplicated (`SearchResult` `{ ok, urls }`), in `src/lib/questions/responses.ts`.
- `src/lib/questions/pipeline.ts`: `shouldTryNextArticle` (only `tooLittleText`/`pageUnreachable`, which both happen before any model call) and `runOnFirstUsableArticle` (tries links in order while that holds and the budget allows).
- `src/lib/generation-timing.ts`: `SCRAPE_TIMEOUT_MS` is now the total scrape budget per room, plus `MIN_SCRAPE_MS` = 10 s; `scrapeArticle` takes the remaining budget as its timeout (`src/server/generation.ts`). Worst case unchanged at 160 s < 180 s.
- `src/jobs.ts` uses it for every room (link rooms have one candidate, so behaviour is unchanged). Skipped pages are logged by number + reason, never URL. Applies to host topic rooms and the daily quiz.
- Spec fix: `tests/game.spec.ts` asserted the outsider sees 0 `daily_plays` rows; after midnight they see their own row from yesterday (allowed). Now it asserts they never see the player's row.
Verified: `npx tsc --noEmit` clean; `npx vitest run` 122 passed (new: all usable links in order + dedup; shouldTryNextArticle for every message; a too-short page fails before generate is called; runOnFirstUsableArticle: first works / skips short + unreachable to a good one / stops on service failure / stops when budget says no / all unusable). `npx deepspace test run all`: everything passed except the known `membership-resubscribe` failure, plus the daily spec's outsider check above (fixed, and the daily spec rerun passed).
Not verified / risks: the real job path (Exa → several Firecrawl scrapes) has not run with this code; no spec may call integrations. Check the next deployed generation's logs for "article N unusable, trying article N+1". A skipped page costs one extra Firecrawl scrape (~$0.004). Scrape *service* errors (e.g. a site blocking Firecrawl) still end the attempt; only short or HTTP-error pages move on.

## 2026-11-20 — Quiz of the Day: "Top X%", gentler bell curve, always 8 questions
Did:
- `src/lib/daily.ts`: `topPercent(score, mean, stdDev, maxScore)` (1–99, normal CDF, estimated); `CURVE_MIN_SPREAD` = 0.18 of the range (was 0.05) shared by the curve and `topPercent` so the number matches the marker; curve drawn with 120 points (was 60); `DAILY_QUESTION_COUNT` = 8 and `pickEvenly`.
- `DailyResult` shows "Top X% of players" from the saved `averageAtFinish` / `stdDevAtFinish` (so it never changes after you finish).
- `src/jobs.ts` keeps exactly 8 questions for daily rooms (`pickEvenly`, keeping the difficulty ramp); `devSeedDailyQuiz` does the same. Host rooms unchanged (still up to 12).
- Tests: `daily.test.ts` (pickEvenly keeps 8 in order with first and last; QUESTIONS_MIN_USABLE ≥ 8; curve stays gradual with spread 0; topPercent 50/16/84, clamped 1–99, same minimum spread); daily spec checks questionCount 8 and the "Top X%" text. CLAUDE.md updated.
Verified: `npx tsc --noEmit` clean; `npx vitest run` 128 passed; daily spec passed; screenshot of the result card: wide gradual curve, "Top 1% of players" for 7992 vs average 2439; `npx deepspace test run all`: 26 passed, 1 failed (known `membership-resubscribe`).
Not verified / risks: not deployed. Today's production quiz (2026-11-20) was generated before this and may have more than 8 questions; from tomorrow's generation on it's 8. "Top X%" is an estimate from a fitted curve that includes the seeded baseline, not a true rank, and early in the day it leans on the 18% minimum spread.

## 2026-11-20 — README with screenshots
Did: new `README.md` (what it is, live link, screenshot grid, features, tech stack, game flow + server actions, question pipeline, security model, data model, project structure, run/test/deploy, known limitations). New `docs/screenshots/*.png` (11 phone-size shots, 390 px wide at 2×: landing, home, create, join, host name prompt, lobby, question host view, locked-in answer, reveal, game over, Quiz of the Day result). Taken with a temporary Playwright spec (3 `sourcerush-ui` accounts, sample room only, `devSeedDailyQuiz({ reset: true })` for the daily card/result), which was run and then removed from `tests/`. No app code changed.
Verified: the screenshot spec passed against local dev (`npx deepspace test run e2e --grep "readme screenshots"`); looked at every image. `npx vitest run`: 13 files, 128 passed (the count quoted in the README). `curl https://sourcerush.app.space/` → 200.
Not verified / risks: no screenshot of the generating progress screen (only real url/topic rooms show it, and specs may not create them). The nav avatar in the shots shows the test accounts' sign-in names ("UI host" etc. on desktop; on phone only the initial). The local dev DB's daily rows for today were reset by the seed. README stack/feature claims were written from CLAUDE.md and the code; check the wording before submitting.
