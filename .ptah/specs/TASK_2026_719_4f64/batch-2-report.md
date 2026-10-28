# Batch 2 report - TASK_2026_719_4f64

Executor: backend-developer (Claude subagent). Batch: 2 (Chat RPC account selection schema).

## Task 2.1: Optional `accountSelection` on start/continue/resume - DONE

Evidence:

- `ChatStartParams`, `ChatContinueParams`, `ChatResumeParams` each gain
  `accountSelection?: ProviderAccountSelection` (type imported from `../provider-account.types`,
  the existing shared type; no new type introduced).
- `ChatStartParamsSchema`, `ChatContinueParamsSchema`, `ChatResumeParamsSchema` each gain
  `accountSelection: ProviderAccountSelectionSchema.optional()`, imported from
  `@ptah-extension/shared/schemas` (the same import `agent-rpc.schema.ts:30` and
  `chat-slash-command-router.service.ts:45` use). The shared schema is a strict discriminated union
  (`omitted` / `ambient` / `named` + opaque `profileId`), so malformed shapes are rejected while the
  outer objects stay `.passthrough()`. Header doc comment updated to say so.
- `ChatSessionSummary.accountProfileId?: string` added (`execution/node.ts`, end of the interface,
  doc: absent = default/ambient route or no binding known). Opaque id only, no label/path/email.
- Spec `chat-rpc.schema.spec.ts`: new `describe.each` over start, continue and resume:
  - accepts `{kind:'named', profileId:'profile_01'}`, `{kind:'ambient'}`, `{kind:'omitted'}`;
  - omitted field stays absent and the request still validates;
  - rejects: a string, `null`, unknown kind, named without id, empty id, numeric id,
    path-shaped id (`../profiles/a`), ambient with an extra key, named with an extra key.
  - Existing key-pin test (`declares only the base keys ...`) updated to include
    `accountSelection` for start and continue (that test lives in the batch-owned spec and pins
    the shape this batch intentionally changes).
- Handler unchanged: `chat-rpc.handlers.ts:239-284` parses then forwards raw `params`; the
  service already reads `params.accountSelection` (`chat-session.service.ts:520`, `:951`,
  `:1121`), so the shared field now types what was already accepted.

## Files

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/rpc/rpc-chat.types.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/execution/node.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts

## Specs that mock or pin changed members (rule 5)

- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts` - pins schema keys; updated
  (batch-owned).
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts` - sends requests without
  the field; field is optional, no change needed (listed in the batch as must-pass-unchanged).
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-history-page.spec.ts` imports only
  `ChatHistoryPageParamsSchema` (unchanged); `session-rpc-rewind-persona.spec.ts` imports only
  `SYSTEM_PROMPT_MAX_LENGTH` (unchanged). No `jest.mock` of `chat-rpc.schema` anywhere.
- `ChatSessionSummary`: additive optional field, absent in every existing fixture; no spec pins
  its exact key set. Ambient-path pins (plan 943-953) untouched.

## Verification

- `ptah_get_diagnostics` (files = the 4 changed files, severity error): 0 errors, coverage clean.
- `npx prettier --write` on the 4 files (spec reformatted, others unchanged).
- Not run (rule 12): `npm run verify -- -t lint,test,typecheck -p @ptah-extension/shared,@ptah-extension/rpc-handlers`
  - team-leader owns it.

## Risks

- Ambient expectation drift (HIGH): omitted field keeps requests identical; spec pins that an
  absent selection stays absent; no ambient pin edited.
- Malformed selection reaching the service: strict shared schema rejects extra keys, unknown kinds
  and non-opaque ids at the RPC boundary (spec cases above).
- Leak (rule 11): only an opaque profile id crosses RPC; no label, path, email or env.
- No new dependency edge: `rpc-handlers` already imports `@ptah-extension/shared/schemas`.

## Decisions

- Placed `accountSelection` on the shared param types directly (not via the service-local
  `MainSessionAccountSelection`), as the plan's line 167-172 says; the intersection type in the
  service stays valid and is left for later batches. Reversible.

## Plan deviations

None.

## Out-of-scope observations

None.
