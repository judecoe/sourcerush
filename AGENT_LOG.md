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
