# Code logic review — orchestrator edits (TASK_2026_714_c8a2)

Reviewed commits (committed tree only, via `git show`; the working tree is under concurrent edit by another agent):

1. `f9e3f6def` — `approval_policy` `'untrusted'` → `'on-request'` in `policy()`.
2. `9756958be` — `OUTPUT_BOUNDS` replaces `model_max_output_tokens=1024`.
3. `3ec2bb479` — Nx 24 inferred targets + `no-unsafe-finally` disable on the cleanup throw.

Reviewed at HEAD `3ec2bb479`. Read in full: committed `tools/evidence-harness.ts` (867 lines), `tools/evidence-cases.json`, the changed spec hunk, `libs/backend/codex-runtime/project.json`, `libs/backend/cli-agent-runtime/project.json`, `nx.json` plugin blocks, `context.md`, `task-description.md`, `decisions.md` (committed excerpts). No checks were run by this review (not permitted); verification evidence is taken from the committed `decisions.md` (test 38/38, typecheck, lint pass at HEAD) and the committed spike-run artifacts (runs 2–5). Commit file lists were enumerated with `--stat`; no changed file escaped review.

## Findings

### F1 — Minor — OUTPUT_BOUNDS verification proves echo, not enforcement

`tools/evidence-harness.ts:721` (check), `:523` (configSummary key echo), `:616` (`-c` overrides), `:19-20` (constant).

The check `Object.entries(OUTPUT_BOUNDS).some(([key, value]) => effective[key] !== value)` fails closed when a key is absent, `null`, or type-mismatched: a config/read without the key yields `undefined`, and `undefined !== 'low'` throws `'Effective config differs from bounded profile'`. The one channel that passes while unbounded is a server that echoes requested overrides without applying them. Recorded evidence contradicts that behavior for 0.155.1: run 4 requested `model_max_output_tokens=1024` as a `-c` override, config/read did not echo it, and the run stopped on exactly this check (spike-run-4 artifacts committed in `f9e3f6def`). Independent ceilings bound the residual risk regardless: `TURN_CAP` 8, `USAGE_CEILING` 12000 (enforced in `UsageBudget.observe`), `CASE_DEADLINE_MS` 60000, `MAX_FRAME_BYTES` 1MB. Not a defect; recorded as a verification-strength limit of the only channel the protocol offers.

### F2 — Minor (pre-existing) — cleanup status can claim success when createExperiment throws before register

`tools/evidence-harness.ts:226-243` (`createExperiment`: symlink check at `:229` precedes `register` at `:232`), `:827-831` (finally cleanup), `:830-831`.

If the `:229` symlink check throws, runHarness's `experiment` stays `undefined`. The finally at `:827-831` then skips `cleanupExperiment` and writes the success string `'home/auth deleted; experiment deleted'` while the temp dir created by `mkdtempSync` at `:228` may remain. No secret is in it: the auth copy happens at `:236`, after `register`. Practically unreachable on real temp dirs; reachable only with a mocked `io`. This predates all three reviewed commits, and the throw at `:857` does not cover it because `cleanup` never becomes `'FAILED'`. Answer to question (d) "is cleanup always attempted": yes for every path that registers the experiment; this one pre-registration path is the only gap, and it carries no credentials.

## Answers to the review questions

### (a) Can any change weaken a safety gate?

No.

- **Sandbox.** `policy()` still asserts through `assertSafeSandbox` (`:515-516`); runCase still builds the per-turn `sandboxPolicy` (readOnly / workspaceWrite with `writableRoots: [experiment.workspace]`, `networkAccess: false`) at `:727-728`; `assertSafeSandbox(params)` runs on every outbound request (`RpcChild.request`), on the `thread/start` result, and on the config/read echo (`configSummary` `:521`). No commit touched these.
- **Approval-before-effect.** `markerApprovalDecision`, the default decline in `RpcChild.onRequest`, the before/during-approval marker checks, and the 20ms `inspect()` guard (`'Side effect before approval'`, `'Side effect during approval'`, `'Unexpected marker effect'`) are unchanged. Codex-side strictness does drop from `'untrusted'` (approval for every command) to `'on-request'` (model-chosen), but `'untrusted'` makes 0.155.1 exit at startup, so the alternative was no harness at all; `'on-request'` is the strictest usable interactive policy (`'never'` asks nothing). The harness's effect gates do not depend on the codex-side policy: the sandbox blocks writes at read-only levels, and at workspace-write levels any unapproved marker effect is detected by `inspect()` and recorded as a case failure. The change is documented with the committed spike-run artifacts (runs 2–4: each failed closed, 0 of 8 turns, clean temp dir), and the spec guard (`evidence-harness.spec.ts:227`) was updated to match rather than weakened.
- **Secret cleanup.** Commit `3ec2bb479` only adds the rationale comment and a single-line eslint-disable (`:855-856`); the throw at `:857` already existed, so silencing the lint rule changes no runtime behavior. The throw strengthens the visible gate: a failed cleanup now fails the process even after an otherwise successful run, so leaked credentials cannot hide behind exit 0.
- **Artifact sanitization.** The exemption at `:162` admits only a JS number under the exact key `tool_output_token_limit`. A number cannot carry a secret; a string value under that key is still redacted. The exemption exists so the artifact shows the real bound instead of `'[REDACTED]'`, which would make the evidence unusable. No leak.

### (b) Does the OUTPUT_BOUNDS check fail closed when codex ignores a key?

Yes, for absence and mismatch. `configSummary` (`:523`) maps each bound key to `config[key]`; an ignored key yields `undefined`; `undefined !== 'low'` and `null !== 'low'` throw at `:721`. A type change in the echo (string `'2000'` instead of number `2000`) also throws, because the `-c` override at `:616` sends the JSON.stringify'd value and the check is strict `!==`. The only pass-while-unbounded channel is echo-without-apply (F1), which run-4 evidence contradicts and the independent ceilings bound.

### (c) Does the sanitize() exemption leak anything?

No. The redaction branch at `:160-164` fires only when the key matches the sensitive-key regex; `tool_output_token_limit` matches (`token`). The added exemption at `:162` requires `typeof entry === 'number'` and an exact key match against the anchored allowlist. Numbers carry no string secrets, so nothing can leak through it. The pre-existing camelCase token-counter exemptions are untouched.

### (d) Is the throw-in-finally correct?

Yes.

- **Structure.** Outer `} finally {` at `:827`; the inner try `:828-832` always attempts cleanup (stop all children, then `cleanupExperiment` when `experiment` exists), then sets the success string at `:831` or `'FAILED: manual cleanup required'` at `:833`; the artifact at `:835` records it; the conditional throw at `:857` fires only on `'FAILED'`.
- **Override semantics.** When cleanup succeeds, the finally completes normally and any in-flight error propagates unchanged. When cleanup fails while an error is in flight (createExperiment failure, loop-level throw), `'Secret cleanup failed'` replaces it — intended per the `:855` comment, and the right precedence: an unremoved credential copy on disk outranks the run error. The artifact preserves the classification of both (`cleanup: 'FAILED: manual cleanup required'` plus per-case notes from `recordCaseFailure`); the CLI catch prints a generic message and exits 1.
- **Cleanup always attempted.** Every path entering the try at `:766-826` reaches the inner try; per-case errors are caught and recorded first. The one pre-registration gap is F2 (pre-existing, no credentials). `cleanup` can never still be `'pending'` at the check: the inner try/catch always assigns one of the two terminal strings.

### (e) Are the Nx targets resolvable and consistent with the sibling lib?

Yes.

- `codex-runtime/project.json` now has the exact sibling shape of `cli-agent-runtime/project.json`: explicit esbuild `build`, options-only `test` (`passWithNoTests: true`, no executor, no `outputs`), explicit `run-commands` `typecheck`, no `lint` target. Inferred targets come from the plugins.
- `nx.json`: the `@nx/jest/plugin` (`targetName: test`) and `@nx/eslint/plugin` (`targetName: lint`) registrations both gained `libs/backend/codex-runtime/**/*` in their include lists. The lib's `jest.config.ts` (referenced by the removed explicit options, untouched by the commits) lets the jest plugin infer the target. Recorded evidence at HEAD (`decisions.md`, commit `3ec2bb479`): test 38/38, typecheck and lint pass — and the first lint run is what surfaced `no-unsafe-finally`, proving the lint target resolves and runs. The other eslint registration (`targetName: eslint:lint`, no include) applies to all projects as before; siblings live under the same config.
- The removed `outputs: ["{workspaceRoot}/coverage/{projectRoot}"]` matches the sibling, which also carries no test outputs; Nx 24 plugin defaults own them.
- One nit outside this review's lane (style): the include entries are inserted before `libs/backend/cli-engine/**/*`, breaking alphabetical order in both lists. No logic effect.

## Five logic questions

1. **Silent failure.** Two candidates, both evidenced above: F1 (bounds passing on an echo-without-apply server) and F2 (success-looking cleanup string after a pre-registration throw). Neither is reachable without a server that lies in config/read or a mocked filesystem.
2. **Unexpected user action.** Running the harness against a codex build that renames or drops one bound key refuses to run at `:721` — fail closed, intended. `--keep` retains non-home files and the artifact states exactly that (`:831`).
3. **Wrong answer instead of error.** Only the F1 channel produces a wrong-looking pass; every other deviation (absent key, null, type change) throws instead of proceeding.
4. **Dependency failure.** config/read timeout fails through `REQUEST_TIMEOUT_MS` 15s (`'RPC timeout'`); a child crash fails through `'child closed'`; both are recorded, stop the case and set `stop = true`. No silent pass.
5. **Missing from requirements.** `task-description.md` demands "a missing native mapping fails visibly and does not claim the setting applied" — the bounds check honors it exactly. The approval-policy switch is spike tooling, not the shipped chat runtime; the product constraint on approval semantics targets the runtime mapping, and the harness's own accept/decline and effect gates are unchanged. The switch is documented in the commit message, `decisions.md`, and the committed spike-run artifacts.

## Decisions

- Decision: treat the evidence harness as spike tooling, not the shipped chat runtime, when applying the "no approval semantic weaker than the one the user selected" constraint. Options: (a) treat the harness as product runtime and escalate the policy change, (b) treat it as tooling. Evidence: `context.md` records batch 1a as "spike tooling, code only"; the harness lives under `tools/` with a `require.main === module` CLI entry; its own accept/decline gate is unchanged and stricter than the codex-side policy. Reversible: one line at `:515`.
- Decision: accept the committed spike-run artifacts (runs 2–5) as the behavioral evidence for 0.155.1's handling of the removed and added config keys, because running the codex binary was not permitted for this review.

## Verdict

Score: 8/10. No blocking or serious findings. Both findings are Minor: one is an inherent limit of the verification channel, handled honestly and backstopped by independent ceilings; the other is a pre-existing edge outside the reviewed diff. What separates this from 9–10: the OUTPUT_BOUNDS check can prove echo but not enforcement, and the cleanup success claim has the pre-existing F2 hole. What separates it from 5–6: every gate claimed intact is verifiably intact in the committed source, every change carries recorded spike evidence, the spec was updated to match rather than loosened, and the fail-closed claims hold under the exact semantics questioned.

APPROVED