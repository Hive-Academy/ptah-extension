# Batch 10b.0b report

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-runtime.ts` — selects consumer-specific thread config, preserves positive-limit and full-access refusals, and exposes a safe pre-turn rejection after closing a failed context.
- `libs/backend/codex-runtime/src/lib/codex-context.ts` — carries the selected config into thread/start or thread/resume and drops it after the frame is sent.
- `libs/backend/codex-runtime/src/lib/codex-mcp-config.ts` — uses the lane builder as the only lane MCP source and refuses suppression names without an enforced mapping.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts` — covers exact lane frames, fixed chat/gateway wire frames, isolation, unsupported settings, rejection kinds, close, and retry.
- `libs/backend/codex-runtime/src/lib/codex-context.spec.ts` — checks the parsed start/resume boundary retains nested lane config.
- `libs/backend/codex-runtime/src/index.ts` — exports `CodexPreTurnConfigRejectedError`.
- `.ptah/specs/TASK_2026_714_c8a2/batch-10b-0b-report.md` — this report.

## Rejection seam

`CodexPreTurnConfigRejectedError` has `code: 'codexPreTurnConfigRejected'`, `retryEligible: true`, and a `method` of `thread/start` or `thread/resume`. It contains no remote message, stderr, secret, or raw cause. The runtime raises it only for a lane whose thread open was refused by RPC or process failure with a recognized config diagnostic in the bounded stderr tail. It awaits `context.close()` first; the test observes closed stdin and a new process generation on retry. A thread rejection without config evidence remains the generic open error with a `CodexRequestRejectedError` cause (including a model rejection). A rejected `turn/start`, including one after an earlier turn, remains `CodexRequestRejectedError`; no config retry signal is exposed. Other failures after a turn starts follow the existing context failure path.

## Frames

Lane thread/start and thread/resume send the same nested config (resume additionally sends `threadId`):

```json
{"agents":{"enabled":false},"features":{"plugins":false,"apps":false},"skills":{"include_instructions":false},"model_auto_compact_token_limit":5000,"tool_output_token_limit":3000,"web_search":"disabled","approval_policy":"never","mcp_servers":{"user.server":{"enabled":false},"ptah":{"url":"http://localhost:4823/session/tab-1/workspace/D%3A%5Cws","tool_timeout_sec":960}}}
```

The thread frame also has `approvalPolicy: "never"` and `sandbox: "workspace-write"`; the D26 working-directory restriction is supplied by the lane profile. Chat and gateway retain the dotted config shape, for example `{"mcp_servers.ptah":{"url":"http://localhost:4823/session/tab-1/workspace/D%3A%5Cws","tool_timeout_sec":960}}`. The spec compares serialized chat and gateway start/resume frames to fixed pre-change wire literals, including RPC IDs and property order. The 10b.0a fingerprint spec already pins both consumers' original D14 fingerprint; this batch does not change profile construction.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Select config by `consumer` before spawn. | Combine nested and dotted MCP values; use one source per consumer. | The 10b.0a review item 8 requires the lane builder as the single MCP source; exact lane and chat/gateway frame specs cover both paths. | Yes. |
| Refuse unmapped `suppressedTools` names. | Ignore unknown names; fail before spawn. | The existing blanket refusal prevented silent loss of suppression. The builder enforces agents, plugins, apps, skills, and listed user MCP disables; positive limits still have no mapping. | Yes, when a native mapping exists. |
| Classify config refusal from a pre-turn thread method plus a config diagnostic. | Treat every RPC refusal as config; require config evidence. | RPC codes alone do not identify configuration and could include a model rejection. Existing bounded stderr redaction keeps diagnostics out of the public error. | Yes. |
| Keep retry ownership with the later adapter. | Retry inside runtime; expose a typed reason after closure. | Batch 10b.0b requests a seam and a new context only after the old one closes; lane selection and adapter work are later batches. | Yes. |

## Not done

No lane selection, adapter, or host wiring was changed. Tests, lint, typecheck, builds, Nx, and diagnostics were not run because the lane rules forbid them; coordinator verification remains required. Skill discovery was available through Ptah, but it found no invocable local runtime skill, so none was loaded. `rg` was unavailable (`Access is denied`); targeted PowerShell reads were used for that search.
