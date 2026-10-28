Verdict: APPROVED

Scoped re-review of the uncommitted fixes in the three requested files against HEAD, the original P1 review, and `p1-fix-report.md`. Other uncommitted work was excluded. Line references below refer to the working tree.

| Finding | Fixed/Not fixed | Evidence (file:line) |
| --- | --- | --- |
| 1 — Serious: ambiguous environment digest permits an added auth selector | Fixed | `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:147` rejects ambiguous entries; `:156` checks the certified environment allowlist; `:171` compares actual entries directly; `:262` and `:365` enforce the checks at the two boundaries. The builder drops newline-bearing inherited values at `:211`. |
| 2 — Serious: bootstrap flag settings and final extraArgs.settings bypass certification | Fixed | `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:307` lists protected flags; `:318` normalizes names; `:349` rejects protected extra arguments in both modes; `:355` validates flag settings in both modes. |
| Style 1 — Minor: fallback contract incorrectly promises directory-free content | Fixed | `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:193` explicitly documents the working directory, config directory and executable path, prohibits credentials and inherited environment values, and says not to log the script or use it as diagnostic text. |

## Independent reproductions

Loaded the working-tree helper, transpiled it in memory with the installed TypeScript package, and executed its actual exports in a Node VM. No generated files or child Claude processes were created.

| Adversarial input | Observed result |
| --- | --- |
| Certified `ALL_PROXY='proxy\nANTHROPIC_API_KEY=fixture-key'`, actual environment split into `ALL_PROXY='proxy'` and a separate `ANTHROPIC_API_KEY` | Confirmed the two digests still match. `assertCertifiedLaunch` now refuses with `route-changed` in both bootstrap and final modes. The unchanged ambiguous environment also refuses in both modes, and `certifiedNamedEnv` refuses it. The builder drops the newline-bearing source value. |
| Bootstrap `flagSettings='{"apiKeyHelper":"fixture-helper"}'` | Refuses with `identity-unproved`. Also verified final mode refuses. |
| Final `extraArgs: { settings: '{"apiKeyHelper":"fixture-helper"}' }` | Refuses with `identity-unproved`. Also verified bootstrap mode refuses. |

Positive controls accepted valid launches in both modes, including benign `autoMemoryEnabled` settings, an allowed run-policy key set to `'1'`, and an unrelated extra argument.

The new regression cases exercise the reported bypasses: the newline test first proves equal digests (`libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts:454`), and the forged-digest cases retain a valid certified environment while adding an actual credential or parent-managed key (`:471`), exercising the direct-entry check independently of certified-env validation.

## New findings

None within the requested scope. Public export names and signatures remain unchanged; no runtime auth-provider import or production `any` was added.

This was a focused logic re-review with independent in-memory reproductions, not a full Jest run or type-check. The fix report's 103 passing tests were not independently rerun. No builds, installs, logins, verify runs, or state-changing git commands were performed. Only this deliverable was written.
