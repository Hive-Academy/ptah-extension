# Batch 2d-env report

Implemented the child-environment allowlist in the two assigned files only. No contracts, lifecycle behavior, pin checks, framing, limits, or verified-home behavior changed.

## Allowlist

Evidence: `libs/backend/codex-runtime/tools/evidence-harness.ts:304-322`. Its inherited set is PATH, PATHEXT, SYSTEMROOT, WINDIR, COMSPEC, LANG, LC_ALL; its returned environment additionally supplies HOME, USERPROFILE, TMP, TEMP, TMPDIR and CODEX_HOME.

| Variable | Reason and evidence |
| --- | --- |
| PATH (Path on Windows) | Executable discovery; inherited by harness. |
| PATHEXT | Windows executable extensions; inherited by harness. |
| SYSTEMROOT (SystemRoot on Windows) | Windows system directory; inherited by harness. |
| WINDIR (windir on Windows) | Windows directory; inherited by harness. |
| COMSPEC (ComSpec on Windows) | Windows command interpreter path; inherited by harness. |
| LANG | Locale selection; inherited by harness. |
| LC_ALL | Locale override; inherited by harness. |
| HOME | Home-directory lookup; supplied by harness. Runtime preserves host value because profile specifies Codex home only. |
| USERPROFILE | Windows home-directory lookup; supplied by harness. Runtime preserves host value. |
| TMP | Temporary directory; supplied by harness. Runtime preserves host value because profile has no scratch path. |
| TEMP | Temporary directory; supplied by harness. Runtime preserves host value. |
| TMPDIR | POSIX temporary directory; supplied by harness. Runtime preserves host value. |
| CODEX_HOME | Always profile.normalizedHome, never inherited; harness likewise supplies its explicit home. |

No additional names: APPDATA, LOCALAPPDATA, arbitrary LC_* variables, proxy/certificate variables and NODE_OPTIONS are excluded. The harness provides no evidence for allowing those. Windows accepted keys normalize to uppercase; Unix matching remains case-sensitive. All source CODEX_HOME case variants are excluded before setting the profile value. Host environment is not mutated.

## Changes and specs

- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:113`: replace unrestricted environment spread with an explicit anchored allowlist and profile CODEX_HOME.
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`: original handshake assertion accepts the isolated home; added exact environment assertions on Linux and Windows, and mixed-case Windows coverage. Tests reject ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, OPENAI_API_KEY, CODEX_API_KEY, GITHUB_TOKEN, PTAH_INTERNAL, OTHER_SECRET, OTHER_KEY, LC_SECRET, HTTPS_PROXY, NODE_OPTIONS and APPDATA; preserve every allowed name; verify host environment stays unchanged. Platform descriptor and environment are restored in teardown.

## Verification

Commands used PowerShell Select-Object/Select-String equivalents of the requested tail/grep filters, preserving native exit codes.

- `npx prettier --write libs/backend/codex-runtime/src/lib/codex-app-server-process.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`: exit 0; both files formatted.
- Scoped `ptah_get_diagnostics` after final edits: TypeScript compiler, clean coverage, 0 errors, 0 warnings, no sibling diagnostics.
- `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts --coverage=false --maxWorkers=2`: final exit 0; 1 suite passed, 29/29 tests passed, 0 snapshots, 6.015 s. Node emitted an ES-module-loading warning for jest.config.ts, but the suite ran successfully. Initial run failed because jest.replaceProperty cannot assign process.platform; corrected test setup to use Object.defineProperty and restore the original descriptor.
- `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: initial exit 0; both targets successful; 4 warnings, 0 errors. Final post-test-fix repeat recorded below.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` filtered by `codex-app-server-process|codex-runtime:`: exit 1; `libs/backend/codex-runtime: 2 FAIL (baseline 0)`. No codex-app-server-process file sites appeared. Project ratchet is not clean due to sites outside the assigned files; filtered output does not identify those files. No out-of-scope changes made.
- No real Codex binary, git, build, install, workspace-wide test/typecheck/lint or e2e run.

## Decisions

1. Use precisely the harness variable names, preserving host HOME/USERPROFILE/temp values. Alternatives: invent isolated scratch directories or expand the allowlist. Evidence: harness lines 304-322 and profile contract in codex-runtime.types.ts:63; profile has no scratch directory. This confines changes to environment filtering and avoids adding filesystem/lifecycle behavior. Reversible in a later explicitly scoped isolation change.
2. Normalize allowed Windows names to uppercase and match Unix names exactly. Alternatives: universal case-insensitive matching or retain duplicate Windows keys. Evidence: required Windows case handling and Windows environment semantics; tested independently of actual host platform. Reversible implementation detail with regression coverage.
3. Do not add extraEnv. Neither CodexExecutionProfile nor CodexExecutionProfileInput nor process constructor has that field. Alternatives: add a contract field or inherit host secrets. Scope explicitly prohibits new 2a fields. Later batch 2k/consumers may need an explicit caller/profile extraEnv contract for deliberate provider configuration; that requires a separate reviewed change. Reversible by extending those contracts in their owning batch.

Final verification: post-test-fix Nx repeat exited 0; successfully ran typecheck and lint, with 4 warnings and 0 errors. Spec locations: exact inherited environment assertions at codex-app-server-process.spec.ts:176; mixed-case Windows regression at :221; mock restoration at :130.
