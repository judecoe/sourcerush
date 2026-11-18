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
