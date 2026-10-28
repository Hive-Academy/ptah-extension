APPROVED — 9/10

Review family: codex (reviewer) / claude (implementer)

## Findings

No actionable behavioral findings in the scoped uncommitted diffs. All four implementation reports were read and checked against the changes and relevant callers.

## Checked and fine

### Fix 1 — PowerShell login fallback

- `claude-login-console.ts:52-62`: environment removal, directory changes and login invocation are inside the child PowerShell block. The existing single-quote escaping remains applied to cwd, configuration directory, executable and prefix arguments; quoted braces cannot close the script block. The POSIX implementation is unchanged.
- Explicit `exit $LASTEXITCODE` preserves the native command's exit status. A harmless local PowerShell probe using the same child invocation returned native exit code 37 while preserving the parent directory and a parent environment variable removed in the child.
- The added tests inspect code outside literals and reject escaped injection statements. These are structural tests, not execution tests; the separate probe provides evidence for child isolation and exit propagation.

### Fix 2 — Certified executable

- `claude-sdk-lane-options.ts:79,238`: bootstrap and final named options use the certified SDK executable. The final ambient branch still uses the same loader value, with no other ambient option changes.
- `claude-cli.adapter.ts:132-144`: bootstrap no longer accepts the loader path. Final named options also ignore that path, eliminating the reported drift on both launches.
- Certification checks remain meaningful: the runner reads the actual options through `claudeActualLaunch`, compares them against certification, and performs the persistence launch-boundary check. The existing altered-executable refusal matrix remains; using the certificate to construct correct options does not remove validation of later alteration.
- The differing-loader-path tests check both children, and the adapter test requires one committed binding. Missing certification continues to refuse before launch.

### Fix 3 — Fresh named handoff

- `agent-process-manager.service.ts:477-553`: a real resume retains its reference, stored run ID and caller selection. A fresh handoff drops the old reference and generates a new run ID selecting the bound profile. Different-profile and explicit-ambient selections refuse with `conflict` before admission.
- The resume gate validates the authoritative binding before producing a fresh decision. The original resume request suppresses workspace-default lookup. Constructing an admission request does not acquire a reservation; the adapter makes one admission call, and the runner commits a new binding only when no stored resume binding exists.
- Ambient sessions have no bound reference and retain the previous admission fallback. Ordinary non-Claude sessions return no account admission and no account reference, preserving their behavior.
- Added tests cover the actual idle-limit gate, admission selection, conflicts and removal of the old reference. The real-adapter fresh tests intentionally stop at a mocked `busy` admission refusal; the separate mocked-adapter test verifies the manager's binding checkpoint. Together with the traced adapter/runner implementation, these provide useful, bounded evidence rather than a claim of a full successful fresh-run integration test.

### Fix 4 — settingSources guard

- `sdk-query-options-builder.ts:1427-1434`: the ambient expression is restored exactly as required by the source guard. The later named spread wins and copies the certified sources.
- Inspection through the end of the options object found no subsequent `settingSources` writer. Ambient values are unchanged.

## Decisions

- Review scope is the nine listed files' uncommitted diffs. Supporting code was read only to trace their behavior; no source or spec was modified.
- `prepareSdkHandleSpawn` still directly returns the gate result, including its reference on a fresh handoff. This is an unchanged, separate registry entry point, as fix 3's report states. Approval covers the adapter-backed spawn fix and does not claim the registry path is fixed.
- The adapter's pre-existing loader-availability guard remains on named launches. This can still refuse a missing loader path even with certification, but is not introduced by these fixes.
- No Jest, build, installation, or workspace verification was run. Reported implementer test results were not independently reproduced. Independent evidence consists of diff review, caller/control-flow inspection and the harmless PowerShell probe; no real Claude login or SDK child was launched.
