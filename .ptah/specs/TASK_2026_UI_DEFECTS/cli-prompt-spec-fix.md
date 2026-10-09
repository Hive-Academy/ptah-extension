# CLI prompt spec fix

## Cause

The memory-safe verification rule was correctly added to the shared
`NATIVE_AGENT_TOOL_POLICY`, but the `buildTaskPrompt` spec still used the
previous policy text in its canonical expected value and the Batch 14 inline
snapshot. This made prompt equality and snapshot assertions fail even though
the policy remained in the intended shared, once-only, resume-aware preamble.

## Change

- Code: no change. The intended rule remains in
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:419`,
  inside `NATIVE_AGENT_TOOL_POLICY`.
- Spec: updated
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts:102`
  and its affected Batch 14 inline snapshot at line 171 to expect that exact
  shared policy text.

The spec changed because it was stale; the implementation already preserves
section order, emits the policy exactly once, and treats it as the existing
`toolPolicy` preamble on restored-context resumes.

## Verification

`npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -40`

Results: 1 test suite passed; 101 tests passed; 1 snapshot passed.
