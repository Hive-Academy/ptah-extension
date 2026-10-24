# Batch 1i report

## Summary

Implemented the single tolerated original-marker read for ask-command-edit and the ask-read-rule exec-policy probe. Added focused pure matcher and fake-child specs. No tests, standalone typecheck, lint, prettier, build, App Server or paid model were run. Scoped ptah_get_diagnostics reported zero errors and warnings, including after the final source edits.

## Files changed (line ranges)

- libs/backend/codex-runtime/tools/evidence-harness.ts:323-365 (case/result types), 919-945 (pure matcher), 1022-1030 (read-rule command identity), 1152-1195 (fixture/rule before spawn), 1253-1257 (observation state), 1336-1370 (tolerated approval denial), 1405-1410 (exact rule gate), 1519-1608 (notification identity, completion evidence, bounded tool count), 1686-1691 (fixture instructions), 1755-1767 (result classification), 1810-1813 (rule cleanup).
- libs/backend/codex-runtime/tools/evidence-harness.spec.ts:38, 58-95 (matcher import/specs), 1400-1725 (fake-child scenarios and lifecycle checks), 1768-1807 (new flow assertions), 1970-1990 (one-turn case declaration).
- libs/backend/codex-runtime/tools/evidence-cases.json:36-44 (ask-read-rule immediately after ask-command-edit).
- libs/backend/codex-runtime/tools/evidence-failure-notes.ts:5-8 (four literal note labels).
- .ptah/specs/TASK_2026_714_c8a2/batch-1i-report.md (this deliverable).

## Exec-policy rule evidence (quoted strings / schema)

Inspected the bytes of D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe using a bounded Node Buffer string search, without executing the binary. Found these literal fragments:

- `default.rules`
- `prefix_rule(`
- `decision="allow"`
- `loaded exec policies`
- `exec policy rules loaded`
- `.rules files in`
- `failed to parse rules:`
- `core\src\exec_policy.rs`
- `rules prefix_rule at index`
- `has decision 'allow', which is not permitted in requirements.toml: Codex merges these rules with other config and uses the most restrictive result (use 'prompt' or`

Searches for literal `rules/` and `decision="prompt"` found no hits. The first `forbidden` hit concerned AWS IMDS, so it is not evidence for exec-policy syntax. Binary strings support the rule filename, prefix-rule concept and prompt decision, but do not establish the exact directory or a complete callable signature. The implementation therefore records `exec-policy rule location unverified` and uses the best-evidenced candidate `CODEX_HOME/rules/default.rules`.

The pinned protocol schema at libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:7843 defines granular `rules` as boolean and requires it alongside mcp_elicitations and sandbox_approval. Execpolicy amendment references at 2687-2699, 2826 and 4451-4463 concern approval amendments, not a rules-file location. CommandExecutionStatus at 9012 includes completed, failed and declined (also inProgress); completion status is parsed with Zod and recorded without retaining output.

Rule content is one line, using JSON string/array literals as the candidate Starlark-compatible syntax:

```text
prefix_rule(pattern=["Get-Content","-LiteralPath","<fixture path with forward slashes>"], decision="prompt")
```

On non-Windows the pattern is `["cat","<fixture path>"]`. The artifact stores the actual relative path and actual generated content in execPolicyRule.path/content; normal artifact sanitisation still applies.

## Tolerated read matcher

isToleratedMarkerRead accepts exactly Get-Content, Test-Path or Get-Item with -LiteralPath/-Path and one single-quoted argument on win32, or cat/test -e on other platforms. Windows wrapping is validated by the existing commandMatches function, including absolute powershell.exe/pwsh.exe identity. It rejects chaining, redirection, backticks, command substitution, extra arguments and other paths. Only slash direction is normalized; path case and all remaining characters must match.

The exception applies only to the ask-command-edit ID, edit decision and read-only sandbox. One item/started before any approval claims the exception; its matching item/completed is associated by item ID. It consumes no slot from the existing two-command tool limit. A second or late read still fails as Unexpected command. An approval for the tolerated item is declined and noted separately, preserving the original/replacement approval indexes used by unchanged inspect() checks. The original marker must remain absent.

## ask-read-rule behaviour step by step

1. Before spawn, create ask-read-rule.fixture.txt with content fixture in the workspace, then create the single-rule file in the isolated experiment home.
2. Save rule path/content in the result and record the unverified-location note. Launch with the existing childEnvironment CODEX_HOME isolation, granular all-true approval profile, read-only sandbox, experimentalApi initialization and usage/output bounds.
3. Ask for the exact fixture read on its own command line. All command items and approvals retain exact-command/existing-wrapper validation.
4. A matching approval before completion is held under the existing guard, then declined. A completion before an approval prevents a later approval from qualifying. No output text is retained.
5. Record the parsed completed status when available. Observed requires the normal one-approval outcome plus a declined/failed completion or an interrupted terminal turn. The existing decline path requests interruption.
6. Completion without approval records status and note `unverified: rule did not prompt`; it is not thrown as a harness error. The existing run-level policy still stops subsequent inference on any unverified case.
7. Stop the child, remove this rule so subsequent cases sharing the experiment home cannot inherit it, and retain normal experiment cleanup. Whole-home cleanup still removes rules/auth even with --keep. Deadlines, turn cap, usage bounds and marker inspection are unchanged.

## Specs added

- Run-6f-style Windows wrapper, forward/backslashes, powershell and pwsh, all three cmdlets and both flags; POSIX cat/test -e.
- Wrong path/case, second path, semicolon/pipe/ampersand chaining, redirection, write cmdlet, extra arguments, backtick and command substitution rejection.
- One tolerated read followed by decline/steer/accept remains observed; a tolerated read approval is declined, noted and followed by the normal flow.
- Second and late marker reads fail Unexpected command.
- Read-rule approval before output is declined and observed with declined completed status; completion without approval becomes the requested unverified result.
- Spawn-time assertions verify CODEX_HOME, fixture content and rule-file content; lifecycle assertions verify removal, including whole-home cleanup with --keep semantics.
- ask-read-rule manifest declaration uses kind read-rule, ask, deny and turnCost 1.

Specs are authored, not executed. Scoped diagnostics are the only check performed.

## Decisions

- Reuse the existing commandMatches wrapper validation rather than duplicate its executable policy. Evidence: evidence-harness.ts:892-916. Reversible local helper change.
- Track tolerated-read approval separately from result.approvals rather than insert a third approval. Evidence: unchanged inspect() checks original/replacement approval positions. The note and wire event summary retain evidence; reversible.
- Use rules/default.rules plus the explicit uncertainty note rather than claim a verified location or skip the requested probe. Evidence: binary strings and the user-authorized fallback. Reversible dev-only fixture choice.
- Match the complete fixed read argv in the prefix rule rather than allow a command-wide prefix. Evidence: requested single fixture command and existing exact identity gate. Reversible and bounded.
- Keep the existing deny decision literal/type; only the case kind needs extension because deny already exists. No invented wire decision.
- Remove the rule after each case because runHarness shares one experiment home across cases; retain whole-home cleanup as the final safety net. Evidence: runHarness creates one experiment before its case loop. Reversible scoped cleanup.
- Preserve the eight-turn hard cap. Adding the required case brings the full case catalog to ten planned turns (previously nine), so a selected subset is required; the existing preflight refuses an over-cap full catalog. No unapproved expansion of paid inference.

## Not done / risks

- No tests, standalone typecheck, lint, formatter, build, real App Server/model invocation, install or git command. Orchestrator owns execution and verification.
- Rule directory and complete syntax remain unverified from binary/schema evidence; the probe explicitly records this. Shell argv normalization may also prevent the full-prefix candidate from matching. A no-approval result cannot distinguish these causes from an ineffective prompt rule.
- A rule-triggered approval cannot by itself prove the rule caused prompting because the requested prompt also asks for approval, consistent with the requested command-case prompt style.
- Full-catalog runs exceed the unchanged hard cap; select a bounded subset for the real experiment.
- No other source or task-state files were changed.
