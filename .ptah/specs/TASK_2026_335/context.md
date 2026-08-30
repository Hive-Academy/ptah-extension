# Context — TASK_2026_335

## Where this came from

The cross-vendor review of TASK_2026_323 on 2026-08-28. Two independent Phase 3
reviewers — an internal `code-logic-reviewer` and an `ollama cloud` agent —
found the same three items without seeing each other's work. Full review:
`.ptah/specs/TASK_2026_323/cross-vendor-review.md`.

The unifying principle: **silent truncation of a user's own content is a defect,
not an optimization.** A cap that the user cannot see is indistinguishable from
data corruption, because the user has no way to know something was there.

## Defect 1 — SERIOUS. `MAX_AGENT_SEGMENTS` drops without folding

`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:108,821-823`

```ts
updated.segments = updated.segments.slice(-MAX_AGENT_SEGMENTS); // 500
```

A naive drop of the oldest structured-output segments — the Codex and Copilot
SDK text and thinking chunks. No fold, no synthetic marker, no console warning.
A long agent's opening plan and reasoning simply vanish from its card, and are
gone for good if that session is later persisted for resume.

**The fix already exists twenty lines away.** The `streamEvents` cap at
`:72,79,1763-1821` handles exactly this problem correctly:
`foldDroppedDeltas` and `dropUnanchoredRuns` fold dropped text and tool deltas
into synthetic events attached to a surviving landmark, and fall back to an
outright drop (`folded.splice(0, overflow)`, `:1814`) only in the pathological
case of thousands of distinct accumulator keys with almost no landmarks. The
lib's own `CLAUDE.md` documents why that folding was necessary: keeping
landmarks alone "kept every message and tool node while deleting everything that
gives them content, irreversibly".

The segments cap is the same surface with none of that care. Apply the same
treatment.

The two reviewers rated this differently — `ollama cloud` said LOW because the
persisted `tool_result` record survives, the internal reviewer said SERIOUS. The
internal reading is better: the neighbouring cap is proof the codebase already
decided folding is required here.

## Defect 2 — MODERATE. Debounced persistence with no flush on teardown

`libs/frontend/chat-state/src/lib/tab-manager.service.ts:174-188,1862-1890`

- `SAVE_DEBOUNCE_MS` = 500 ms trailing
- `SAVE_MAX_WAIT_MS` = 5000 ms

Both reviewers searched for a flush and neither found one:

- No `ngOnDestroy` and no dispose on `TabManagerService`.
- No `beforeunload` or `pagehide` listener anywhere in app or lib source.
- `apps/ptah-electron/src/main.ts:84` `before-quit` flushes only `fileSettings`
  and Sentry — nothing tab-related.
- `tab-manager.persistence.spec.ts` has no flush-on-close test.

`setTimeout` timers do not survive process or window teardown. So:

1. A turn finalizes and `setMessages` queues a save.
2. The user closes the webview panel, or the extension host disposes it, within
   500 ms — or within up to 5 s under a continuous stream.
3. The pending `localStorage` write never happens. Lost: the just-finished
   assistant message, the finalized `ExecutionNode` trees, tab metadata.
4. On restore, `SessionLoaderService` calls `chat:resume` but **discards** the
   returned messages as already cached from `localStorage`. So the last reply
   does not come back from the backend either.

Step 4 is what turns a small race into real loss. Consider whether the resume
path should reconcile rather than discard, as a second line of defence.

The 500 ms debounce predates TASK_2026_323. The 5 s max wait is new, and it
widens the window tenfold under exactly the streaming conditions this surface
sees most.

## Defect 3 — MODERATE. `capBuffer` front-truncates stdout with no marker

`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:57,2007-2012`

`MAX_FRONTEND_BUFFER` = 50 KB. `capBuffer` keeps only the tail, snapping to a
newline where it can. No "output truncated" marker is shown. A long-running
ptah-cli or Codex agent's early stdout is unrecoverable from the live card, and a
user scrolling back finds it simply gone.

Confirmed pre-existing and not part of the `acaf2a23c` diff. It is included here
because it is the same defect, on the same surface, and fixing the other two
without this one leaves the surface inconsistent.

## Fix direction

For all three, the rule is the same: **make the loss visible, or do not lose it.**

- Defect 1 — fold, following `foldDroppedDeltas` as the pattern. Where folding is
  genuinely impossible, emit one synthetic marker segment rather than nothing.
- Defect 2 — add a teardown flush. It needs to fire on webview dispose, on
  extension-host dispose, and on Electron `before-quit`. A `pagehide` listener
  covers the webview case; the host cases need explicit wiring the way
  `fileSettings` already has at `main.ts:84`.
- Defect 3 — render a truncation marker at the head of the buffer, stating that
  earlier output was dropped.

Do not solve any of these by raising the cap. The caps exist because
TASK_2026_323 measured them as necessary. The defect is silence, not the bound.

## Verification

- `agent-monitor.store` specs — assert the user-visible effect of each cap on the
  rendered card, not merely the array length. Today only length and landmark
  retention are tested, which is why a naive `slice` passed review.
- `tab-manager.persistence.spec.ts` — dispose the service with a save pending and
  assert the last mutator is flushed. If a case is deliberately not flushed, the
  test should say so explicitly.
- A test that a truncated stdout buffer renders its marker.
