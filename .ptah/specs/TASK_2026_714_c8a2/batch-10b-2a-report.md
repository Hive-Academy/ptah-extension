# Batch 10b-2a report

## Files changed or created

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts` — validated effort, bounded pre-turn retry, context lifecycle, and terminal model advice.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts` — focused native adapter cases.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-rejection.ts` — shared helper reuse for config reduction and source-aware model advice.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-profile.ts` — identity schema and handled requirements extracted to keep the adapter at 449 lines.
- `.ptah/specs/TASK_2026_714_c8a2/batch-10b-2a-report.md` — this report, UTF-8 without BOM.

## Reasoning effort

- `codex-app-server-lane.adapter.ts:128-149` accepts exactly low, medium, high, xhigh from the command or resolved lane config and passes valid effort into the public `buildCodexExecutionProfile` input. The existing runtime maps profile effort to `turn/start` (`codex-context.ts:511-515`); the same open context carries it into continuation turns.
- `codex-app-server-lane.adapter.ts:187-191` emits a visible info segment for an invalid effort, while the profile has no effort. The runtime then sends its valid null effort value. Explicit binary-path refusal remains at `codex-app-server-lane.adapter.ts:115-119`.

## Config rejection

- `codex-app-server-lane.adapter.ts:255-291,366-385` retries only one `CodexPreTurnConfigRejectedError` before any turn event. It emits the legacy notice and the buffered `onLaneConfigRejected` callback once. A second rejection emits a visible error and ends the turn; a later `runSdk` starts with full settings again.
- `codex-app-server-lane-rejection.ts:20-50` reuses `essentialCodexConfigEntries` and `codexRejectionNamesUserServer`. It drops lane auto-compact and tool-output budgets, retains effort, Ptah MCP, web search, approval policy, role, and disabled user MCP servers unless rejection text names one. The optional named-server notice uses the legacy wording.
- `codex-app-server-lane.adapter.ts:255-274` aborts the old event pump, awaits the old context's idempotent close, then opens the retry context. The retry resumes the thread identity when one exists. At most one context is live.

## Model rejection

- `codex-app-server-lane.adapter.ts:295-312` acts only on a failed terminal event and never retries or substitutes a model.
- `codex-app-server-lane-rejection.ts:53-59` uses `codexModelRejectionMessage` with the lane model source and a redacted, bounded Codex excerpt. Nonterminal wording passes through normal event mapping.

## Spec cases

- `passes %s reasoning effort through the lane profile` (low, high, xhigh); `warns on invalid effort and sends no effort in the profile`; `keeps reasoning effort on continuation turns`.
- `retries a pre-turn config rejection once with essential settings and one notice`; `retries config rejection during context open before the turn`; `closes the old context once before opening the essential retry`; `reports a second config rejection visibly without a third attempt`; `does not retry config rejection after a turn event`; `mentions re-enabled user MCP servers when rejection identifies one`.
- `gives source-aware model rejection advice for %s` (Ptah default, setting, spawn request); `does not give model advice for nonterminal wording`; `redacts the Codex excerpt in terminal model advice`; `keeps the deferred binary and catalog capability seams`.
- Existing 10b-1 cases remain in the spec file. Tests, lint, typecheck, build, Nx, npm, diagnostics, and other verification targets were not run under the lane rules. Ptah AST inspection parsed all four changed TypeScript files cleanly; this establishes syntax only. Ptah dependency indexing was incomplete, so its zero-dependent result is inconclusive.

## Decisions

- The App Server runtime profile is the public effort path; no Codex SDK import or frame construction was added.
- A typed config rejection is retried only within its run. The first context is closed exactly once before the retry opens, and event delivery from the old context is ignored.
- Model advice uses the existing source-aware helper and environment secret redaction, and only a terminal failure is classified.
- The local `agent-lanes` skill was read directly because this CLI exposed no native skill loader. No UI work was involved.

## Clarifications Needed

- The public `CodexPreTurnConfigRejectedError` currently carries only `method` and a fixed generic message; `codex-runtime.ts` discards the stderr that identified the rejected key. Therefore a real native rejection cannot tell this adapter whether a named user MCP server must be re-enabled. The named-server branch is covered by an enriched-error spec, but it cannot be reached from the current runtime. The runtime needs a safe, redacted rejected-key field (or equivalent public error detail) in a later scoped change; the index and runtime were read-only for this lane.