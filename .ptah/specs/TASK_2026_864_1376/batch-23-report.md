# Batch 23 test report

## Scope

Tests only for parity rows 2, 25, and 39. Eleven Jest cases were added across three spec files. CI will run the suite; local test commands are prohibited for this batch. `git diff --check` passed. Scoped `ptah_get_diagnostics` was attempted twice but timed out, leaving all three files unchecked.

## Parity row 2

- `libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts:47`: three parameterized cases assert `missing` beats timeout, local failure, and detection error when the ambient answer says the CLI is missing.
- `libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts:53`: detection error with connected ambient returns `error/local` and failed binary fact.
- `libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts:60`: absent Claude row returns `error/local` and failed binary fact.
- `libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts:67`: ambient local failure returns `error/local` and failed sign-in fact.

## Parity row 25

- `libs/frontend/onboarding/src/lib/ready/provider-panel.component.spec.ts:16`: two parameterized cases, for Claude and Codex, assert ArrowRight wraps last to first and ArrowLeft wraps first to last. Each direction asserts selected state, tab stop, and actual DOM focus.

## Parity row 39

- `libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.spec.ts:89`: two parameterized cases, for chosen Claude and Codex, change readiness during Re-check, then assert Continue appears and receives DOM focus.
- `libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.spec.ts:110`: a Re-check that leaves the chosen provider unready leaves focus on Re-check and does not show Continue.

## Decisions

- Omitted Home and End cases because neither handler implements those keys. This is reversible; add tests if keyboard handling is added.
- Kept tests at the existing derive and Angular component seams, using the nearby spec helpers and Jest idiom. No new fixtures were needed.
- Skill loading is unavailable in this CLI tool list; no skill instructions were inferred.

## Not done

- No local Jest, Nx, npm, TypeScript, build, or browser command was run, per Batch 23 instruction. CI execution and type diagnostics remain outstanding.
- The requested old `ready-claude-step.page.spec.ts` path does not exist at commit `2ef54d869`; the old Claude readiness store spec was read and its relevant precedence cases were ported.
