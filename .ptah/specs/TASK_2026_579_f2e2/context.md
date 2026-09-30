# Task Context - TASK_2026_579_f2e2

## Evidence

`%APPDATA%\Ptah\logs\Ptah Electron-2026-09-30.log`:

- 12:56Z–12:59Z: about 20 requests through `[CodexProxy]`, each `Rate limited by Codex Responses API`, then
  `curation pass stalled before dispatch ... reason: provider-unreachable, providerId: openai-codex`.
- 13:18Z: user clicked Run now. Same pattern. 13:21Z: `memory:runNow` slow handler, `durationMs: 202290.6`,
  `runNow — pass stalled before dispatch; nothing was consumed`.
- 13:33Z: `Provider quota exhausted; retrying in about 3 min` → `reason: provider-cooling-down`.
- `observation_queue`: 70,773 rows, 23,710 unprocessed.

The stall-safe behavior is correct: nothing was consumed or lost. The defect is that curation depends on
one provider.

## Code

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:231-249` resolves
  one `curatorProviderId` and returns `cooling-down` on quota errors.
- `libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts` feeds unreachable outcomes to
  the back-off.
- `libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts`.
- The skill enhancer uses the same resolution (`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`).

## Scope

1. An ordered fallback list of curator providers (setting), default: configured provider, then the active
   chat provider. Only providers with usable auth are tried.
2. On `cooling-down` or `provider-unreachable`, try the next provider in the same pass before stalling.
   Record which provider served the pass.
3. Detect a 429 early: a rate-limited response must end the attempt on that provider instead of retrying
   for minutes inside the proxy.
4. Show the serving provider and the cooling-down providers in memory diagnostics.

## Acceptance criteria

1. A spec: primary provider returns a quota error, the fallback provider serves the pass, and observations
   are consumed.
2. A spec: all providers fail, the pass stalls, and nothing is consumed (current guarantee kept).
3. A manual Run now with a rate-limited primary finishes in less than 30 s on the fallback.
