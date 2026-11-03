# Requirements - TASK_2026_865_2a1d

## Context

A stored chat session keeps the provider it started on. When the workspace's active provider has
since changed (for example Claude Code -> Codex, from onboarding stage 1 or from the Providers
page), resuming that session is refused. The resolver compares the stored identity with the
active provider and throws `AuthRequiredError` ("Cannot resume this session: its provider (...)
differs from the workspace's active provider (...)")
(`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:277-283`,
`:375-377`, `:542-553`). `chat:continue` calls `runtimeProfile.prepare(config, identity, ...)`
(`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:2409`) and result-shapes
the throw as `{ success: false, errorCode: 'AUTH_REQUIRED', providerId: <stored provider>,
error: <message> }` (`:2486-2495`, helper `:872-886`). The `/compact` slash path does the same
(`libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:333-334`,
`:459-469`). The result type is `ChatContinueResult`
(`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:209-223`).

In the renderer, `MessageSender.handleAuthRequired`
(`libs/frontend/chat/src/lib/services/message-sender.service.ts:143-157`) calls
`AuthStateService.flagAuthRequired(providerId, message)`
(`libs/frontend/core/src/lib/services/auth-state.service.ts:1217-1222`), which sets one global
banner signal holding only `{ providerId, message }` (`:186-189`, `:342`), with no tab or session
identity. `ChatViewComponent` renders `<ptah-auth-required-banner>`
(`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:147-154`) whose only
actions are "Open Settings" / "Re-authenticate in terminal" and Dismiss
(`libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts:42-57`,
`:77-81`; handler `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:343-351`).
There is no way to keep working on a pre-switch conversation with the new provider. Until commit
`a9497540e` (2026-11-02, "refuse retired Codex proxy routes") the Codex translation proxy let
`/compact` summarise the old transcript with the new provider; that commit retired the proxy and
introduced the refusal on purpose.

The user relied on "compact with the new provider" and wants it back in a supported form, through
one explicit action, without re-enabling the old provider or the proxy. The host can already read
a stored conversation locally: `SessionHistoryRouter.readSessionHistory`
(`libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:48`) routes to
`SessionHistoryReaderService.readSessionHistory`
(`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:350`) for Claude SDK sessions
and to the native reader for Codex sessions. The renderer's conversation registry already holds
several sessions under one conversation (`libs/frontend/chat-state/src/lib/conversation-registry.service.ts:143`).

## Classification

- Type: FEATURE — adds a new user action and a new backend capability (cross-provider carry-over);
  the refusal itself is unchanged.
- Estimate: L — matches the carrier's `estimate: L`; driven by a new RPC contract across 4-5
  projects (`shared`, `agent-sdk`, `rpc-handlers`, `chat`, possibly `chat-state`/`core`), a
  transcript-to-text rendering with a budget, and renderer tab relinking.
- Priority: not defined here.

## Scope

In scope:

- One "Continue with <provider>" button on the existing re-auth banner, shown only for a
  stored-provider mismatch refusal whose active provider is ready.
- A host action that reads the refused session's history locally, renders it to bounded plain
  text, and starts a NEW chat on the workspace's active provider whose first turn asks for a
  summary of that text.
- A bounded history read for the carry-over (the read itself, not only the rendered output).
- The transfer policy for the carried text: disclosure that it is sent to the active provider,
  exclusion of tool I/O and attachment content, and best-effort known-pattern secret redaction.
- Binding the offer to the refused session, tab, workspace and refusal generation, with
  click-time and completion-time identity checks.
- Relinking the chat tab to the new chat and showing a short notice in it.
- Failure handling for: unreadable or empty history, active provider failure, repeated clicks,
  closed tab.
- Both switch origins (onboarding stage 1 and Providers page) and both refusal entry points
  (`chat:continue` and `/compact`), because they share the same resolver refusal.
- Both directions of mismatch (for example Claude -> Codex and Codex -> Claude), because the
  history router reads both session kinds.
- Specs for the new host action, the transcript rendering, and the renderer button/relink.

Out of scope:

- Files under `libs/frontend/onboarding` — owned by parallel task TASK_2026_864_1376.
- Codex sign-in code (`auth:codexLogin`, terminal login, auth-file watcher) — unrelated; owned
  elsewhere.
- The retired Codex translation proxy — retired on purpose by `a9497540e`; not restored.
- Any change to the existing AUTH_REQUIRED refusal (its trigger, `success`, `errorCode`,
  `providerId`, `sessionId`, `error` text), including adding any field to it — TASK_2026_864_1376
  tests that contract and the user fixed it as unchanged (Revision 1, F1).
- Automatic carry-over without a click — rejected by the user.
- Migrating or rewriting the old transcript into the new provider's native format, or any edit of
  the old session — the old session stays intact.
- Carry-over for named-account resumes (`accountSelection`), MCP apps page continues
  (`libs/frontend/mcp-apps-page/.../apps-session.service.ts:327`), and subagent transcripts — they
  do not show the chat re-auth banner; a follow-up task if wanted.
- Other `AuthRequiredError` causes (expired token, API key not ready, provider not ready) — they
  keep today's banner without the new button.
- Visual redesign of the banner — one added button only.
- VS Code host verification — Electron first (CLAUDE.md); VS Code must only keep compiling and
  keep today's banner behaviour.

## Requirements

### 1. Offer the carry-over only where it can work

Requirement: chat view — offers "Continue with <provider>" on the re-auth banner only when the
refusal was a stored-provider mismatch and the active provider can start a chat — so the user is
never offered an action that cannot succeed.

Acceptance criteria:

1. When `chat:continue` (or `/compact`) is refused because the session's stored provider differs
   from the workspace's active provider, and the active provider is ready for this workspace, the
   banner shall show a button labelled "Continue with <active provider display name>" (for
   example "Continue with Codex") in addition to the existing action and Dismiss.
2. When the refusal is any other `AuthRequiredError` (expired Codex token, API key not ready,
   active provider not ready, missing credentials), the banner shall render exactly as today,
   without the new button.
3. When the mismatch refusal occurs but the active provider is not ready, the banner shall render
   exactly as today, without the new button.
4. (Revised, F1) When the renderer decides whether to show the button, it shall use structured
   data only — the refusal's existing `providerId` (the stored provider) compared with the active
   provider the renderer already knows, and/or a separate read-only host query (the architect
   chooses which) — and shall never parse or match the `error` message text. A spec shall prove
   the decision is unchanged when the `error` text is altered.
5. (Revised, F1) When the refusal reaches the renderer, the response shall be byte-identical to
   today's: the same fields `success: false`, `errorCode: 'AUTH_REQUIRED'`, `providerId` (the
   stored provider), `sessionId` and `error`, with the same values and NO added field. A spec
   shall assert the full refusal shape for `chat:continue` and `/compact` against today's.
6. When the banner is dismissed or replaced by a newer auth refusal, the button shall disappear
   with it (identity and race outcomes: Requirement 7).
7. (Added, F1) When the user clicks the button, the host shall re-check, from its own state, that
   the refused session's stored provider still differs from the workspace's active provider and
   that the active provider is ready, before reading history or creating a session (see AC 2.5);
   the renderer's eligibility decision is never trusted as proof.

### 2. Carry the conversation over to a new chat on the active provider

Requirement: host — on an explicit request naming the refused session, reads its history locally
and starts a new chat on the workspace's active provider whose first turn summarises a bounded
copy of the old conversation — so the user can keep working without the old provider.

Acceptance criteria:

1. When the user clicks "Continue with <provider>", the host shall create exactly one new session
   on the workspace's active provider and runtime (`codex-app-server` for Codex), in the same
   workspace path as the refused session.
2. When the new session starts, its first turn shall contain an instruction to summarise the prior
   conversation followed by the rendered transcript, and the new provider's reply shall stream
   into the tab like any assistant turn.
3. When the carry-over runs, the host shall not call the old provider in any way: no SDK query,
   resume, compact, or profile `prepare` with the stored identity, and no network call to it. A
   spec shall prove this by asserting zero calls on the stored-provider runtime path.
4. When the carry-over runs, the new chat shall use the model the active provider would use for a
   new chat in this workspace, not the stored session's model or the tab's Claude-only override.
5. When the host receives a carry-over request for a session that is not in a stored-provider
   mismatch at that moment (for example the user switched back), it shall refuse with a structured
   error and create no session; the user can then continue normally.
6. When the host receives a carry-over request with an invalid or unknown session id or a
   workspace path the session does not belong to, it shall refuse with a structured error and
   read no file outside that session's history.

### 3. Bounded transcript rendering

Requirement: host — renders the old conversation to plain text that fits a fixed budget and keeps
the newest turns — so the first turn fits the new provider's context and stays relevant.

Acceptance criteria:

1. When the whole history lies inside the read bound (AC 3.4) and the rendered transcript fits
   the budget, it shall contain every user and assistant text turn of the main conversation in
   order, each labelled with its role. (Revised, Gate 1 round 2 cap — decisions.md row 12)
2. When the rendering exceeds the budget, or the history was longer than the read bound, the
   oldest turns shall be dropped first, the newest turns shall be kept whole, and a single line
   shall state that earlier turns were omitted. The line gives an exact count only when the
   omitted turns were all inside the read window; otherwise it says "Earlier conversation
   omitted." without a count. (Revised, row 12)
3. When the single newest turn alone exceeds the budget, it shall be truncated from its start
   (keeping its end) with an omission marker, and the result shall still not exceed the budget.
4. The budget shall be one named constant measured in characters or tokens, and a spec shall
   prove the rendered text never exceeds it for an oversize input. (Revised, F4) The history
   read for the carry-over shall itself be bounded — a tail read window or a streaming read with
   a limit; the architect specifies which and its size — so the carry-over never loads or parses
   the whole history of a large session before trimming.
5. When a turn contains tool calls or tool results, each shall be replaced by one line naming the
   tool (for example `[tool: Bash]`); tool inputs, outputs and errors shall not appear in the text.
6. When a turn carries thinking or reasoning blocks, system, hook, usage or compaction-boundary
   events, they shall be left out.
7. When a user turn had attachments, each image shall be replaced by `[image omitted]` and each
   file by `[file: <base name>]`; no attachment content or image data shall be sent.
8. When the latest compaction summary lies inside the read window, the rendering shall start
   from that summary text plus the turns after it. When no summary is inside the window, the
   rendering shall start with the omission line of AC 3.2 (no count) and the turns in the
   window; no extra read beyond the bound is made to find an older summary. Spec fixtures shall
   cover a summary just inside and just outside the window, and text turns just before the
   window. (Revised, row 12)
9. Subagent transcripts shall not be included.
10. (Added, F4) When the stored history is much larger than the read bound (a spec fixture at
    least ten times the bound, for both a Claude JSONL session and a Codex native session), the
    carry-over shall read no more than the bound from the history source, shall still produce
    the newest turns within the budget with the omission line of AC 3.2, and shall not fail for
    size alone. A spec shall assert the amount read (or the read limit passed to the source).

### 4. Tab relink and notice

Requirement: chat tab — moves to the new chat and says what happened — so the user knows which
provider now serves the tab and that the old conversation still exists.

Acceptance criteria:

1. When the new session id is known, the tab that was refused shall become bound to the new
   session: its next send goes to the new session through `chat:continue` and succeeds without a
   mismatch refusal.
2. When the tab is relinked, the conversation shall list the new session after the old one (the
   old session stays reachable from history / the sidebar).
3. (Revised, F5) When — and only when — the new session id exists and the refused tab is bound
   to it (AC 4.1, Requirement 7 checks passed), the tab shall show this one-line notice:
   "Continued with <active provider> in a new chat from a summary of this conversation. The
   original conversation is unchanged." The notice contains no session ids, paths, tokens or
   provider error text. While the carry-over is in flight and on every failure before the new
   session exists (AC 5.1, 5.2), no such notice shall appear. The notice also carries the
   transfer disclosure of AC 8.4.
4. When the carry-over succeeds, the re-auth banner shall be cleared.
5. When the refused tab was closed before the click, the carry-over shall not open or bind any
   other tab; the banner shall clear and show nothing further. (Tab closed mid-flight and other
   races: Requirement 7.)
6. The prompt whose send was refused shall not be sent automatically; the notice or its
   surrounding state leaves the user free to send it again in the new chat.

### 5. Failure paths

Requirement: host and chat view — fail without partial state and with a short, safe message — so
a failed carry-over never loses the old conversation or creates a hidden chat.

Acceptance criteria:

1. When the history cannot be read (missing file, parse error, invalid id) or renders to no
   text turns, the host shall return a structured failure, create no new session, and the banner
   shall show "Couldn't read this conversation to continue it." with the button removed; no
   carry-over notice (AC 4.3) shall appear.
2. When the active provider fails before a session exists (not ready, auth required, runtime
   unavailable or busy), the host shall return the existing structured codes for that provider
   (`AUTH_REQUIRED` with the active provider's id, or `CODEX_*`), create no session, the tab
   shall stay bound to the old session, and no carry-over notice (AC 4.3) shall appear.
3. When the active provider fails after the new session exists (for example the first turn
   errors mid-stream), the tab shall stay bound to the new session and show the error the chat
   already shows for a failed turn; the user can retry by sending in that tab. The notice of
   AC 4.3 stays, because the new session exists and the tab is bound.
4. When the user clicks the button again while a carry-over for the same session is in flight
   (double click, or click from two views), only one new session shall be created; the button
   shall be disabled from the first click until the result arrives.
5. When a carry-over fails, the old session shall be unchanged and continuing it shall still
   return today's AUTH_REQUIRED refusal.

### 6. The original session is left intact

Requirement: host — never writes to the old session as part of a carry-over — so the user can
return to it (for example after switching the provider back).

Acceptance criteria:

1. When a carry-over succeeds or fails, the old session's transcript file shall be byte-identical
   to before, and its metadata record (provider identity, name, totals, lineage) shall be unchanged.
2. When the user later selects the old provider again for the workspace, the old session shall
   resume as it does today.
3. When the user continues the old session while the active provider still differs, the response
   shall be today's AUTH_REQUIRED refusal (unchanged contract).

### 7. Offer identity and races (added in Revision 1, F2)

Requirement: chat view and host — bind each carry-over offer to the refusal that produced it and
re-check that binding when the user clicks and when the result returns — so a click or a late
result never acts on another tab, another session, or a newer refusal. Today the banner is one
global signal with no tab or session identity (`libs/frontend/core/src/lib/services/auth-state.service.ts:186-189`,
`:1217-1222`).

Acceptance criteria:

1. When a mismatch refusal is shown with the button, the offer shall carry the refused
   `sessionId`, the refused `tabId`, the workspace path and a refusal generation that is
   different for every refusal shown; the carry-over request shall name that `sessionId` and
   workspace path.
2. When the user clicks the button, the renderer shall act only if the offer's generation is
   still the current banner's generation and the refused tab still exists and is still bound to
   the refused `sessionId`; otherwise it shall send no request and remove the stale offer.
3. When the user switches to another tab before clicking, the button shall either be hidden for
   that tab or, if clicked, shall carry over the refused session only and bind the result only to
   the refused tab; the tab in view shall not be relinked or changed.
4. When the user switches tabs after clicking (carry-over in flight), the result shall bind only
   the refused tab; no other tab's session, messages or banner shall change.
5. When a newer refusal replaces the banner while a carry-over is in flight, the completion shall
   not clear, hide or alter the newer banner; it shall still bind the refused tab if that tab is
   still bound to the refused session, and the notice of AC 4.3 shall appear in that tab only.
6. When the refused tab is closed while the carry-over is in flight, the completion shall bind no
   tab, open no tab, relink no other tab, and clear no newer banner; the new session, if created,
   stays reachable from history / the sidebar as an ordinary session.
7. When the refused tab was rebound to a different session before the carry-over completes (for
   example the user opened another conversation in it), the completion shall not rebind it.
8. Race specs shall cover each of AC 7.2-7.7 with a deferred (manually resolved) host response:
   tab switch before click, tab switch after click, newer refusal mid-flight, tab closed
   mid-flight, tab rebound mid-flight, and stale-generation click.

### 8. Transfer policy for the carried text (added in Revision 1, F3)

Requirement: host and chat view — send only the old conversation's text, with known secret
patterns redacted, to the active provider, and tell the user that this happens — so the user's
explicit request ("compact with the new provider") is honoured without sending tool data,
attachments or recognisable secrets, and without surprise.

Acceptance criteria:

1. When the carry-over runs, the text sent to the active provider shall consist only of the
   rendered conversation text of Requirement 3 (user and assistant prose, and any compaction
   summary text) plus the summary instruction; tool inputs/outputs/errors and attachment content
   shall be excluded (AC 3.5, 3.7).
2. When the rendered text (including a compaction summary) contains a string matching a known
   secret pattern, it shall be replaced by a redaction marker before it is sent. The redaction is
   best-effort over known patterns, reusing the existing `redactSecrets` pattern
   (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:34`) or
   an equivalent placed within lib boundaries (the architect decides where).
3. A spec shall feed a transcript containing a known secret-bearing string (for example an API
   key or bearer token in ordinary user prose, and one in a compaction summary) and prove that the
   string is absent from the first-turn text sent to the provider, from every log line written by
   the carry-over, and from every UI payload (RPC result, banner, notice, error) on both the
   success path and a forced failure path.
4. When the button is shown, its accessible description shall state that this conversation's
   text is sent to <active provider display name>; the notice of AC 4.3 shall state the same.
   The visible label stays "Continue with <provider>" (AC 1.1).
5. When the carry-over fails at any point, no transcript text (redacted or not) shall appear in
   logs or UI errors; logs carry session ids and error names only.

## Non-functional requirements

- Security: no UI payload (RPC result, notice, banner text, stream event) produced by this
  feature shall contain credentials, tokens, auth-file contents, raw provider error bodies or
  stack traces; failures use fixed short messages plus structured codes. Logs record session ids
  and error names only, never transcript text. Tool inputs/outputs and attachment contents are not
  forwarded to the new provider (Requirement 3.5, 3.7). The forwarded conversation text is
  disclosed to the user and passes best-effort known-pattern secret redaction (Requirement 8).
- Data handling: the old transcript is read locally from the workspace's own session history;
  nothing about it is sent to the old provider.
- Compatibility: Electron app (`apps/ptah-electron` with renderer `apps/ptah-extension-webview`)
  is the target host; VS Code must compile and keep today's banner. Provider CLI lanes and the
  `platform-cli` / `cli-engine` libraries must keep working.
- Verification: scoped `npm run verify -- -p <changed projects>` only; no build, serve, e2e or
  package targets and no workspace-wide runs (CLAUDE.md). Visual before/after screenshots of the
  banner and notice in Electron, dark and light themes.
- Accessibility: the new button is a native `<button>` with a visible text label equal to its
  accessible name and is keyboard reachable in the banner's existing tab order; its accessible
  description carries the transfer disclosure (AC 8.4).

## Decisions taken

| # | Decision | Options considered | Evidence | Reversible |
| - | -------- | ------------------ | -------- | ---------- |
| D1 | (Superseded in Revision 1 by decisions.md row 8.) Eligibility uses structured data without touching the refusal: its existing `providerId` vs the active provider the renderer knows, and/or a separate read-only host query (architect chooses); the host re-checks at click time. No field is added to the refusal. | Parse message text; add optional field (rejected: changes the user-fixed contract); compare existing `providerId`; separate RPC probe. | User: refusal contract unchanged; review F1; `AuthRequiredError` has no reason field (`auth-required.error.ts:15-33`); message text is not a contract. | Yes |
| D2 | Tool calls become one `[tool: <name>]` line; no inputs/outputs. | Full tool I/O; summarised I/O; name only. | Tool output may hold secrets and is large; NFR security; budget keeps newest turns. | Yes |
| D3 | Images → `[image omitted]`, files → `[file: <base name>]`; nothing re-uploaded. | Re-send attachments; placeholders. | Attachments may be large/provider-specific; old provider's storage is not touched. | Yes |
| D4 | Budget is one named constant; oldest turns dropped first with an omission line; value chosen by the architect. (Revision 1, F4) The read itself is bounded too; window or streaming limit chosen by the architect. | Fixed number set here; architect-owned constant; unbounded read then trim (rejected). | User gave no number. `readSessionHistory` takes only `checkCompactionBoundary` / `includeBlockOwners` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:350-356`), so it has no read bound today; the same file has a separate tail-window path (`TranscriptWindowOptions.tailBytes`, `:908-972`) that is precedent for a bounded read, not an option of `readSessionHistory`. | Yes |
| D5 | The refused prompt is not auto-sent; the first turn is the summary only. | Summary + refused prompt; summary only. | The refused prompt is not in the old transcript and the button is clicked separately from the send; mirrors the old `/compact`-then-continue flow; avoids a duplicate send. | Yes |
| D6 | Tab keeps the old messages visible and appends the new session to the same conversation. | Replace tab contents; new tab; append. | User: "the tab links to the new chat"; registry already appends sessions (`conversation-registry.service.ts:143`). | Yes |
| D7 | New chat uses the active provider's default model for the workspace. | Stored model; tab override; active default. | Stored model belongs to the old provider and would be invalid on the new one. | Yes |
| D8 | Repeated carry-over of the same old session after a completed one is allowed (each click is explicit); only in-flight duplicates are blocked. | Block forever; allow. | Old session stays intact by design; user may want a fresh summary later. | Yes |
| D9 | Both refusal entry points (`chat:continue`, `/compact`) and both switch directions get the button. | Codex-only; continue-only. | Shared resolver refusal (`libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:333-334,459-469`); history router reads both kinds (`session-history-router.ts:48-73`). | Yes |
| D10 | Notice text as in AC 4.3. | Longer explanation; one line. | User asked for "a short notice". | Yes |

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Desktop user who switched provider | Keep working on an old conversation with the new provider in one click | Clicking the button yields a streaming summary from the new provider in the same tab |
| TASK_2026_864_1376 owner | The refusal contract they test stays unchanged | Their AUTH_REQUIRED test passes unmodified |
| Security/privacy reviewer | No tool output or known-pattern secrets reach the new provider, logs or UI; the transfer is disclosed | Requirement 8 secret-bearing spec and review of rendered text and payloads |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Renderer-side eligibility (stored `providerId` vs active provider) is stale or too coarse — it cannot see readiness or tell a mismatch refusal from another AUTH_REQUIRED whose `providerId` differs — so the button is offered where it cannot work, or the refusal gets touched to fix it | MEDIUM | MEDIUM | Architect picks the eligibility source (existing `providerId` comparison and/or a read-only host query) without adding any field to the refusal; host re-checks at click time (AC 1.7, 2.5); spec asserts the refusal shape is byte-identical (AC 1.5). Owner: software-architect. |
| Banner state is global, not per tab, so the button or a late result could act on the wrong tab or clear a newer refusal | MEDIUM | HIGH | Offer carries sessionId, tabId, workspace and refusal generation; click-time and completion-time checks with race specs (Requirement 7). Owner: frontend-developer; senior-tester for the race specs. |
| Transcript text carries secrets typed by the user in prose or kept in a compaction summary, and is sent to a different provider | MEDIUM | HIGH | Best-effort known-pattern redaction of the rendered text, disclosure on the button and notice, no transcript text in logs or UI errors, with a secret-bearing spec (Requirement 8). Owner: backend-developer; code-logic reviewer confirms redaction coverage and tool I/O exclusion. |
| Large histories are fully parsed before trimming, stalling the host | MEDIUM | MEDIUM | Bounded read with a large-history spec for both session kinds (AC 3.4, 3.10). Owner: software-architect to specify the read bound; senior-tester for the spec. |
| Native Codex history shape differs from Claude JSONL events, breaking the renderer for Codex -> Claude | MEDIUM | MEDIUM | Spec with fixtures from both readers through `SessionHistoryRouter`. Owner: senior-tester. |
| A new session is created but the tab relink fails, leaving an orphan chat | LOW | MEDIUM | Relink on session id arrival (AC 4.1, 5.3) with a spec for the failure-after-create path. Owner: frontend-developer. |

## Open questions

- None blocking. If the user prefers the refused prompt to be sent after the summary (D5), that is
  a small follow-up change; the orchestrator can confirm at Gate 1.

## Handoff

- Next specialist: software-architect
- Why: the outcomes and limits are fixed; the open questions are the eligibility source (existing
  `providerId` comparison and/or a read-only host query — the refusal itself stays untouched),
  the bounded read strategy, where the transcript rendering and redaction live, and how the offer
  binds to tab, session, workspace and refusal generation.

## Revision 1

Gate 1 cross-side review (`task-description-review.md`, codex, REVISE, 5 findings), resolved per
`decisions.md` rows 8-11.

- F1 (Serious, additive refusal field) — fixed: D1 superseded; out-of-scope list now forbids any
  added field; AC 1.4 rewritten (structured data: existing `providerId` vs active provider and/or
  a read-only host query, never message text); AC 1.5 rewritten (byte-identical, no added field,
  shape spec); AC 1.7 added (host re-check at click time, with AC 2.5); first risk row replaced;
  Handoff updated.
- F2 (Serious, global banner identity and races) — fixed: Context notes the banner has no
  identity; Requirement 7 added (AC 7.1-7.8: offer bound to sessionId, tabId, workspace and
  refusal generation; click-time and completion-time checks; tab switch before/after click,
  newer refusal, tab closed mid-flight, tab rebound, stale generation; race specs); AC 1.6 and
  4.5 point to it; banner risk row updated.
- F3 (Serious, cross-provider transfer of prose secrets) — fixed: Requirement 8 added (AC
  8.1-8.5: text-only transfer, tool I/O and attachments excluded, best-effort known-pattern
  redaction reusing `redactSecrets` or a boundary-correct equivalent, secret-bearing spec covering
  sent text, logs and UI payloads, disclosure on the button's accessible description and the
  notice); Scope, Security NFR and Accessibility NFR updated; "no extra filter" risk row replaced.
- F4 (Moderate, unbounded read; wrong `tailBytes` citation) — fixed: AC 3.4 requires a bounded
  read (architect specifies window or streaming limit); AC 3.10 adds the large-history case for
  both session kinds; D4 citation corrected (`readSessionHistory` options are
  `checkCompactionBoundary` / `includeBlockOwners`; `tailBytes` belongs to the separate
  `TranscriptWindowOptions` path); new risk row.
- F5 (Moderate, notice before success) — fixed: AC 4.3 shows the notice only after the new
  session id exists and the tab is bound; AC 5.1 and 5.2 state no notice on pre-session
  failures; AC 5.3 states the notice stays on post-session failure.
- Anchor note (full paths) — fixed: Context and D9 use
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts` and
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.{html,ts}`; the banner
  component path is given in full.
