# Batch 20 report

## Files

- Created `libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.ts` and `.spec.ts`.
- Deleted `libs/frontend/onboarding/src/lib/ready/ready-claude-step.page.ts` and `.spec.ts`.
- Modified `libs/frontend/onboarding/src/lib/onboarding.routes.ts`, `.spec.ts`, `first-run/onboarding-first-run.guard.ts`, and `.spec.ts`.

## Parity rows 20–38

The new page composes the Batch 19 provider panel. Panel and copy-row details remain covered by their own component specs; the new page spec asserts they are present in the routed composition.

| Row | New location | New spec case |
| --- | --- | --- |
| 20 | Page mount, `ProviderReadinessStore.refresh('mount')` | `row 20: mount reads host cache once for both providers` |
| 21 | Page heading | `row 21: route heading is one focusable h1 for both providers` |
| 22 | Page lead | `row 22: provider-neutral lead explains the main connection and later fix` |
| 23 | Provider panels | `row 23: each provider has a status chip` |
| 24 | Provider panels | `row 24: each provider keeps installed, version and signed-in facts` |
| 25 | Claude provider panel | `row 25: local error preserves a signed-in cause line` |
| 26 | Provider panels | `row 26: checking panel is busy and exposes state` |
| 27 | Claude install block | `row 27: Claude install help retains OS tabs` |
| 28 | Install block | `row 28: install help has copyable command rows` |
| 29 | Shared command copy row | `row 29: copy row remains a separate reusable component` |
| 30 | Claude install block | `row 30: missing help includes the PATH and restart hint` |
| 31 | Claude install block | `row 31: official install guide is an https safe link` |
| 32 | Claude sign-in block | `row 32: signed-out help retains the copyable claude command` |
| 33 | Claude sign-in block | `row 33: named-account link targets the Claude Accounts drawer` |
| 34 | Claude error block | `row 34: error help remains distinct from signed-out help` |
| 35 | Page footer | `row 35: not-ready footer explains continuing without the connection` |
| 36 | Page footer | `row 36: mount checking footer names the computer check` |
| 37 | Page Continue action | `row 37: Continue writes connectionAt and opens settings` |
| 38 | Page Continue anyway action | `row 38: Continue anyway writes skippedAt and opens settings` |

## AC coverage

- AC 1.1/1.2: fixed Claude and Codex panel order, facts, ready bundled Codex without install help.
- AC 2.1–2.4: Codex install rows and guide, existing sign-in block, failed/cancelled states retain Re-check, ready provider omits help.
- AC 4.5: other provider receives information role and closed help details.
- AC 4.6: guard accepts `claudeAt`, `connectionAt`, or `skippedAt`; added `connectionAt` guard case.
- Stage 1 uses the ready strip `connection` input, refreshes both providers on mount and Re-check, announces Re-check results Claude first, invokes `recheckCodex()` after sign-in success, and moves focus to Continue when the chosen connection becomes ready.

## Remaining imports

`rg -n 'ready-claude-step|ReadyClaudeStepPage' libs apps` found no imports or class references. Four out-of-scope E2E selectors still refer to `data-testid="ready-claude-step"`: `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts` (2), `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts` (1), and `onboarding-ready.fixtures.ts` (1).

## Decisions

- Continued only for the confirmed, saved provider when its readiness state is `ready`; a pending choice remains a separate confirmation. Options were to follow the pending card or the saved selection. The choice store and design section 7 identify the saved selection as authoritative. Reversible.
- Kept Claude and Codex in fixed DOM order, with the choice shown through panel roles. The design specifies this order. Reversible.
- Used `connectionAt` for a successful Continue, as this batch instruction supersedes the earlier design-spec sentence naming `claudeAt`. The guard continues to honor old `claudeAt`. Reversible.

## Risks and limits

- Did not run Jest, Nx, npm verify, tsc, build, serve, e2e, or git, as explicitly prohibited for this lane.
- Scoped `ptah_get_diagnostics` was attempted three times; each returned TypeScript compiler unavailable after a 45-second timeout. No typecheck result is claimed.
- No Electron visual review was possible within the permitted tools and run restrictions.
- The Angular skill loader is unavailable in this host; no skill was loaded. Implementation followed repository code and supplied design/spec documents.
- The four E2E selectors above will need an owner outside this batch's file scope.

## Clarifications Needed

- The four out-of-scope E2E selectors target the removed page test id. Their owner should update them to `ready-connection-step` in a later batch.
