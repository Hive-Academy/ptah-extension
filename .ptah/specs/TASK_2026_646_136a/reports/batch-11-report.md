# Batch 11 report (plan id A6a) — System One client + decision payload

Task: TASK_2026_646_136a, Batch 11 (batches.md Task 11.1). All paths below are absolute.

## Files written

1. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\system-one.schema.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\system-one.client.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\system-one.client.spec.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\decision-payload.ts`
5. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\decision-payload.spec.ts`
6. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-11-report.md` (this file)

`src/index.ts` was not touched (A8 owns exports). No file outside the Batch 11 set was modified.

## Task 11.1 — System One wire schema

`system-one.schema.ts` models only what plan part A §5 pins (part-a:749-757):

- Choice-only questions: `SystemOneQuestionSchema` (`system-one.schema.ts:19-25`) —
  `{ type: 'choice', instructions, criteria }`, `.strict()`.
- Criteria map `Record<string, string>` (`system-one.schema.ts:16`) — short option
  labels `o1..oP`.
- Request body `SystemOneRequestBodySchema` (`system-one.schema.ts:61-67`) —
  `{ model, state, questions }`, `.strict()` on the outer object.
- Response `SystemOneResultSchema` (`system-one.schema.ts:85-97`) — outer object
  `.passthrough()` (a provider may add top-level fields), inner answer and usage
  objects `.strict()` (a malformed answer is a failure). `probabilities`,
  `confidence` and `usage` are optional (`system-one.schema.ts:70-77, 89-95`).

## Task 11.1 — Decision payload builder

`decision-payload.ts` emits only the NFR Security field set. `buildDecisionPayload`
(`decision-payload.ts:76-118`) builds the output from scratch, so no extra input
field can reach the wire:

- Request text, capped at `REQUEST_TEXT_MAX_CHARS = 8000` (`decision-payload.ts:5, 78`).
- Option labels via `formatDecisionOptionLabel` (`decision-payload.ts:58-66`):
  `lane <id>, family <f>, model <m>, limit state <s>, score <n>` — the five
  facts the NFR allows.
- Roster `state.availableExecutors`, first appearance wins per lane
  (`decision-payload.ts:91-98`); per-question criteria stay authoritative.
- Outcome figures keyed `${laneId}/${taskKind}` (`decision-payload.ts:110-115`).

The spec pins the exact key set (`decision-payload.spec.ts:39-63`):

- payload: `questions`, `state`
- state: `availableExecutors`, `pastOutcomes`, `request`
- roster entry: `family`, `limitState`, `model`, `score` (lane id is the map key)
- outcome entry: `delivered`, `failed`
- question: `criteria`, `instructions`, `type`; criteria keys `o1..oN`

Further evidence: label text pinned at `decision-payload.spec.ts:65-77`; roster
first-wins with per-question scores at `decision-payload.spec.ts:79-102`; outcome
key format at `decision-payload.spec.ts:104-112`; fixed-criteria passthrough
(pre-flight `task_type`/`depth`) at `decision-payload.spec.ts:114-134`; request
cap at `decision-payload.spec.ts:136-141`; wire round-trip plus strict-state
rejection at `decision-payload.spec.ts:143-156`; leak test at
`decision-payload.spec.ts:158-163`.

## Task 11.1 — System One client

`system-one.client.ts` makes one POST per `decide()` call and never retries
(`system-one.client.ts:103`). The result is plain data; the client holds no
storage and has no method that persists a mark.

### Classification matrix

| Live answer | Result |
| --- | --- |
| HTTP 404 or 405 | `cause: 'provider-error'`, `notFound: true`, detail = body `error` text (JSON) or trimmed body text, cut to 200 chars (`system-one.client.ts:151-159, 210-225, 241-242`) |
| HTTP 401 or 403 | `cause: 'auth'`, `notFound: false` (`system-one.client.ts:148-150`) |
| Other non-2xx | `cause: 'provider-error'`, `notFound: false` |
| Transport rejection, signal aborted | `cause: 'timeout'`, detail `request timed out after <ms> ms` |
| Transport rejection, signal not aborted | `cause: 'unreachable'` (connection refused, DNS, TLS, invalid base url) |
| Body over `SYSTEM_ONE_MAX_REQUEST_BYTES` (64 KiB) | `cause: 'payload-too-large'`, nothing sent (`system-one.client.ts:110-117`) |
| Non-JSON or schema-invalid body | `cause: 'bad-output'` with the first issue path (`system-one.client.ts:161-177`) |

Transport classification is by abort signal, never by message substring
(`system-one.client.ts:192-203`): the signal's only source is the request
timeout, so `signal.aborted` means timeout and every other rejection is
`unreachable`. This follows the repo rule pinned for OAuth discovery
(`cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts`).

### notFound semantics (decision #46)

`notFound` is true only for a live HTTP 404/405 (`system-one.client.ts:49-60`).
A live call names a model, so its 404/405 cannot tell a missing route from a
missing model. The flag is evidence for `DecisionModelStatus.recheckAfterLiveNotFound`
(A6b) and is never a route verdict. The client itself persists nothing.

### Spec evidence

`system-one.client.spec.ts`, one test per row of the matrix:

- Request shape, URL, headers, signal: `system-one.client.spec.ts:109-132`
- No key -> no authorization header: `system-one.client.spec.ts:134-141`
- Trailing-slash base (Jev `https://api.typesafe.ai/`): `system-one.client.spec.ts:143-153`
- Plain-text 404: `system-one.client.spec.ts:155-167`
- JSON 404 `error` field plus 200-char cut: `system-one.client.spec.ts:169-179`
- 405 vs 500: `system-one.client.spec.ts:181-198`
- 401/403 auth: `system-one.client.spec.ts:200-221`
- Network rejection: `system-one.client.spec.ts:223-235`
- Timeout: `system-one.client.spec.ts:237-251`
- bad-output (non-JSON, missing answers): `system-one.client.spec.ts:253-275`
- Response passthrough outer / minimal answer: `system-one.client.spec.ts:277-297`
- payload-too-large with zero fetch calls: `system-one.client.spec.ts:299-321`
- Invalid base url with zero fetch calls: `system-one.client.spec.ts:323-336`
- API key never logged: `system-one.client.spec.ts:338-357`
- Constants pinned: `system-one.client.spec.ts:103-107`

## Design decisions

1. Wire shapes come from part-a:749-757, not from invention. Response is
   passthrough-outer, strict-inner.
2. The client is URL-agnostic. Base URL resolution (Ollama
   `provider.ollama.baseUrl`, Jev `https://api.typesafe.ai`) belongs to A6b
   (part-a:324-326); the client only joins `SYSTEM_ONE_PATH` to whatever base it
   receives, so the base URL never comes from tool args.
3. `SystemOneFetch` (`system-one.client.ts:21-33`) is the minimal fetch seam the
   repo already uses for OAuth discovery. Specs inject plain-object fakes; no
   `jest.spyOn(globalThis, 'fetch')`, no casts.
4. `timeoutMs` option with default `SYSTEM_ONE_TIMEOUT_MS = 3000`
   (`system-one.client.ts:9, 75-76, 126`). Jest fake timers cannot drive
   `AbortSignal.timeout` (repo note, `mcp-oauth-metadata.spec.ts:17-18`), so the
   timeout spec uses a small real bound with a hanging fetch.
5. Roster first-appearance-wins across questions: per-phase scores differ, and
   criteria labels stay authoritative for each question.
6. Outcome keys are `${laneId}/${taskKind}`, matching the aggregation the
   routing rates read.
7. The API key goes only into the `authorization` header when present
   (`system-one.client.ts:129-131`); it never enters a URL or a log call.

## Validation notes

- No `any`, `@ts-ignore` or `as unknown as` in any file.
- Imports: zod, `@ptah-extension/shared` (type `LaneLimitState`), local files and
  the local `LaneRoutingLogger`. No `vscode-core` import. No new dependency.
- The client never persists a mark (no storage dependency, no mark method);
  `notFound` is data for the A6b status layer only.

## Verification

No Nx or Jest command was run (decision #53: executors do not verify; the
team-leader runs the scoped checks). Planned check for this batch:
`J(libs/backend/lane-routing, LR/decision-model/system-one.client.spec.ts LR/decision-model/decision-payload.spec.ts)`.

Nothing in this batch is deferred; all five code files are complete with no
TODOs or stubs.